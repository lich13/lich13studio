import ProviderImportPopup from '@renderer/pages/settings/ProviderSettings/ProviderImportPopup'
import { providerImportQueue, startProviderImportListener } from '@renderer/services/ProviderImportQueue'
import store from '@renderer/store'
import { importPlatformProvider } from '@renderer/store/llm'
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
            const incoming = await ProviderImportPopup.show(parseProviderImport(raw))
            if (!incoming) continue
            const existing = store.getState().llm.providers.find((p) => matchesProviderImport(p, incoming))
            const provider = existing
              ? { ...existing, models: [] }
              : {
                  id: uuid(),
                  name: incoming.name,
                  platform: incoming.platform,
                  type: incoming.type,
                  apiKey: incoming.apiKey,
                  apiHost: incoming.apiHost,
                  models: [],
                  enabled: true,
                  isSystem: false
                }
            store.dispatch(importPlatformProvider({ provider, models: incoming.models, primaryModel: incoming.model }))
            current.current.navigate(`/settings/provider?id=${encodeURIComponent(provider.id)}`)
            window.toast.success(
              current.current.t(existing ? 'settings.provider.import_duplicate' : 'settings.provider.import_success')
            )
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
