import type { ProviderPlatform } from '../platforms'
import bundled from './bundled.json'
import { normalizeCatalogId, type OfficialModel, type PlatformModelCatalogSnapshot, validateCatalog } from './types'

export const bundledModelCatalogs = bundled as Record<ProviderPlatform, PlatformModelCatalogSnapshot>
const catalogs = { ...bundledModelCatalogs }
const indexes = new Map<ProviderPlatform, Map<string, OfficialModel>>()

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child)
  }
  return value
}

/** Updated before the matching Redux action reaches subscribers, including other windows. */
export function installModelCatalog(snapshot: PlatformModelCatalogSnapshot) {
  validateCatalog(snapshot)
  catalogs[snapshot.platform] = deepFreeze(structuredClone(snapshot))
  indexes.delete(snapshot.platform)
}

export function findOfficialModel(id: string, platform?: ProviderPlatform): OfficialModel | undefined {
  const key = normalizeCatalogId(id)
  const matches: OfficialModel[] = []
  for (const source of platform ? [platform] : (['openai', 'grok', 'anthropic'] as const)) {
    let index = indexes.get(source)
    if (!index) {
      index = new Map()
      for (const model of catalogs[source].models)
        for (const alias of [model.id, ...model.aliases]) index.set(normalizeCatalogId(alias), model)
      indexes.set(source, index)
    }
    const entry = index.get(key) ?? index.get(key.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, ''))
    if (entry) matches.push(entry)
  }
  return matches.length === 1 ? matches[0] : undefined
}
