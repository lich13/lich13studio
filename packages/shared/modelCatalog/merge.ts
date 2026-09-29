import type { PlatformModel, ProviderPlatform } from '../platforms'
import type { OfficialModel } from './types'

export type ModelCatalogExclusions = Record<ProviderPlatform, string[]>
export const emptyCatalogExclusions = (): ModelCatalogExclusions => ({ openai: [], grok: [], anthropic: [] })

export function mergeCatalogModels(
  current: PlatformModel[],
  incoming: OfficialModel[],
  excluded: readonly string[],
  platform: ProviderPlatform
): PlatformModel[] {
  const ids = new Set([...current.map((model) => model.id), ...excluded])
  return [
    ...current,
    ...incoming
      .filter((model) => !ids.has(model.id))
      .map((model) => ({
        id: model.id,
        name: model.name,
        group: platform === 'openai' ? 'OpenAI' : platform === 'anthropic' ? 'Anthropic' : 'grok'
      }))
  ]
}

export function recordCatalogEdits(
  current: PlatformModel[],
  next: PlatformModel[],
  excluded: readonly string[]
): string[] {
  const remaining = new Set(next.map((model) => model.id))
  return [
    ...new Set([...excluded, ...current.filter((model) => !remaining.has(model.id)).map((model) => model.id)])
  ].filter((id) => !remaining.has(id))
}
