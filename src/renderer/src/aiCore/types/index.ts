import type { ProviderId, ProviderSettingsMap } from '@cherrystudio/ai-core'

export type AppProviderSettingsMap = ProviderSettingsMap

export interface ProviderConfig<T extends ProviderId = ProviderId> {
  providerId: T
  providerSettings: ProviderSettingsMap[T]
}

export interface ProviderCapabilities {
  enableReasoning: boolean
  enableUrlContext: boolean
}

export type CompletionsResult = {
  getText: () => string
  usage?: any
}
