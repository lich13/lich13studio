import type { Model, Provider } from '@types'

import { stripIdentityHeaders } from './cliIdentity'

export const PROVIDER_PLATFORMS = ['openai', 'grok', 'anthropic'] as const
export type ProviderPlatform = (typeof PROVIDER_PLATFORMS)[number]
export const PLATFORM_NAMES: Record<ProviderPlatform, string> = {
  openai: 'OpenAI',
  grok: 'grok',
  anthropic: 'Anthropic'
}
export type PlatformModel = Omit<Model, 'provider'>
export type PlatformModels = Record<ProviderPlatform, PlatformModel[]>
export type StoredProvider = Omit<Provider, 'models' | 'userAgent' | 'cliVersion'>

export function platformProtocol(platform: ProviderPlatform): 'openai-response' | 'anthropic' {
  return platform === 'anthropic' ? 'anthropic' : 'openai-response'
}

export function inferProviderPlatform(provider: {
  platform?: string
  type: string
  apiHost?: string
  models?: { id: string }[]
}): ProviderPlatform {
  if (PROVIDER_PLATFORMS.includes(provider.platform as ProviderPlatform)) return provider.platform as ProviderPlatform
  if (provider.type === 'anthropic') return 'anthropic'
  if (provider.models?.some((model) => /^grok[-/]/i.test(model.id))) return 'grok'
  try {
    if (['api.x.ai', 'cli-chat-proxy.grok.com'].includes(new URL(provider.apiHost || '').hostname)) return 'grok'
  } catch {
    /* An incomplete address remains editable. */
  }
  return 'openai'
}

// Snapshot: Codex rust-v0.156.1 models with visibility=list; Sub2API a3eb7ef3
// Claude DefaultModels and Grok text models. Runtime updates never overwrite this catalog's user edits.
const SEED_IDS: Record<ProviderPlatform, string[]> = {
  openai: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
  grok: [
    'grok-4.7',
    'grok-4.6',
    'grok-4.5',
    'grok-4.3',
    'grok-build-0.1',
    'grok-composer-2.5-fast',
    'grok-4.20-0309-reasoning',
    'grok-4.20-0309-non-reasoning',
    'grok-4.20-multi-agent-0309'
  ],
  anthropic: [
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-opus-4-5-20251101',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001'
  ]
}

export function createPlatformModels(): PlatformModels {
  return Object.fromEntries(
    PROVIDER_PLATFORMS.map((platform) => [
      platform,
      SEED_IDS[platform].map((id) => ({ id, name: id, group: PLATFORM_NAMES[platform] }))
    ])
  ) as PlatformModels
}

export function catalogModel(model: PlatformModel | Model): PlatformModel {
  const { provider, ...definition } = model as Model
  void provider
  return definition
}

export function resolveProviders(llm: {
  providers: StoredProvider[]
  platformModels: PlatformModels
  cliVersions?: Partial<Record<ProviderPlatform, { version: string }>>
}): Provider[] {
  return llm.providers.map((provider) => {
    const platform = inferProviderPlatform(provider)
    return {
      ...provider,
      platform,
      type: platformProtocol(platform),
      cliVersion: llm.cliVersions?.[platform]?.version,
      models: (llm.platformModels[platform] ?? []).map((model) => ({ ...model, provider: provider.id }))
    }
  })
}

export function storedProvider(provider: StoredProvider | Provider): StoredProvider {
  const { models, userAgent, cliVersion, ...record } = provider as Provider & { userAgent?: string }
  void models
  void userAgent
  void cliVersion
  const platform = inferProviderPlatform(provider)
  return {
    ...record,
    platform,
    type: platformProtocol(platform),
    extra_headers: stripIdentityHeaders(record.extra_headers)
  }
}
