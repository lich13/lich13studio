import type { Model, Provider } from '@renderer/types'

/** Compatibility for legacy callers: models are managed locally per platform. */
export async function listModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
  void abortSignal
  return provider.models
}
