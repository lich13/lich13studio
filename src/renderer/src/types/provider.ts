import type { ProviderPlatform } from '@shared/platforms'
import type { Model } from '@types'

import type { OpenAIVerbosity } from './aiCoreTypes'

export type ProviderType = 'openai-response' | 'anthropic'

export const ProviderTypeSchema = {
  parse(value: unknown): ProviderType {
    if (value === 'openai-response' || value === 'anthropic') {
      return value
    }
    throw new Error(`Invalid provider type: ${String(value)}`)
  },
  safeParse(value: unknown): { success: true; data: ProviderType } | { success: false; error: Error } {
    if (value === 'openai-response' || value === 'anthropic') {
      return { success: true, data: value }
    }
    return { success: false, error: new Error(`Invalid provider type: ${String(value)}`) }
  }
} as const

// undefined is treated as supported, enabled by default
export type ProviderApiOptions = {
  /** Whether message content of array type is not supported */
  isNotSupportArrayContent?: boolean
  /** Whether the stream_options parameter is not supported */
  isNotSupportStreamOptions?: boolean
  /**
   * @deprecated
   * Whether message role 'developer' is not supported */
  isNotSupportDeveloperRole?: boolean
  /* Whether message role 'developer' is supported */
  isSupportDeveloperRole?: boolean
  /**
   * @deprecated
   * Whether the service_tier parameter is not supported. Only for OpenAI Models. */
  isNotSupportServiceTier?: boolean
  /* Whether the service_tier parameter is supported. Only for OpenAI Models. */
  isSupportServiceTier?: boolean
  /** Whether the enable_thinking parameter is not supported */
  isNotSupportEnableThinking?: boolean
  /** Whether APIVersion is not supported */
  isNotSupportAPIVersion?: boolean
  /** Whether verbosity is not supported. For OpenAI API (completions & responses). */
  isNotSupportVerbosity?: boolean
}

// scale is not well supported now. It even lacks of docs
// We take undefined as same as default, and null as same as explicitly off.
// It controls whether the response contains the serviceTier field or not, so undefined and null should be separated.
export type OpenAIServiceTier = 'auto' | 'default' | 'flex' | 'priority' | null | undefined

export const OpenAIServiceTiers = {
  auto: 'auto',
  default: 'default',
  flex: 'flex',
  priority: 'priority'
} as const satisfies Record<NonNullable<OpenAIServiceTier>, OpenAIServiceTier>

export function isOpenAIServiceTier(tier: string | null | undefined): tier is OpenAIServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(OpenAIServiceTiers, tier)
}

// https://console.groq.com/docs/api-reference#responses
// null is not used.
export type GroqServiceTier = 'auto' | 'on_demand' | 'flex' | undefined | null

export const GroqServiceTiers = {
  auto: 'auto',
  on_demand: 'on_demand',
  flex: 'flex'
} as const satisfies Record<string, GroqServiceTier>

export function isGroqServiceTier(tier: string | undefined | null): tier is GroqServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(GroqServiceTiers, tier)
}

export type ServiceTier = OpenAIServiceTier | GroqServiceTier

export type AnthropicCacheControlSettings = {
  tokenThreshold: number
  cacheSystemMessage: boolean
  cacheLastNMessages: number
}

export function isServiceTier(tier: string | null | undefined): tier is ServiceTier {
  return isGroqServiceTier(tier) || isOpenAIServiceTier(tier)
}

export const AwsBedrockAuthTypes = {
  iam: 'iam',
  apiKey: 'apiKey'
} as const

export type AwsBedrockAuthType = keyof typeof AwsBedrockAuthTypes

export function isAwsBedrockAuthType(type: string): type is AwsBedrockAuthType {
  return Object.hasOwn(AwsBedrockAuthTypes, type)
}

