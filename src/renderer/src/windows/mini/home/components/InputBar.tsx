import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Assistant } from '@renderer/types'
import { Button, Input as AntdInput, Tooltip } from 'antd'
import { SendHorizontal, Square } from 'lucide-react'
import type { InputRef } from 'rc-input/lib/interface'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  assistant: Assistant
  referenceText: string
  placeholder: string
  loading: boolean
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handlePaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
  actions?: React.ReactNode
  canSend: boolean
  onSend: () => void
  onPause: () => void
}

const InputBar = ({
  ref,
  text,
  assistant,
  placeholder,
  loading,
  handleKeyDown,
  handleChange,
  handlePaste,
  actions,
  canSend,
  onSend,
  onPause
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const { t } = useTranslation()
  const inputRef = useRef<InputRef>(null)
  const { setTimeoutTimer } = useTimer()
  if (!loading) {
    setTimeoutTimer('focus', () => inputRef.current?.input?.focus(), 0)
  }
  return (
    <InputWrapper ref={ref}>
      <ModelSlot>{assistant.model && <ModelAvatar model={assistant.model} size={24} />}</ModelSlot>
      <Input
        value={text}
        placeholder={placeholder}
        variant="borderless"
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onPaste={handlePaste}
        ref={inputRef}
      />
      <ActionGroup>
        {actions}
        <Tooltip placement="top" title={loading ? t('chat.input.pause') : t('chat.input.send')} mouseLeaveDelay={0}>
          <SendButton
            type="text"
            aria-label={loading ? t('chat.input.pause') : t('chat.input.send')}
            disabled={!loading && !canSend}
            $primary={!loading && canSend}
            onClick={loading ? onPause : onSend}>
            {loading ? <Square size={14} /> : <SendHorizontal size={16} />}
          </SendButton>
        </Tooltip>
      </ActionGroup>
    </InputWrapper>
  )
}
InputBar.displayName = 'InputBar'

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.08);
  -webkit-app-region: none;

  &:focus-within {
    border-color: var(--color-primary);
  }
`

const ModelSlot = styled.div`
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
`

const Input = styled(AntdInput)`
  min-width: 0;
  background: none;
  border: none;
  -webkit-app-region: none;
  font-size: 14px;

  &.ant-input {
    padding: 0;
  }
`

const ActionGroup = styled.div`
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
`

const SendButton = styled(Button)<{ $primary: boolean }>`
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: ${({ $primary }) => ($primary ? 'var(--color-primary)' : 'var(--color-text-secondary)')};

  &:hover {
    color: ${({ $primary }) => ($primary ? 'var(--color-primary)' : 'var(--color-text)')};
    background: var(--color-background-mute);
  }
`

export default InputBar
