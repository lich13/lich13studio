import { ActionIconButton } from '@renderer/components/Buttons'
import type { FileMetadata } from '@renderer/types'
import { Tooltip } from 'antd'
import { Camera } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  couldAddImageFile: boolean
}

const isCaptureCancelled = (error: unknown) => {
  if (!(error instanceof Error)) return false
  return ['AbortError', 'NotAllowedError'].includes(error.name)
}

const captureSingleFrame = async (stream: MediaStream): Promise<Blob> => {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Failed to load capture stream'))
  })

  await video.play()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const width = video.videoWidth || 1920
  const height = video.videoHeight || 1080
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create screenshot canvas')
  }

  context.drawImage(video, 0, 0, width, height)
  video.pause()
  video.srcObject = null

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })

  if (!blob) {
    throw new Error('Failed to encode captured screenshot')
  }

  return blob
}

const WindowCaptureButton: FC<Props> = ({ setFiles, couldAddImageFile }) => {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)

  const handleCapture = useCallback(async () => {
    if (capturing) {
      return
    }

    if (!couldAddImageFile) {
      window.toast.warning(t('chat.input.capture.image_required'))
      return
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      window.toast.error(t('chat.input.capture.unsupported'))
      return
    }

    let stream: MediaStream | null = null
    setCapturing(true)
    window.toast.info(t('chat.input.capture.pick_window'))

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })

      const blob = await captureSingleFrame(stream)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const file = await window.api.file.savePastedImage(bytes, 'png')

      if (file) {
        setFiles((previousFiles) => [...previousFiles, file])
        window.toast.success(t('chat.input.capture.success'))
      }
    } catch (error) {
      if (isCaptureCancelled(error)) {
        window.toast.info(t('chat.input.capture.cancelled'))
      } else {
        const message = error instanceof Error ? error.message : t('chat.input.capture.failed')
        window.toast.error(`${t('chat.input.capture.failed')}: ${message}`)
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      setCapturing(false)
    }
  }, [capturing, couldAddImageFile, setFiles, t])

  return (
    <Tooltip placement="top" title={t('chat.input.capture.label')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleCapture}
        disabled={capturing}
        aria-label={t('chat.input.capture.label')}>
        <Camera size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default WindowCaptureButton
