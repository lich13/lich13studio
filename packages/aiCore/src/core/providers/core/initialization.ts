import type { AnthropicProvider, AnthropicProviderSettings } from '@ai-sdk/anthropic'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { OpenAIProvider, OpenAIProviderSettings } from '@ai-sdk/openai'
import { createOpenAI } from '@ai-sdk/openai'

import type { ExtensionConfigToIdResolutionMap, ExtractExtensionIds, UnionToIntersection } from '../types'
import { extensionRegistry } from './ExtensionRegistry'
import type { ProviderExtensionConfig } from './ProviderExtension'
import { ProviderExtension } from './ProviderExtension'

const AnthropicExtension = ProviderExtension.create({
  name: 'anthropic',
  aliases: ['claude'] as const,
  supportsImageGeneration: false,
  create: createAnthropic,
  toolFactories: {
    urlContext:
      (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webFetch_20260209']>[0]>) => ({
        tools: { urlContext: provider.tools.webFetch_20260209(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<AnthropicProviderSettings, AnthropicProvider, 'anthropic'>)

const OpenAIExtension = ProviderExtension.create({
  name: 'openai',
  aliases: ['openai-response'] as const,
  supportsImageGeneration: true,
  create: createOpenAI,
  toolFactories: {},
  variants: [
    {
      suffix: 'chat',
      name: 'OpenAI Chat',
      resolveModel: (provider: OpenAIProvider, modelId: string) => provider.chat(modelId),
      toolFactories: {}
    }
  ] as const
} as const satisfies ProviderExtensionConfig<OpenAIProviderSettings, OpenAIProvider, 'openai'>)

export const coreExtensions = [OpenAIExtension, AnthropicExtension] as const

export type CoreProviderId = ExtractExtensionIds<(typeof coreExtensions)[number]>

type ExtensionConfigs = (typeof coreExtensions)[number]['config']

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<ExtensionConfigs>>

export const registeredProviderIds: ProviderIdsMap = (() => {
  const map = {} as ProviderIdsMap
  coreExtensions.forEach((ext) => {
    const config = ext.config as ProviderExtensionConfig<any, any, CoreProviderId>
    const name = config.name
    ;(map as Record<string, CoreProviderId>)[name] = name

    if (config.aliases) {
      config.aliases.forEach((alias) => {
        ;(map as Record<string, CoreProviderId>)[alias] = name
      })
    }

    if (config.variants) {
      config.variants.forEach((variant) => {
        ;(map as Record<string, CoreProviderId>)[`${name}-${variant.suffix}`] = name
      })
    }
  })

  return map
})()

// register() is idempotent — safe to call on HMR / re-import
extensionRegistry.registerAll(coreExtensions)

class ProviderInitializationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderInitializationError'
  }
}

export function hasProviderConfig(providerId: string): boolean {
  return extensionRegistry.has(providerId)
}

export { ProviderInitializationError }
