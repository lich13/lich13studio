import AnthropicProviderLogo from '@renderer/assets/images/providers/anthropic.png'
import GrokProviderLogo from '@renderer/assets/images/providers/grok.png'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import type { SystemProvider } from '@renderer/types'
import type { ProviderPlatform } from '@shared/platforms'

export const SYSTEM_PROVIDERS: SystemProvider[] = []

export const PROVIDER_LOGO_MAP: Record<ProviderPlatform, string> = {
  openai: OpenAiProviderLogo,
  grok: GrokProviderLogo,
  anthropic: AnthropicProviderLogo
}

export function getProviderLogo(providerId: string): string | undefined {
  return PROVIDER_LOGO_MAP[providerId as ProviderPlatform]
}
