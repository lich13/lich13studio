import { loggerService } from '@renderer/services/LoggerService'
import type { VideoMessageBlock } from '@renderer/types/newMessage'
import type { FC, SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('MessageVideo')

interface Props {
  block: VideoMessageBlock
}

const MessageVideo: FC<Props> = ({ block }) => {
  const { t } = useTranslation()

  if (!block.url && !block.filePath) {
    return null
  }

  const renderLocalVideo = () => {
    const localPath = block.metadata?.video?.path ?? block.filePath
    if (!localPath) {
      logger.warn('Local video was requested but video path is missing.')
      return <div>{t('message.video.error.local_file_missing')}</div>
    }

    const videoSrc = localPath.startsWith('file://') ? localPath : `file://${localPath}`
    const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
      const startTime = Math.floor(block.metadata?.startTime ?? 0)
      if (startTime > 0) {
        event.currentTarget.currentTime = startTime
      }
    }

    return (
      <video
        controls
        preload="metadata"
        style={{ height: '100%', width: '100%' }}
        src={videoSrc}
        onLoadedMetadata={handleLoadedMetadata}
      />
    )
  }

  const renderVideo = () => {
    if (block.metadata?.type === 'video' || block.filePath) {
      return renderLocalVideo()
    }

    if (block.url) {
      return <video controls preload="metadata" style={{ height: '100%', width: '100%' }} src={block.url} />
    }

    logger.warn(`Unsupported video type: ${block.metadata?.type} or missing necessary data.`)
    return <div>{t('message.video.error.unsupported_type')}</div>
  }

  return <Container>{renderVideo()}</Container>
}

export default MessageVideo

const Container = styled.div`
  max-width: 560px;
  width: 100%;
  aspect-ratio: 16 / 9;
  height: auto;
  background-color: #000;
`
