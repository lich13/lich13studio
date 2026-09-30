import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { Skeleton } from 'antd'
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
  isSingle?: boolean
}

const ImageBlock: React.FC<Props> = ({ block, isSingle = false }) => {
  const [previewSrc, setPreviewSrc] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    if (!block.file) {
      setPreviewSrc('')
      return
    }

    void FileManager.resolvePreviewUrl(block.file)
      .then((src) => {
        if (!cancelled) {
          setPreviewSrc(src)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewSrc('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [block.file])

  if (block.status === MessageBlockStatus.PENDING) {
    return <Skeleton.Image active style={{ width: 200, height: 200 }} />
  }

  if (block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.SUCCESS) {
    const images = block.metadata?.generateImageResponse?.images?.length
      ? block.metadata?.generateImageResponse?.images
      : block?.file
        ? [previewSrc]
        : block?.url
          ? [block.url]
          : []

    return (
      <Container>
        {images.filter(Boolean).map((src, index) => (
          <ImageViewer
            src={src}
            key={`image-${index}`}
            style={
              isSingle
                ? { maxWidth: 500, maxHeight: 'min(500px, 50vh)', padding: 0, borderRadius: 8 }
                : { width: 280, height: 280, objectFit: 'cover', padding: 0, borderRadius: 8 }
            }
          />
        ))}
      </Container>
    )
  }

  return null
}

const Container = styled.div`
  display: block;
`
export default React.memo(ImageBlock)