export type Provider = {
  id: string
  type: ProviderType
  platform?: ProviderPlatform
  /** Resolved from platform state; never persisted on the service provider. */
  cliVersion?: string
  name: string
  apiKey: string
  apiHost: string
  anthropicApiHost?: string
  isAnthropicModel?: (m: Model) => boolean
  apiVersion?: string
  models: Model[]
  enabled?: boolean
  isSystem?: boolean
  isAuthed?: boolean
  rateLimit?: number

  // API options
  apiOptions?: ProviderApiOptions
  serviceTier?: ServiceTier
  verbosity?: OpenAIVerbosity

  /** @deprecated */
  isNotSupportArrayContent?: boolean
  /** @deprecated */
  isNotSupportStreamOptions?: boolean
  /** @deprecated */
  isNotSupportDeveloperRole?: boolean
  /** @deprecated */
  isNotSupportServiceTier?: boolean

  authType?: 'apiKey' | 'oauth'
  isVertex?: boolean
  notes?: string
  extra_headers?: Record<string, string>

  // Anthropic prompt caching settings
  anthropicCacheControl?: AnthropicCacheControlSettings
}

export const SystemProviderIds = {
  cherryin: 'cherryin',
  silicon: 'silicon',
  aihubmix: 'aihubmix',
  ocoolai: 'ocoolai',
  deepseek: 'deepseek',
  ppio: 'ppio',
  alayanew: 'alayanew',
  qiniu: 'qiniu',
  dmxapi: 'dmxapi',
  burncloud: 'burncloud',
  tokenflux: 'tokenflux',
  '302ai': '302ai',
  cephalon: 'cephalon',
  lanyun: 'lanyun',
  ph8: 'ph8',
  sophnet: 'sophnet',
  openrouter: 'openrouter',
  ollama: 'ollama',
  ovms: 'ovms',
  'new-api': 'new-api',
  lmstudio: 'lmstudio',
  anthropic: 'anthropic',
  openai: 'openai',
  'azure-openai': 'azure-openai',
  gemini: 'gemini',
  vertexai: 'vertexai',
  github: 'github',
  copilot: 'copilot',
  zhipu: 'zhipu',
  yi: 'yi',
  moonshot: 'moonshot',
  baichuan: 'baichuan',
  dashscope: 'dashscope',
  stepfun: 'stepfun',
  doubao: 'doubao',
  infini: 'infini',
  minimax: 'minimax',
  groq: 'groq',
  together: 'together',
  fireworks: 'fireworks',
  nvidia: 'nvidia',
  grok: 'grok',
  hyperbolic: 'hyperbolic',
  mistral: 'mistral',
  jina: 'jina',
  perplexity: 'perplexity',
  modelscope: 'modelscope',
  xirang: 'xirang',
  hunyuan: 'hunyuan',
  'tencent-cloud-ti': 'tencent-cloud-ti',
  'baidu-cloud': 'baidu-cloud',
  gpustack: 'gpustack',
  voyageai: 'voyageai',
  'aws-bedrock': 'aws-bedrock',
  poe: 'poe',
  aionly: 'aionly',
  longcat: 'longcat',
  huggingface: 'huggingface',
  gateway: 'gateway',
  cerebras: 'cerebras',
  mimo: 'mimo',
  'minimax-global': 'minimax-global',
  zai: 'zai'
} as const

export type SystemProviderId = keyof typeof SystemProviderIds

export const isSystemProviderId = (id: string): id is SystemProviderId => {
  return Object.hasOwn(SystemProviderIds, id)
}

type SystemProviderIdTypeMap = typeof SystemProviderIds

export type SystemProvider = Provider & {
  id: SystemProviderId
  isSystem: true
  apiOptions?: never
}

export type VertexProvider = Provider & {
  googleCredentials: {
    privateKey: string
    clientEmail: string
  }
  project: string
  location: string
}

export type AzureOpenAIProvider = Provider & {
  type: 'azure-openai'
  apiVersion: string
}

/**
 * 判断是否为系统内置的提供商。比直接使用`provider.isSystem`更好，因为该数据字段不会随着版本更新而变化。
 * @param provider - Provider对象，包含提供商的信息
 * @returns 是否为系统内置提供商
 */
export const isSystemProvider = (provider: Provider): provider is SystemProvider => {
  return isSystemProviderId(provider.id) && !!provider.isSystem
}

export type GroqSystemProvider = Provider & {
  id: SystemProviderIdTypeMap['groq']
  isSystem: true
}

export type NotGroqProvider = Provider & {
  id: Exclude<string, SystemProviderIdTypeMap['groq']>
}

export const isGroqSystemProvider = (provider: Provider): provider is GroqSystemProvider => {
  return provider.id === SystemProviderIds.groq
}
