import type { Model } from '@types'

import { inferProviderPlatform, type PlatformModels, type ProviderPlatform, type StoredProvider } from './platforms'

/** Preferences only: never persist a running task, provider credentials or test output. */
export interface ModelTestSelection {
  platform?: ProviderPlatform
  modelId?: string
  providerId?: string
}

export interface ModelTestCatalog {
  providers: StoredProvider[]
  platformModels: PlatformModels
  defaultModel?: Model
}

export function initialModelTestSelection(
  catalog: Pick<ModelTestCatalog, 'providers' | 'defaultModel'>
): ModelTestSelection {
  const model = catalog.defaultModel
  if (!model?.id) return {}
  const provider = catalog.providers.find((item) => item.id === model.provider)
  return {
    modelId: model.id,
    providerId: model.provider,
    platform: provider ? inferProviderPlatform(provider) : undefined
  }
}

/** A missing or incompatible selection stays visible and must be corrected explicitly. */
export function resolveModelTestSelection(selection: ModelTestSelection, catalog: ModelTestCatalog) {
  const definition = selection.platform
    ? catalog.platformModels[selection.platform]?.find((model) => model.id === selection.modelId)
    : undefined
  const providers = catalog.providers.filter(
    (provider) => provider.enabled && inferProviderPlatform(provider) === selection.platform
  )
  const provider = providers.find((item) => item.id === selection.providerId)
  const issue = !definition ? 'modelUnavailable' : !provider ? 'providerUnavailable' : undefined
  const model: Model | undefined = definition && provider ? { ...definition, provider: provider.id } : undefined
  return { model, providers, provider, issue }
}
