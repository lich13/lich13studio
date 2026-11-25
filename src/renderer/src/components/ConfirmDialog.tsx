import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { useMobileBack } from '@renderer/services/mobile/back'
import { Button } from 'antd'
import type { FC } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  x: number
  y: number
  message: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog: FC<Props> = ({ x, y, message, onConfirm, onCancel }) => {
  useMobileBack(true, onCancel)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99998] bg-transparent" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        data-confirm-dialog="true"
        className="-translate-x-1/2 -translate-y-full fixed z-[99999] mt-[-8px] transform"
        style={{
          left: `${x}px`,
          top: `${y}px`
        }}>
        <div className="flex min-w-[160px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
          <div className="mr-2 text-sm leading-[1.4]">{message}</div>
          <div className="flex justify-center gap-2">
            <Button
              onClick={onCancel}
              shape="circle"
              size="small"
              danger
              icon={<CloseOutlined />}
              style={{ width: 24, height: 24, minWidth: 24 }}
            />
            <Button
              onClick={onConfirm}
              shape="circle"
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              style={{ width: 24, height: 24, minWidth: 24, backgroundColor: '#52c41a' }}
            />
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

export default ConfirmDialog
