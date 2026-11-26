import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { Typography } from 'antd'
import { X } from 'lucide-react'
import type { FC } from 'react'
import styled from 'styled-components'

interface ClipboardPreviewProps {
  referenceText: string
  clearClipboard: () => void
  t: (key: string) => string
}

const { Paragraph } = Typography

const ClipboardPreview: FC<ClipboardPreviewProps> = ({ referenceText, clearClipboard, t }) => {
  if (!referenceText) return null

  return (
    <Container>
      <ClipboardContent>
        <CopyIcon style={{ fontSize: '14px', flexShrink: 0 }} className="nodrag" />
        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{ margin: '0 12px', fontSize: 12, flex: 1, minWidth: 0 }}
          className="nodrag">
          {referenceText || t('miniwindow.clipboard.empty')}
        </Paragraph>
        <CloseButton type="button" onClick={clearClipboard} className="nodrag">
          <X size={14} />
        </CloseButton>
      </ClipboardContent>
    </Container>
  )
}

const Container = styled.div`
  padding: 12px;
  background-color: var(--color-background-opacity);
  border-radius: 8px;
  margin-bottom: 10px;
`
const ClipboardContent = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  color: var(--color-text-secondary);
`

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-mute);
  }
`

export default ClipboardPreview
