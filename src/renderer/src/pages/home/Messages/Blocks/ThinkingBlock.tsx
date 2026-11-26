import { loggerService } from '@logger'
import ThinkingEffect from '@renderer/components/ThinkingEffect'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { MessageBlockStatus, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { Collapse, Tooltip } from 'antd'
import { Check, Copy } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

const logger = loggerService.withContext('ThinkingBlock')
interface Props {
  block: ThinkingMessageBlock
}

const ThinkingBlock: React.FC<Props> = ({ block }) => {
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()
  const { messageFont, fontSize, thoughtAutoCollapse } = useSettings()
  const [activeKey, setActiveKey] = useState<'thought' | ''>(thoughtAutoCollapse ? '' : 'thought')

  const isThinking = useMemo(() => block.status === MessageBlockStatus.STREAMING, [block.status])

  useEffect(() => {
    if (thoughtAutoCollapse) {
      setActiveKey('')
    } else {
      setActiveKey('thought')
    }
  }, [isThinking, thoughtAutoCollapse])

  const copyThought = useCallback(() => {
    if (block.content) {
      navigator.clipboard
        .writeText(block.content)
        .then(() => {
          window.toast.success({ title: t('message.copied'), key: 'copy-message' })
          setCopied(true)
        })
        .catch((error) => {
          logger.error('Failed to copy text:', error)
          window.toast.error({ title: t('message.copy.failed'), key: 'copy-message-error' })
        })
    }
  }, [block.content, setCopied, t])

  if (!block.content) {
    return null
  }

  return (
    <CollapseContainer
      activeKey={activeKey}
      size="small"
      onChange={() => setActiveKey((key) => (key ? '' : 'thought'))}
      className="message-thought-container"
      ghost
      items={[
        {
          key: 'thought',
          label: (
            <ThinkingEffect
              expanded={activeKey === 'thought'}
              isThinking={isThinking}
              thinkingTimeText={
                <ThinkingTimeSeconds blockThinkingTime={block.thinking_millsec} isThinking={isThinking} />
              }
              content={block.content}
            />
          ),
          children: (
            //  FIXME: 临时兼容
            <ThinkingContent
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize
              }}>
              {!isThinking && (
                <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
                  <ActionButton
                    type="button"
                    className="message-action-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyThought()
                    }}
                    aria-label={t('common.copy')}>
                    {!copied && <Copy size={14} className="lucide-custom" />}
                    {copied && <Check size={14} style={{ color: 'var(--color-primary)' }} />}
                  </ActionButton>
                </Tooltip>
              )}
              <Markdown block={block} />
            </ThinkingContent>
          ),
          showArrow: false
        }
      ]}
    />
  )
}

const normalizeThinkingTime = (value?: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const ThinkingTimeSeconds = memo(
  ({ blockThinkingTime, isThinking }: { blockThinkingTime: number; isThinking: boolean }) => {
    const { t } = useTranslation()
    const normalizedPropTime = normalizeThinkingTime(blockThinkingTime)
    const [displayTime, setDisplayTime] = useState(normalizedPropTime)
    const anchorRef = useRef<{ baseMs: number; startedAt: number }>({
      baseMs: normalizedPropTime,
      startedAt: isThinking ? performance.now() : 0
    })

    useEffect(() => {
      if (isThinking) {
        const now = performance.now()
        const currentElapsed =
          anchorRef.current.startedAt > 0
            ? anchorRef.current.baseMs + (now - anchorRef.current.startedAt)
            : anchorRef.current.baseMs
        const nextBase = Math.max(currentElapsed, normalizedPropTime)
        anchorRef.current = { baseMs: nextBase, startedAt: now }
        setDisplayTime((prev) => Math.max(prev, nextBase))
      } else {
        anchorRef.current = { baseMs: normalizedPropTime, startedAt: 0 }
        setDisplayTime(normalizedPropTime)
      }
    }, [isThinking, normalizedPropTime])

    useEffect(() => {
      if (!isThinking) return
      if (anchorRef.current.startedAt <= 0) {
        anchorRef.current = {
          baseMs: Math.max(anchorRef.current.baseMs, normalizeThinkingTime(blockThinkingTime)),
          startedAt: performance.now()
        }
      }
      const timerId = setInterval(() => {
        const now = performance.now()
        const next = anchorRef.current.baseMs + (now - anchorRef.current.startedAt)
        setDisplayTime((prev) => (next > prev ? next : prev))
      }, 100)

      return () => {
        clearInterval(timerId)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isThinking])

    const thinkingTimeSeconds = useMemo(() => {
      const safeTime = normalizeThinkingTime(displayTime)
      return ((safeTime <= 0 ? (isThinking ? 100 : 0) : Math.max(100, safeTime)) / 1000).toFixed(1)
    }, [displayTime, isThinking])

    return isThinking
      ? t('chat.thinking', {
          seconds: thinkingTimeSeconds
        })
      : t('chat.deeply_thought', {
          seconds: thinkingTimeSeconds
        })
  }
)

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
  .ant-collapse-header {
    padding: 0 !important;
  }
  .ant-collapse-content-box {
    padding: 16px !important;
    border-width: 0 0.5px 0.5px 0.5px;
    border-style: solid;
    border-color: var(--color-border);
    border-radius: 0 0 12px 12px;
  }
`

const ThinkingContent = styled.div`
  position: relative;
`

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  opacity: 0.6;
  transition: all 0.3s;
  position: absolute;
  right: -12px;
  top: -12px;

  &:hover {
    opacity: 1;
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
`

export default memo(ThinkingBlock)
