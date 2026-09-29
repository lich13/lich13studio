import type { ProviderPlatform } from '../platforms'
import bundled from './bundled.json'
import { normalizeCatalogId, type OfficialModel, type PlatformModelCatalogSnapshot, validateCatalog } from './types'

export const bundledModelCatalogs = bundled as Record<ProviderPlatform, PlatformModelCatalogSnapshot>
const catalogs = { ...bundledModelCatalogs }
const indexes = new Map<ProviderPlatform, Map<string, OfficialModel>>()

/** Updated before the matching Redux action reaches subscribers, including other windows. */
export function installModelCatalog(snapshot: PlatformModelCatalogSnapshot) {
  validateCatalog(snapshot)
  const copy = JSON.parse(JSON.stringify(snapshot)) as PlatformModelCatalogSnapshot
  for (const model of copy.models) {
    Object.freeze(model.aliases)
    Object.freeze(model.input)
    Object.freeze(model.output)
    Object.freeze(model.capabilities)
    if (model.efforts) Object.freeze(model.efforts)
    Object.freeze(model)
  }
  Object.freeze(copy.models)
  catalogs[snapshot.platform] = Object.freeze(copy)
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
