import type { ProviderType } from '@renderer/types'
import { isSystemProvider, type Provider, type SystemProviderId, SystemProviderIds } from '@renderer/types'

const NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS = [
  'deepseek',
  'baichuan',
  'minimax',
  'xirang',
  'poe',
  'cephalon'
] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 message 的 content 为数组类型。 Only for OpenAI Chat Completions API.
 */
export const isSupportArrayContentProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportArrayContent !== true &&
    !NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS = ['poe', 'qiniu'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 developer 作为 message role。 Only for OpenAI API.
 */
export const isSupportDeveloperRoleProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportDeveloperRole === true ||
    (isSystemProvider(provider) && !NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS = ['mistral'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 stream_options 参数。Only for OpenAI API.
 */
export const isSupportStreamOptionsProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportStreamOptions !== true &&
    !NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const SUPPORT_SERVICE_TIER_PROVIDERS = [
  SystemProviderIds.openai,
  SystemProviderIds['azure-openai'],
  SystemProviderIds.groq
]

/**
 * 判断提供商是否支持 service_tier 设置
 */
export const isSupportServiceTierProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportServiceTier === true ||
    (isSystemProvider(provider) && SUPPORT_SERVICE_TIER_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const NOT_SUPPORT_VERBOSITY_PROVIDERS = ['groq'] as const satisfies SystemProviderId[]

export const isSupportVerbosityProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportVerbosity !== true &&
    !NOT_SUPPORT_VERBOSITY_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const SUPPORT_URL_CONTEXT_PROVIDER_TYPES = ['anthropic'] as const satisfies ProviderType[]

export const isSupportUrlContextProvider = (provider: Provider) => {
  return (
    SUPPORT_URL_CONTEXT_PROVIDER_TYPES.some((type) => type === provider.type) ||
    provider.id === SystemProviderIds.cherryin
  )
}

export const isNewApiProvider = (provider: Provider) => {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id)
}

export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return provider.type === 'openai-response'
}

export const NOT_SUPPORT_API_KEY_PROVIDERS: readonly SystemProviderId[] = [
  'ollama',
  'lmstudio',
  'vertexai',
  'aws-bedrock',
  'copilot'
]

// https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration
export const isSupportAnthropicPromptCacheProvider = (provider: Provider) => {
  return (
    provider.type === 'anthropic' ||
    isNewApiProvider(provider) ||
    provider.id === SystemProviderIds.aihubmix ||
    provider.id === SystemProviderIds.openrouter
  )
}
