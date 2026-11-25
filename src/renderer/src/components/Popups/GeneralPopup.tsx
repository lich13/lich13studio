import { TopView } from '@renderer/components/TopView'
import type { ModalProps } from 'antd'
import { Modal as AntdModal } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

interface ShowParams extends ModalProps {
  content: ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const activeClosers: Array<() => void> = []

const PopupContainer: React.FC<Props> = ({
  content,
  resolve,
  onOk: userOnOk,
  onCancel: userOnCancel,
  afterClose: userAfterClose,
  ...rest
}) => {
  const [open, setOpen] = useState(true)

  const onOk: ModalProps['onOk'] = (e) => {
    userOnOk?.(e)
    setOpen(false)
  }

  const onCancel: ModalProps['onCancel'] = (e) => {
    userOnCancel?.(e)
    setOpen(false)
  }

  const onClose = () => {
    userAfterClose?.()
    resolve({})
  }

  useEffect(() => {
    const close = () => setOpen(false)
    activeClosers.push(close)
    return () => {
      const index = activeClosers.lastIndexOf(close)
      if (index !== -1) activeClosers.splice(index, 1)
    }
  }, [])

  return (
    <Modal
      {...rest}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName={rest.transitionName ?? 'animation-move-down'}
      centered={rest.centered ?? true}>
      {content}
    </Modal>
  )
}

const Modal = styled(AntdModal)`
  .ant-modal-close {
    top: 8px;
  }
`

const TopViewKey = 'GeneralPopup'

/** 在这个 Popup 中展示任意内容 */
export default class GeneralPopup {
  static topviewId = 0
  static hide() {
    const closeTop = activeClosers.at(-1)
    if (closeTop) {
      closeTop()
    } else if (TopView.peekId()?.startsWith(`${TopViewKey}-`)) {
      TopView.back()
    }
  }
  static show(props: ShowParams) {
    const id = `${TopViewKey}-${++GeneralPopup.topviewId}`
    return new Promise<any>((resolve) => {
      let settled = false
      const finish = (v: any = {}) => {
        if (settled) return
        settled = true
        TopView.hide(id)
        resolve(v)
      }
      TopView.show(<PopupContainer {...props} resolve={finish} />, id, () => finish({}))
    })
  }
}
