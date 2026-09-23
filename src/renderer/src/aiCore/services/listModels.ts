import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getFromApi as aiSdkGetFromApi,
  zodSchema
} from '@ai-sdk/provider-utils'
import type { Model, Provider } from '@renderer/types'
import { ProviderTypeSchema } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import { normalizeImportEndpoint } from '@shared/providerImport'
import { defaultAppHeaders } from '@shared/utils'
import * as z from 'zod'

const ApiErrorSchema = z
  .object({
    error: z.object({ message: z.string().optional() }).loose().optional(),
    message: z.string().optional()
  })
  .loose()

// === Helpers ===

function getApiKey(provider: Provider): string {
  const keys = provider.apiKey.split(',').map((key) => key.trim())
  const keyName = `provider:${provider.id}:last_used_key`

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = window.keyv.get(keyName)
  if (!lastUsedKey) {
    window.keyv.set(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  window.keyv.set(keyName, nextKey)

  return nextKey
}

function defaultHeaders(provider: Provider): Record<string, string> {
  const apiKey = getApiKey(provider)
  return {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...provider.extra_headers
  }
}

function toModel(id: string, provider: Provider, extra?: Partial<Model>): Model {
  return {
    id,
    name: extra?.name || id,
    provider: provider.id,
    group: extra?.group || getDefaultGroupName(id, provider.id),
    ...extra
  }
}

function dedup<T>(items: T[], getId: (item: T) => string | undefined): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = getId(item)?.trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export async function listModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
  ProviderTypeSchema.parse(provider.type)
  const nativeFetch = getTauriNativeFetch()
  const { value } = await aiSdkGetFromApi({
    url: `${normalizeImportEndpoint(provider.apiHost)}/models`,
    headers: {
      ...defaultHeaders(provider),
      ...(provider.type === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {})
    },
    successfulResponseHandler: createJsonResponseHandler(
      zodSchema(
        z
          .object({
            data: z.array(
              z.object({ id: z.string(), display_name: z.string().optional(), name: z.string().optional() }).loose()
            )
          })
          .loose()
      )
    ),
    failedResponseHandler: createJsonErrorResponseHandler({
      errorSchema: zodSchema(ApiErrorSchema),
      errorToMessage: (error) => error.error?.message || error.message || 'Model listing failed'
    }),
    abortSignal,
    fetch: nativeFetch
  })
  return dedup(value.data, (item) => item.id).map((item) =>
    toModel(item.id, provider, { name: item.display_name || item.name || item.id })
  )
}
