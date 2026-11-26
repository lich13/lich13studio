import { loggerService } from '@logger'
import { attachmentMime } from '@renderer/utils/attachmentMime'
import { download } from '@renderer/utils/download'
import { convertImageToPng } from '@renderer/utils/image'
import { parseDataUrl } from '@shared/utils'
import type { ImageProps as AntImageProps } from 'antd'
import { Dropdown, Image as AntImage, Space } from 'antd'
import {
  Copy,
  DownloadIcon,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { CopyIcon } from './Icons'

interface ImageViewerProps extends AntImageProps {
  src: string
}

const logger = loggerService.withContext('ImageViewer')

const ImageViewer: React.FC<ImageViewerProps> = ({ src, style, ...props }) => {
  const { t } = useTranslation()

  // 复制图片到剪贴板
  const handleCopyImage = async (src: string) => {
    try {
      let blob: Blob

      if (src.startsWith('data:')) {
        // 处理 base64 格式的图片 - 使用 parseDataUrl 避免正则匹配大字符串导致OOM
        const parseResult = parseDataUrl(src)
        if (!parseResult || !parseResult.mediaType || !parseResult.isBase64) {
          throw new Error('Invalid base64 image format')
        }
        const rawBinary = atob(parseResult.data)
        const byteArray = new Uint8Array(rawBinary.length)
        for (let i = 0; i < rawBinary.length; i += 1) {
          byteArray[i] = rawBinary.charCodeAt(i)
        }
        blob = new Blob([byteArray], { type: parseResult.mediaType })
      } else if (src.startsWith('file://')) {
        const filePath = src.replace(/^file:\/\//i, '')
        const binary = await window.api.file.binaryImage(filePath)
        const mimeType = attachmentMime(filePath, binary.mime, binary.data)
        blob = new Blob([binary.data.slice()], { type: mimeType })
      } else {
        // 处理 URL 格式的图片
        const response = await fetch(src)
        blob = await response.blob()
      }

      // 统一转换为 PNG 以确保兼容性（剪贴板 API 不支持 JPEG）
      const pngBlob = await convertImageToPng(blob)

      const item = new ClipboardItem({
        'image/png': pngBlob
      })
      await navigator.clipboard.write([item])

      window.toast.success(t('message.copy.success'))
    } catch (error) {
      const err = error as Error
      logger.error(`Failed to copy image: ${err.message}`, { stack: err.stack })
      window.toast.error(t('message.copy.failed'))
    }
  }

  const getContextMenuItems = (src: string, size: number = 14) => {
    return [
      {
        key: 'copy-image',
        label: t('common.copy'),
        icon: <CopyIcon size={size} />,
        onClick: () => handleCopyImage(src)
      },
      {
        key: 'copy-url',
        label: t('preview.copy.src'),
        icon: <CopyIcon size={size} />,
        onClick: () => {
          void navigator.clipboard.writeText(src)
          window.toast.success(t('message.copy.success'))
        }
      },
      {
        key: 'download',
        label: t('common.download'),
        icon: <DownloadIcon size={size} />,
        onClick: () => download(src)
      }
    ]
  }

  return (
    <Dropdown menu={{ items: getContextMenuItems(src) }} trigger={['contextMenu']}>
      <AntImage
        src={src}
        style={style}
        onContextMenu={(e) => e.stopPropagation()}
        {...props}
        preview={{
          mask: typeof props.preview === 'object' ? props.preview.mask : false,
          ...(typeof props.preview === 'object' ? props.preview : {}),
          toolbarRender: (
            _,
            {
              transform: { scale },
              actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn, onReset }
            }
          ) => (
            <ToolbarWrapper size={12} className="toolbar-wrapper">
              <ToolbarIconButton type="button" onClick={onFlipY}>
                <FlipVertical2 size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={onFlipX}>
                <FlipHorizontal2 size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={onRotateLeft}>
                <RotateCcw size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={onRotateRight}>
                <RotateCw size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" disabled={scale === 1} onClick={onZoomOut}>
                <ZoomOut size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" disabled={scale === 50} onClick={onZoomIn}>
                <ZoomIn size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={onReset}>
                <Undo2 size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={() => handleCopyImage(src)}>
                <Copy size={18} />
              </ToolbarIconButton>
              <ToolbarIconButton type="button" onClick={() => download(src)}>
                <DownloadIcon size={18} />
              </ToolbarIconButton>
            </ToolbarWrapper>
          )
        }}
      />
    </Dropdown>
  )
}

const ToolbarWrapper = styled(Space)`
  padding: 0px 24px;
  color: #fff;
  font-size: 20px;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 100px;
`

const ToolbarIconButton = styled.button`
  background: none;
  border: 0;
  color: inherit;
  padding: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  &:hover:not(:disabled) {
    opacity: 0.3;
  }
  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`

export default ImageViewer
