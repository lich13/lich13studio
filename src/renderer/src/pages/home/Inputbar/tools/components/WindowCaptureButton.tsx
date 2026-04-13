import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata } from '@renderer/types'
import { Tooltip } from 'antd'
import { Camera, Monitor } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CaptureWindowInfo = {
  id: number
  appName: string
  title: string
  width: number
  height: number
  isFocused: boolean
}

interface Props {
  quickPanel: ToolQuickPanelApi
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  couldAddImageFile: boolean
}

const WindowCaptureButton: FC<Props> = ({ quickPanel, setFiles, couldAddImageFile }) => {
  const { t } = useTranslation()
  const quickPanelController = useQuickPanel()
  const [capturing, setCapturing] = useState(false)

  const captureWindow = useCallback(
    async (target: CaptureWindowInfo) => {
      if (capturing) {
        return
      }

      setCapturing(true)

      try {
        const result = await window.api.system.captureWindow(target.id)
        const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
        const file = await window.api.file.savePastedImage(bytes, 'png')

        if (file) {
          setFiles((previousFiles) => [...previousFiles, file])
          window.toast.success(t('chat.input.capture.success'))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('chat.input.capture.failed')
        window.toast.error(`${t('chat.input.capture.failed')}: ${message}`)
      } finally {
        setCapturing(false)
      }
    },
    [capturing, setFiles, t]
  )

  const openWindowPicker = useCallback(async () => {
    if (capturing) {
      return
    }

    if (!couldAddImageFile) {
      window.toast.warning(t('chat.input.capture.image_required'))
      return
    }

    let windows: CaptureWindowInfo[] = []
    try {
      windows = await window.api.system.listCaptureWindows()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.input.capture.failed')
      window.toast.error(`${t('chat.input.capture.failed')}: ${message}`)
      return
    }

    if (!windows.length) {
      window.toast.error(t('chat.input.capture.unavailable'))
      return
    }

    if (windows.length === 1) {
      await captureWindow(windows[0])
      return
    }

    quickPanelController.open({
      title: t('chat.input.capture.pick_window'),
      defaultIndex: 0,
      list: windows.map((windowInfo) => ({
        label: windowInfo.title,
        description: `${windowInfo.appName} · ${windowInfo.width}×${windowInfo.height}`,
        filterText: `${windowInfo.appName} ${windowInfo.title}`,
        icon: <Monitor />,
        action: () => {
          void captureWindow(windowInfo)
        },
        suffix: windowInfo.isFocused ? t('chat.input.capture.current') : undefined
      })),
      symbol: QuickPanelReservedSymbol.File
    })
  }, [captureWindow, capturing, couldAddImageFile, quickPanelController, t])

  const rootMenuItems = useMemo(
    () => [
      {
        label: t('chat.input.capture.label'),
        description: '',
        icon: <Camera />,
        isMenu: true,
        action: () => {
          void openWindowPicker()
        }
      }
    ],
    [openWindowPicker, t]
  )

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu(rootMenuItems)
    return () => {
      disposeRootMenu()
    }
  }, [quickPanel, rootMenuItems])

  return (
    <Tooltip placement="top" title={t('chat.input.capture.label')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={() => void openWindowPicker()}
        disabled={capturing}
        aria-label={t('chat.input.capture.label')}>
        <Camera size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default WindowCaptureButton
