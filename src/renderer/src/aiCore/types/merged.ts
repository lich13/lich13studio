import type { RuntimeConfig } from '@cherrystudio/ai-core/core'
import type { ModelConfig } from '@cherrystudio/ai-core/core/models/types'
import type { RuntimeExecutor } from '@cherrystudio/ai-core/core/runtime'
import type {
  ExtensionConfigToIdResolutionMap,
  ExtensionToSettingsMap,
  ExtractProviderIds,
  ProviderExtensionConfig,
  StringKeys,
  UnionToIntersection
} from '@cherrystudio/ai-core/provider'
import { coreExtensions } from '@cherrystudio/ai-core/provider'

const allExtensions = coreExtensions

type AllExtensionConfigs = (typeof allExtensions)[number]['config']

type KnownAppProviderId = ExtractProviderIds<AllExtensionConfigs>
export type AppProviderId = KnownAppProviderId | (string & {})

export type AppProviderSettingsMap = UnionToIntersection<ExtensionToSettingsMap<(typeof allExtensions)[number]>>

export function isRegisteredProviderId(id: string): boolean {
  return allExtensions.some((ext) => ext.hasProviderId(id))
}

export function getAllProviderIds(): string[] {
  return allExtensions.flatMap((ext) => ext.getProviderIds())
}

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<AllExtensionConfigs>>

function buildAppProviderIds(): ProviderIdsMap {
  const map = {} as ProviderIdsMap

  allExtensions.forEach((ext) => {
    const config = ext.config as ProviderExtensionConfig<any, any, KnownAppProviderId>
    const name = config.name
    ;(map as Record<string, KnownAppProviderId>)[name] = name

    if (config.aliases) {
      config.aliases.forEach((alias) => {
        ;(map as Record<string, KnownAppProviderId>)[alias] = name
      })
    }

    if (config.variants) {
      config.variants.forEach((variant) => {
        const variantId = `${name}-${variant.suffix}` as KnownAppProviderId
        ;(map as Record<string, KnownAppProviderId>)[variantId] = variantId
      })
    }
  })

  return map
}

export const appProviderIds = buildAppProviderIds()

export type AppModelConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  ModelConfig<T, AppProviderSettingsMap>

export type AppRuntimeConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  RuntimeConfig<AppProviderSettingsMap, T>

export type AppRuntimeExecutor = RuntimeExecutor<AppProviderSettingsMap>
