import { type Provider, ProviderTypeSchema } from '@renderer/types'

export function getAiSdkProviderId(provider: Provider): 'openai' | 'anthropic' {
  const type = ProviderTypeSchema.parse(provider.type)
  return type === 'anthropic' ? 'anthropic' : 'openai'
}
