import { Modal } from 'antd'
import { lazy, Suspense, useState } from 'react'

import { TopView } from '../TopView'

const HistoryPage = lazy(() => import('@renderer/pages/history/HistoryPage'))

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)

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
      width={700}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 16
        },
        body: {
          height: '80vh',
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      centered
      closable={false}
      footer={null}>
      <Suspense fallback={null}>
        <HistoryPage />
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
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide('SearchPopup')
          }}
        />,
        'SearchPopup'
      )
    })
  }
}
