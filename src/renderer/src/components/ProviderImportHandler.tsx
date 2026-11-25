import { TopView } from '@renderer/components/TopView'
import { markOnboardingCompleted } from '@renderer/hooks/useOnboardingState'
import ProviderImportPopup from '@renderer/pages/settings/ProviderSettings/ProviderImportPopup'
import { assertPersistCommitted } from '@renderer/services/mobile/credentials'
import { providerImportQueue, startProviderImportListener } from '@renderer/services/ProviderImportQueue'
import store, { persistor } from '@renderer/store'
import { importPlatformProvider, type LlmImportSnapshot, restoreLlmImportSnapshot } from '@renderer/store/llm'
import { uuid } from '@renderer/utils'
import { matchesProviderImport, parseProviderImport, ProviderImportLimitError } from '@shared/providerImport'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

class ProviderImportPersistError extends Error {}

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
            const prevLlm = store.getState().llm
            const existing = prevLlm.providers.find((p) => matchesProviderImport(p, incoming))
            const prevSnapshot: LlmImportSnapshot = {
              providers: prevLlm.providers,
              platformModels: prevLlm.platformModels,
              modelCatalogExclusions: prevLlm.modelCatalogExclusions,
              defaultModel: prevLlm.defaultModel
            }
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
            try {
              await persistor.flush()
              await assertPersistCommitted()
            } catch {
              store.dispatch(restoreLlmImportSnapshot(prevSnapshot))
              await persistor.flush().catch(() => {})
              await assertPersistCommitted().catch(() => {})
              throw new ProviderImportPersistError()
            }
            while (TopView.back()) {
              // Unwind any underlying popup (GeneralPopup / SearchPopup) cleanly so Promises resolve.
            }
            markOnboardingCompleted()
            current.current.navigate(`/settings/provider?id=${encodeURIComponent(provider.id)}`)
            window.toast.success(
              current.current.t(existing ? 'settings.provider.import_duplicate' : 'settings.provider.import_success')
            )
          } catch (error) {
            // Neither raw URLs nor credentials appear in logs, navigation or error text.
            window.toast.error(
              current.current.t(
                error instanceof ProviderImportLimitError
                  ? 'settings.provider.import_too_large'
                  : error instanceof ProviderImportPersistError
                    ? 'settings.provider.import_save_failed'
                    : 'settings.provider.import_invalid'
              )
            )
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
