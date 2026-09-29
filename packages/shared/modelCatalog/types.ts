import type { ProviderPlatform } from '../platforms'
import type { ReasoningEffort } from '../reasoning'

export const CATALOG_PARSER_VERSION = 1
export const CATALOG_INTERVAL = 60 * 60 * 1000
export type CatalogCapability =
  | 'text'
  | 'vision'
  | 'reasoning'
  | 'function_calling'
  | 'embedding'
  | 'rerank'
  | 'imageGeneration'
  | 'fileInput'

export interface OfficialModel {
  id: string
  name: string
  aliases: string[]
  input: string[]
  output: string[]
  capabilities: Partial<Record<CatalogCapability, boolean>>
  efforts?: ReasoningEffort[]
  thinking?: 'adaptive' | 'budget'
}

export interface PlatformModelCatalogSnapshot {
  parserVersion: number
  platform: ProviderPlatform
  revision: string
  release?: string
  sha256: string
  sources: { url: string; sha256: string }[]
  models: OfficialModel[]
}

export class ModelCatalogError extends Error {
  constructor(
    public readonly code: 'network' | 'invalid-data' | 'cache',
    message: string
  ) {
    super(message)
    this.name = 'ModelCatalogError'
  }
}

export const normalizeCatalogId = (id: string) =>
  id
    .trim()
    .toLowerCase()
    .split('/')
    .pop()!
    .replaceAll('_', '-')
    .replace(/(?<=\d)\.(?=\d)/g, '-')

export function validateCatalog(value: unknown): asserts value is PlatformModelCatalogSnapshot {
  const snapshot = value as PlatformModelCatalogSnapshot
  const fail = () => {
    throw new ModelCatalogError('invalid-data', 'Invalid model catalog')
  }
  const validId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id)
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  if (
    !snapshot ||
    snapshot.parserVersion !== CATALOG_PARSER_VERSION ||
    !['openai', 'grok', 'anthropic'].includes(snapshot.platform) ||
    !validId(snapshot.revision) ||
    !hash(snapshot.sha256) ||
    !Array.isArray(snapshot.sources) ||
    !snapshot.sources.length ||
    snapshot.sources.length > 128 ||
    !Array.isArray(snapshot.models) ||
    !snapshot.models.length ||
    snapshot.models.length > 512
  )
    fail()
  if (
    snapshot.sources.some(
      (source) => !source || !hash(source.sha256) || typeof source.url !== 'string' || !/^https:\/\//.test(source.url)
    )
  )
    fail()
  const ids = new Set<string>()
  const aliases = new Map<string, string>()
  for (const model of snapshot.models) {
    if (
      !model ||
      !validId(model.id) ||
      ids.has(model.id) ||
      typeof model.name !== 'string' ||
      !model.name ||
      model.name.length > 256 ||
      !Array.isArray(model.aliases) ||
      !model.aliases.every(validId) ||
      model.aliases.length > 100 ||
      !Array.isArray(model.input) ||
      !Array.isArray(model.output) ||
      !model.output.includes('text') ||
      [...model.input, ...model.output].some((mode) => !['text', 'image', 'audio', 'video', 'file'].includes(mode)) ||
      !model.capabilities ||
      typeof model.capabilities !== 'object'
    )
      fail()
    ids.add(model.id)
    for (const [capability, enabled] of Object.entries(model.capabilities))
      if (
        ![
          'text',
          'vision',
          'reasoning',
          'function_calling',
          'embedding',
          'rerank',
          'imageGeneration',
          'fileInput'
        ].includes(capability) ||
        typeof enabled !== 'boolean'
      )
        fail()
    if (model.thinking !== undefined && !['adaptive', 'budget'].includes(model.thinking)) fail()
    if (
      model.efforts !== undefined &&
      (!Array.isArray(model.efforts) ||
        !model.efforts.every((effort) => ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) ||
        new Set(model.efforts).size !== model.efforts.length)
    )
      fail()
    for (const id of [model.id, ...model.aliases]) {
      const key = normalizeCatalogId(id)
      if (aliases.has(key) && aliases.get(key) !== model.id) fail()
      aliases.set(key, model.id)
    }
  }
}

export async function catalogDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function canonicalModels(models: OfficialModel[]) {
  return models
    .map((model) => ({
      ...model,
      aliases: [...model.aliases].sort(),
      input: [...model.input].sort(),
      output: [...model.output].sort(),
      capabilities: Object.fromEntries(Object.entries(model.capabilities).sort(([a], [b]) => a.localeCompare(b)))
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
}
