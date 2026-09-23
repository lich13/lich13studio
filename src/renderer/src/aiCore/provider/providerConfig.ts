import { getProviderByModel } from '@renderer/services/AssistantService'
import { type Model, type Provider, ProviderTypeSchema } from '@renderer/types'
import { formatApiHost, isWithTrailingSharp } from '@renderer/utils/api'
import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import { defaultAppHeaders } from '@shared/utils'

import type { ProviderConfig } from '../types'
import { getAiSdkProviderId } from './factory'

export function formatProviderApiHost(provider: Provider): Provider {
  ProviderTypeSchema.parse(provider.type)
  const apiHost = formatApiHost(provider.apiHost, !isWithTrailingSharp(provider.apiHost))
  const extra_headers = { ...provider.extra_headers }
  delete extra_headers['User-Agent']
  delete extra_headers['user-agent']
  if (provider.userAgent?.trim()) extra_headers['User-Agent'] = provider.userAgent.trim()
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
      baseURL: provider.apiHost,
      apiKey: provider.apiKey,
      headers: { ...defaultAppHeaders(), ...provider.extra_headers },
      ...(nativeFetch ? { fetch: nativeFetch } : {})
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
