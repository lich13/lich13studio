import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LlmApiKeyList } from './list'

interface ShowParams {
  providerId: string
  title?: string
  providerType?: 'llm'
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

const PopupContainer: React.FC<Props> = ({ providerId, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  return (
    <Modal
      title={title || t('settings.provider.api.key.list.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      width={600}
      footer={null}>
      <LlmApiKeyList providerId={providerId} />
    </Modal>
  )
}

const TopViewKey = 'ApiKeyListPopup'

export default class ApiKeyListPopup {
  static topviewId = 0

  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
