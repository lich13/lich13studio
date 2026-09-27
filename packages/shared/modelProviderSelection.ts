import type { Assistant, Model } from '@types'

import { inferProviderPlatform, type PlatformModels, type ProviderPlatform, type StoredProvider } from './platforms'

export interface ModelProviderSelection {
  platform?: ProviderPlatform
  modelId?: string
  providerId?: string
}

export interface ModelProviderCatalog {
  providers: StoredProvider[]
  platformModels: PlatformModels
  defaultModel?: Model
}

export function selectionFromModel(model: Model | undefined, providers: StoredProvider[]): ModelProviderSelection {
  if (!model?.id) return {}
  const provider = providers.find((item) => item.id === model.provider)
  return {
    modelId: model.id,
    providerId: model.provider,
    platform: provider ? inferProviderPlatform(provider) : undefined
  }
}

export function assistantModelSelection(
  assistant: Pick<Assistant, 'modelSelection' | 'model' | 'defaultModel'>,
  catalog: ModelProviderCatalog
) {
  return (
    assistant.modelSelection ??
    selectionFromModel(assistant.model ?? assistant.defaultModel ?? catalog.defaultModel, catalog.providers)
  )
}

/** An invalid choice stays visible; no provider or model fallback is allowed. */
export function resolveModelProviderSelection(selection: ModelProviderSelection, catalog: ModelProviderCatalog) {
  const definition = selection.platform
    ? catalog.platformModels[selection.platform]?.find((model) => model.id === selection.modelId)
    : undefined
  const providers = catalog.providers.filter(
    (provider) => provider.enabled && inferProviderPlatform(provider) === selection.platform
  )
  const provider = providers.find((item) => item.id === selection.providerId)
  const issue = !definition ? 'modelUnavailable' : !provider ? 'providerUnavailable' : undefined
  const model: Model | undefined = definition && provider ? { ...definition, provider: provider.id } : undefined
  return { model, definition, providers, provider, issue }
}

/** Keep invalid selections truthy, so legacy consumers cannot fall back to a default. */
export function selectionModelReference(selection: ModelProviderSelection, catalog: ModelProviderCatalog): Model {
  const resolved = resolveModelProviderSelection(selection, catalog)
  return (
    resolved.model ?? {
      ...resolved.definition,
      id: selection.modelId || '',
      name: resolved.definition?.name || selection.modelId || '',
      group: resolved.definition?.group || '',
      provider: ''
    }
  )
}
