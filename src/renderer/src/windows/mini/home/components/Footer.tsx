import { Tag as AntdTag, Tooltip } from 'antd'
import { CircleArrowLeft, Copy, Loader2, Pin } from 'lucide-react'
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

const INTERACTIVE_OVERLAY_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], .ant-select, .ant-select-dropdown, .ant-dropdown, .ant-popover, .ant-modal'

const Footer: FC<FooterProps> = ({ loading, onEsc, setIsPinned, isPinned, onCopy }) => {
  const { t } = useTranslation()

  useHotkeys('esc', () => {
    onEsc()
  })

  useHotkeys('c', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (window.getSelection()?.toString()) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = event.target instanceof HTMLElement ? event.target : null
    if (
      active?.isContentEditable ||
      target?.isContentEditable ||
      active?.closest(INTERACTIVE_OVERLAY_SELECTOR) ||
      target?.closest(INTERACTIVE_OVERLAY_SELECTOR) ||
      document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden), .ant-popover:not(.ant-popover-hidden)'
      )
    ) {
      return
    }
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
              <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-error)' }} />
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
  gap: 8px;
  margin-top: 6px;
  padding: 6px 1px 0;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 12px;
`

const FooterText = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  gap: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
`

const PinButtonArea = styled.div`
  cursor: pointer;
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;

  &:hover {
    background: var(--color-background-mute);
  }
`

const Tag = styled(AntdTag)`
  cursor: pointer;
  display: flex;
  min-width: 0;
  max-width: 188px;
  height: 26px;
  align-items: center;
  gap: 5px;
  margin-inline-end: 0;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s ease-in-out;

  .ant-tag-icon {
    display: inline-flex;
    flex-shrink: 0;
  }

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-primary);
  }
`

export default Footer
