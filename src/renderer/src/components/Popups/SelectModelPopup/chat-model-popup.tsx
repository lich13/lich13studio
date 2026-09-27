import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'
import { resolveModelProviderSelection, selectionFromModel } from '@shared/modelProviderSelection'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createModelPopup } from './base-popup'

interface PopupParams {
  model?: Model
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
}

const PopupContainer = ({ model, filter, resolve }: PopupParams & { resolve: (value: Model | undefined) => void }) => {
  const { t } = useTranslation()
  const llm = useAppSelector((state) => state.llm)
  const [selection, setSelection] = useState(() => selectionFromModel(model, llm.providers))
  const [open, setOpen] = useState(true)
  const resolved = resolveModelProviderSelection(selection, llm)
  const close = (value?: Model) => {
    resolve(value)
    setOpen(false)
  }
  return (
    <Modal
      centered
      open={open}
      title={t('button.select_model')}
      onCancel={() => close()}
      afterClose={() => SelectChatModelPopup.hide()}
      onOk={() => close(resolved.model)}
      okButtonProps={{ disabled: !resolved.model || Boolean(filter && !filter(resolved.model)) }}>
      <ModelProviderSelect selection={selection} onChange={setSelection} filter={filter} />
    </Modal>
  )
}

export const SelectChatModelPopup = createModelPopup<PopupParams, Model>(PopupContainer)
