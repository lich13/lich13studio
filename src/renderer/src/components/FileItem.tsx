import { videoExts } from '@shared/config/constant'
import { Flex } from 'antd'
import {
  FileArchive,
  FileCode,
  FileImage,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  Link,
  Presentation,
  Video
} from 'lucide-react'
import React, { memo } from 'react'
import styled from 'styled-components'

interface FileItemProps {
  fileInfo: {
    icon?: React.ReactNode
    name: React.ReactNode | string
    ext: string
    extra?: React.ReactNode | string
    actions: React.ReactNode
  }
  style?: React.CSSProperties
}

export const getFileIcon = (type?: string, size: number | string = '1em') => {
  if (!type) return <FileQuestion size={size} />

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return <FileImage size={size} />
  }

  if (['.doc', '.docx', '.pdf'].includes(ext)) {
    return <FileText size={size} />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileSpreadsheet size={size} />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <Presentation size={size} />
  }
  if (['.md', '.markdown', '.tscn', '.gd'].includes(ext)) {
    return <FileCode size={size} />
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileArchive size={size} />
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv'].includes(ext)) {
    return <FileText size={size} />
  }

  if (['.url'].includes(ext)) {
    return <Link size={size} />
  }

  if (['.sitemap'].includes(ext)) {
    return <Globe size={size} />
  }

  if (['.folder'].includes(ext)) {
    return <FolderOpen size={size} />
  }

  if (videoExts.includes(ext)) {
    return <Video size={size} />
  }

  return <FileQuestion size={size} />
}

const FileItem: React.FC<FileItemProps> = ({ fileInfo, style }) => {
  const { name, ext, extra, actions, icon } = fileInfo

  return (
    <FileItemCard style={style}>
      <CardContent>
        <FileIcon>{icon || getFileIcon(ext)}</FileIcon>
        <Flex vertical justify="center" gap={0} flex={1} style={{ width: '0px' }}>
          <FileName>{name}</FileName>
          {extra && <FileInfo>{extra}</FileInfo>}
        </Flex>
        <FileActions>{actions}</FileActions>
      </CardContent>
    </FileItemCard>
  )
}

const FileItemCard = styled.div`
  border-radius: 8px;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  flex-shrink: 0;
  transition:
    box-shadow 0.2s ease,
    background-color 0.2s ease;
  --shadow-color: rgba(0, 0, 0, 0.05);
  &:hover {
    box-shadow:
      0 10px 15px -3px var(--shadow-color),
      0 4px 6px -4px var(--shadow-color);
  }
  body[theme-mode='dark'] & {
    --shadow-color: rgba(255, 255, 255, 0.02);
  }
`

const CardContent = styled.div`
  padding: 8px 8px 8px 16px;
  display: flex;
  align-items: stretch;
  gap: 16px;
`

const FileIcon = styled.div`
  max-height: 44px;
  color: var(--color-text-3);
  font-size: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const FileName = styled.div`
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.2s ease;
  span {
    font-size: 15px;
  }
  &:hover {
    color: var(--color-primary);
  }
`

const FileInfo = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
`

const FileActions = styled.div`
  max-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export default memo(FileItem)
