import { Button } from 'antd'
import { Check, Monitor, X } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { type MiniCaptureWindowInfo, sortMiniCaptureWindows } from '../miniWindowHelpers'

interface Props {
  windows: MiniCaptureWindowInfo[]
  capturing: boolean
  onSelectWindow: (windowInfo: MiniCaptureWindowInfo) => void
  onClose: () => void
}

const CapturePanel: FC<Props> = ({ windows, capturing, onSelectWindow, onClose }) => {
  const { t } = useTranslation()
  const sortedWindows = useMemo(() => sortMiniCaptureWindows(windows), [windows])

  if (sortedWindows.length === 0) {
    return null
  }

  return (
    <Panel className="nodrag">
      <PanelHeader>
        <HeaderText>{t('chat.input.capture.pick_window')}</HeaderText>
        <CloseButton type="text" aria-label={t('common.close')} icon={<X size={14} />} onClick={onClose} />
      </PanelHeader>
      <WindowList>
        {sortedWindows.map((windowInfo) => (
          <WindowItem key={windowInfo.id} type="button" disabled={capturing} onClick={() => onSelectWindow(windowInfo)}>
            <WindowIcon>
              <Monitor size={15} />
            </WindowIcon>
            <WindowText>
              <WindowTitle>{windowInfo.title}</WindowTitle>
              <WindowMeta>
                {windowInfo.appName} · {windowInfo.width}×{windowInfo.height}
              </WindowMeta>
            </WindowText>
            {windowInfo.isFocused && (
              <FocusedBadge>
                <Check size={12} />
                {t('chat.input.capture.current')}
              </FocusedBadge>
            )}
          </WindowItem>
        ))}
      </WindowList>
    </Panel>
  )
}

const Panel = styled.section`
  display: flex;
  width: 100%;
  max-height: 246px;
  flex-direction: column;
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.14);
  -webkit-app-region: none;
`

const PanelHeader = styled.div`
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 7px 0 12px;
  border-bottom: 1px solid var(--color-border);
`

const HeaderText = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CloseButton = styled(Button)`
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text);
    background: var(--color-background-mute);
  }
`

const WindowList = styled.div`
  display: flex;
  max-height: 211px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 6px;
`

const WindowItem = styled.button`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;

  &:hover,
  &:focus-visible {
    background: var(--color-background-mute);
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`

const WindowIcon = styled.span`
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: var(--color-background-soft);
`

const WindowText = styled.span`
  min-width: 0;
`

const WindowTitle = styled.span`
  display: block;
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const WindowMeta = styled.span`
  display: block;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FocusedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--color-primary);
  font-size: 11px;
  white-space: nowrap;
`

export default CapturePanel
