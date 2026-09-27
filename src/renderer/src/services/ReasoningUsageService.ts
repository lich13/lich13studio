import type { ReasoningEffort } from '@shared/reasoning'

export type ReasoningUsage = { requested: ReasoningEffort; effective: ReasoningEffort }
const usages = new Map<string, ReasoningUsage>()
const listeners = new Set<() => void>()
const key = (providerId: string, modelId: string) => JSON.stringify([providerId, modelId])
export const reasoningUsage = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get(providerId: string, modelId: string) {
    return usages.get(key(providerId, modelId))
  },
  set(providerId: string, modelId: string, usage: ReasoningUsage) {
    const previous = this.get(providerId, modelId)
    if (previous?.requested === usage.requested && previous.effective === usage.effective) return
    usages.set(key(providerId, modelId), usage)
    for (const listener of listeners) listener()
  }
}
