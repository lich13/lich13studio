import type { Model, Provider } from '@renderer/types'

/** Compatibility for legacy callers: models are managed locally per platform. */
export async function listModels(provider: Provider, _abortSignal?: AbortSignal): Promise<Model[]> {
  return provider.models
}
