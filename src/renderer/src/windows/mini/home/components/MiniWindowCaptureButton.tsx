import type { FileMetadata } from '@renderer/types'
import { Button, Tooltip } from 'antd'
import { Camera, Check, Monitor, X } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  captureMiniWindowScreenshot,
  captureMiniWindowSelectedWindow,
  type MiniCaptureWindowInfo,
  type MiniWindowCaptureNotice
} from '../miniWindowHelpers'

interface Props {
  canCaptureImage: boolean
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
}

const MiniWindowCaptureButton: FC<Props> = ({ canCaptureImage, setFiles }) => {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const [windows, setWindows] = useState<MiniCaptureWindowInfo[]>([])

  const notify = useCallback(
    (notice: MiniWindowCaptureNotice, error?: unknown) => {
      switch (notice) {
        case 'image-required':
          window.toast.warning(t('chat.input.capture.image_required'))
          break
        case 'unavailable':
          window.toast.error(t('chat.input.capture.unavailable'))
          break
        case 'success':
          window.toast.success(t('chat.input.capture.success'))
          break
        case 'failed': {
          const message = error instanceof Error ? error.message : t('chat.input.capture.failed')
          window.toast.error(`${t('chat.input.capture.failed')}: ${message}`)
          break
        }
      }
    },
    [t]
  )

  const addCapturedFile = useCallback(
    (file: FileMetadata) => {
      setFiles((previousFiles) => [...previousFiles, file])
    },
    [setFiles]
  )

  const captureSelectedWindow = useCallback(
    async (target: MiniCaptureWindowInfo) => {
      if (capturing) return

      setCapturing(true)
      setWindows([])
      try {
        await captureMiniWindowSelectedWindow({
          target,
          captureWindow: window.api.system.captureWindow,
          savePastedImage: window.api.file.savePastedImage,
          onAddFile: addCapturedFile,
          notify
        })
      } finally {
        setCapturing(false)
      }
    },
    [addCapturedFile, capturing, notify]
  )

  const openWindowPicker = useCallback(async () => {
    if (capturing) return

    setCapturing(true)
    try {
      await captureMiniWindowScreenshot({
        canCaptureImage,
        listCaptureWindows: window.api.system.listCaptureWindows,
        captureWindow: window.api.system.captureWindow,
        savePastedImage: window.api.file.savePastedImage,
        onSelectWindow: setWindows,
        onAddFile: addCapturedFile,
        notify
      })
    } finally {
      setCapturing(false)
    }
  }, [addCapturedFile, canCaptureImage, capturing, notify])

  const sortedWindows = useMemo(
    () =>
      [...windows].sort(
        (left, right) =>
          Number(right.isFocused) - Number(left.isFocused) ||
          left.appName.localeCompare(right.appName) ||
          left.title.localeCompare(right.title)
      ),
    [windows]
  )

  return (
    <CaptureRoot>
      <Tooltip placement="top" title={t('chat.input.capture.label')} mouseLeaveDelay={0} arrow>
        <CaptureButton
          type="text"
          aria-label={t('chat.input.capture.label')}
          disabled={capturing}
          onClick={() => void openWindowPicker()}>
          <Camera size={16} />
        </CaptureButton>
      </Tooltip>
      {sortedWindows.length > 0 && (
        <WindowPicker>
          <PickerHeader>
            <span>{t('chat.input.capture.pick_window')}</span>
            <button type="button" onClick={() => setWindows([])} aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </PickerHeader>
          <WindowList>
            {sortedWindows.map((windowInfo) => (
              <WindowItem key={windowInfo.id} type="button" onClick={() => void captureSelectedWindow(windowInfo)}>
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
        </WindowPicker>
      )}
    </CaptureRoot>
  )
}

const CaptureRoot = styled.div`
  position: relative;
  display: flex;
  -webkit-app-region: none;
`

const CaptureButton = styled(Button)`
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  border-radius: 8px;

  &:hover {
    color: var(--color-text);
    background: var(--color-background-mute);
  }
`

const WindowPicker = styled.div`
  position: absolute;
  right: -38px;
  bottom: 38px;
  z-index: 20;
  width: 330px;
  max-height: 290px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
`

const PickerHeader = styled.div`
  display: flex;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 12px;

  button {
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
  }
`

const WindowList = styled.div`
  display: flex;
  max-height: 250px;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px;
`

const WindowItem = styled.button`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 8px;
  text-align: left;

  &:hover,
  &:focus-visible {
    background: var(--color-background-mute);
    outline: none;
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

export default MiniWindowCaptureButton
