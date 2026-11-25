import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import { TopView } from '@renderer/components/TopView'
import { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'
import { resolveModelProviderSelection, selectionFromModel } from '@shared/modelProviderSelection'
import { Modal } from 'antd'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const TopViewKey = 'SelectModelPopup'

const createModelPopup = <TProps extends object, TResult>(
  Component: React.ComponentType<TProps & { resolve: (value: TResult | undefined) => void }>
) => {
  return class {
    static hide() {
      TopView.hide(TopViewKey)
    }
    static show(params: Omit<TProps, 'resolve'>) {
      return new Promise<TResult | undefined>((resolve) => {
        const finish = (value?: TResult) => {
          resolve(value)
          TopView.hide(TopViewKey)
        }
        const props = { ...params, resolve: finish } as TProps & { resolve: (value: TResult | undefined) => void }
        TopView.show(<Component {...props} />, TopViewKey, () => finish(undefined))
      })
    }
  }
}

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
