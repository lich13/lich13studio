import { LoadingOutlined } from '@ant-design/icons'
import { Tag as AntdTag, Tooltip } from 'antd'
import { CircleArrowLeft, Copy, Pin } from 'lucide-react'
import type { FC } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FooterProps {
  loading?: boolean
  setIsPinned: (isPinned: boolean) => void
  isPinned: boolean
  onEsc: () => void
  onCopy?: () => void
}

const Footer: FC<FooterProps> = ({ loading, onEsc, setIsPinned, isPinned, onCopy }) => {
  const { t } = useTranslation()

  useHotkeys('esc', () => {
    onEsc()
  })

  useHotkeys('c', () => {
    handleCopy()
  })

  const handleCopy = () => {
    if (loading || !onCopy) return
    onCopy()
  }

  return (
    <WindowFooter className="drag">
      <FooterText>
        <Tag
          bordered={false}
          icon={
            loading ? (
              <LoadingOutlined style={{ fontSize: 12, color: 'var(--color-error)', padding: 0 }} spin />
            ) : (
              <CircleArrowLeft size={14} color="var(--color-text)" />
            )
          }
          className="nodrag"
          onClick={onEsc}>
          {t('miniwindow.footer.esc', {
            action: loading ? t('miniwindow.footer.esc_pause') : t('miniwindow.footer.esc_close')
          })}
        </Tag>
        {!loading && (
          <Tag
            bordered={false}
            icon={<Copy size={14} color="var(--color-text)" />}
            style={{ cursor: 'pointer' }}
            className="nodrag"
            onClick={handleCopy}>
            {t('miniwindow.footer.copy_last_message')}
          </Tag>
        )}
      </FooterText>
      <PinButtonArea onClick={() => setIsPinned(!isPinned)} className="nodrag">
        <Tooltip title={t('miniwindow.tooltip.pin')} mouseEnterDelay={0.8} placement="left">
          <Pin
            size={14}
            stroke={isPinned ? 'var(--color-primary)' : 'var(--color-text)'}
            style={{
              transform: isPinned ? 'rotate(40deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease-in-out'
            }}
          />
        </Tooltip>
      </PinButtonArea>
    </WindowFooter>
  )
}

const WindowFooter = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 5px 0;
  color: var(--color-text-secondary);
  font-size: 12px;
`

const FooterText = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
`

const PinButtonArea = styled.div`
  cursor: pointer;
  display: flex;
  align-items: center;
  margin-right: 5px;
`

const Tag = styled(AntdTag)`
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-primary);
  }
`

export default Footer
