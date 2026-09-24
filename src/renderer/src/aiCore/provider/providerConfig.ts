import { getProviderByModel } from '@renderer/services/AssistantService'
import { getPlatformHeaders } from '@renderer/services/CliVersionService'
import { type Model, type Provider, ProviderTypeSchema } from '@renderer/types'
import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import { inferProviderPlatform } from '@shared/platforms'
import { providerFetch } from '@shared/providerFetch'
import { normalizeProviderEndpoint, providerRequestBase } from '@shared/providerImport'
import { defaultAppHeaders } from '@shared/utils'

import type { ProviderConfig } from '../types'
import { getAiSdkProviderId } from './factory'

export function formatProviderApiHost(provider: Provider): Provider {
  ProviderTypeSchema.parse(provider.type)
  const apiHost = normalizeProviderEndpoint(provider.apiHost)
  const extra_headers = getPlatformHeaders(inferProviderPlatform(provider), provider.cliVersion, provider.extra_headers)
  return { ...provider, apiHost, extra_headers }
}

export function providerToAiSdkConfig(
  provider: Provider,
  _model: Model
): ProviderConfig<'openai'> | ProviderConfig<'anthropic'> {
  void _model
  const nativeFetch = getTauriNativeFetch()
  return {
    providerId: getAiSdkProviderId(provider),
    providerSettings: {
      baseURL: providerRequestBase(provider.apiHost),
      apiKey: provider.apiKey,
      headers: { ...defaultAppHeaders(), ...provider.extra_headers },
      fetch: providerFetch(
        provider.apiHost,
        getPlatformHeaders(inferProviderPlatform(provider), provider.cliVersion),
        nativeFetch ?? fetch
      )
    }
  }
}

export function getActualProvider(model: Model): Provider {
  return adaptProvider({ provider: getProviderByModel(model), model })
}

export function adaptProvider({ provider }: { provider: Provider; model?: Model }): Provider {
  return formatProviderApiHost(provider)
}

export function isModernSdkSupported(provider: Provider): boolean {
  return ProviderTypeSchema.safeParse(provider.type).success
}
