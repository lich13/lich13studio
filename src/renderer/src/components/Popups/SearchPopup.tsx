import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { Modal } from 'antd'
import { lazy, Suspense, useState } from 'react'

import { TopView } from '../TopView'

const HistoryPage = lazy(() => import('@renderer/pages/history/HistoryPage'))

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const isMobile = runtimeCapabilities.android

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  SearchPopup.hide = onCancel

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      title={null}
      width={isMobile ? '100vw' : 700}
      style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 } : undefined}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: isMobile ? 0 : 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: isMobile ? 0 : 16
        },
        body: {
          height: isMobile ? 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))' : '80vh',
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      centered={!isMobile}
      closable={false}
      footer={null}>
      <Suspense fallback={null}>
        <HistoryPage onClose={isMobile ? onCancel : undefined} />
      </Suspense>
    </Modal>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('SearchPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      const finish = (v: any = {}) => {
        resolve(v)
        TopView.hide('SearchPopup')
      }
      TopView.show(<PopupContainer resolve={finish} />, 'SearchPopup', () => finish({}))
    })
  }
}
