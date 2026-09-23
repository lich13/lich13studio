import ManageModelsPopup from '@renderer/pages/settings/ProviderSettings/ModelList/ManageModelsPopup'
import UrlSchemaInfoPopup from '@renderer/pages/settings/ProviderSettings/UrlSchemaInfoPopup'
import { providerImportQueue, startProviderImportListener } from '@renderer/services/ProviderImportQueue'
import store from '@renderer/store'
import { addProvider, setDefaultModel } from '@renderer/store/llm'
import { uuid } from '@renderer/utils'
import { matchesProviderImport, parseProviderImport } from '@shared/providerImport'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

export default function ProviderImportHandler() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const current = useRef({ navigate, t })
  current.current = { navigate, t }
  useEffect(() => {
    startProviderImportListener()
    let processing = false
    const drain = async () => {
      if (processing) return
      processing = true
      try {
        let raw: string | undefined
        while ((raw = providerImportQueue.take()) !== undefined) {
          try {
            const incoming = parseProviderImport(raw)
            const existing = store.getState().llm.providers.find((p) => matchesProviderImport(p, incoming))
            if (existing) {
              current.current.navigate(`/settings/provider?id=${encodeURIComponent(existing.id)}`)
              window.toast.info(current.current.t('settings.provider.import_duplicate'))
              continue
            }
            const id = uuid()
            const { updatedProvider } = await UrlSchemaInfoPopup.show({
              id,
              name: incoming.name,
              type: incoming.type,
              apiKey: incoming.apiKey,
              baseUrl: incoming.apiHost
            })
            if (!updatedProvider) continue
            if (incoming.model)
              updatedProvider.models = [
                { id: incoming.model, name: incoming.model, provider: id, group: incoming.name }
              ]
            store.dispatch(addProvider(updatedProvider))
            if (!store.getState().llm.defaultModel?.id && updatedProvider.models[0])
              store.dispatch(setDefaultModel({ model: updatedProvider.models[0] }))
            current.current.navigate(`/settings/provider?id=${encodeURIComponent(id)}`)
            window.toast.success(current.current.t('settings.provider.import_success'))
            if (!incoming.model) await ManageModelsPopup.show({ providerId: id })
          } catch {
            // Neither raw URLs nor credentials appear in logs, navigation or error text.
            window.toast.error(current.current.t('settings.provider.import_invalid'))
          } finally {
            providerImportQueue.complete(raw)
          }
        }
      } finally {
        processing = false
      }
    }
    return providerImportQueue.subscribe(() => {
      void drain()
    })
  }, [])
  return null
}
