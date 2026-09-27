import type { Model, ModelCapability, ModelType } from '@renderer/types'

import { EMBEDDING_REGEX, RERANKING_REGEX } from './embedding'
import { hasLegacyReasoningCapability } from './reasoning'
import registry from './registry/cherry-capabilities.json'
import { hasLegacyToolCapability } from './tooluse'
import { hasLegacyVisionCapability, isDedicatedImageModel } from './vision'

export type ResolvedModelCapabilities = Record<ModelType, boolean> & {
  imageGeneration: boolean
  fileInput: boolean
  registryId?: string
}

/** Normalize lookup aliases only; request IDs must never use this value. */
export function normalizeModelCapabilityKey(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .split('/')
    .pop()!
    .replace(/_/g, '-')
    .replace(/(?<=\d)\.(?=\d)/g, '-')
}

const exact = new Map(registry.models.map((entry) => [entry.id, entry]))
const normalized = new Map(registry.models.map((entry) => [normalizeModelCapabilityKey(entry.id), entry]))
function findRegistryModel(id: string) {
  const key = normalizeModelCapabilityKey(id)
  return exact.get(id) ?? normalized.get(key) ?? normalized.get(key.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, ''))
}

/** Remove explicit switches without persisting any inferred capabilities. */
export function restoreAutomaticCapabilities(capabilities: readonly ModelCapability[] = []): ModelCapability[] {
  return capabilities.filter((capability) => capability.isUserSelected === undefined)
}

/** One read-only source for UI filters, attachment gates and request conversion. */
export function resolveModelCapabilities(model?: Model | null): ResolvedModelCapabilities {
  const empty: ResolvedModelCapabilities = {
    text: false,
    vision: false,
    reasoning: false,
    function_calling: false,
    embedding: false,
    rerank: false,
    imageGeneration: false,
    fileInput: false
  }
  if (!model) return empty
  const entry = findRegistryModel(model.id)
  // A display label is never evidence of a model capability.
  const legacyModel = { ...model, name: model.id }
  const id = normalizeModelCapabilityKey(model.id)
  const unknownGPT = !entry && /^(?:gpt(?:-|\d)|codex(?:-|$))/.test(id)
  const decide = (type: ModelType, registered: boolean, fallback: () => boolean) => {
    const explicit = model.capabilities?.find(
      (capability) => capability.type === type && typeof capability.isUserSelected === 'boolean'
    )
    if (explicit) return explicit.isUserSelected!
    if (entry) return registered
    if (model.capabilities?.some((capability) => capability.type === type) || model.type?.includes(type)) return true
    return fallback()
  }
  const has = (capability: string) => entry?.capabilities.includes(capability) ?? false
  const rerank = decide('rerank', has('rerank'), () => !unknownGPT && RERANKING_REGEX.test(id))
  const embedding = decide('embedding', has('embedding'), () => !unknownGPT && !rerank && EMBEDDING_REGEX.test(id))
  const nonChat = embedding || rerank
  const imageGeneration = has('image-generation') || (!entry && isDedicatedImageModel(legacyModel))
  const dedicatedImage = entry
    ? entry.output.length > 0 && !entry.output.includes('text')
    : isDedicatedImageModel(legacyModel)
  return {
    text: decide('text', !nonChat && !dedicatedImage, () => !nonChat && !dedicatedImage),
    vision:
      !nonChat &&
      decide(
        'vision',
        entry?.input.includes('image') || has('image-recognition'),
        () => !unknownGPT && hasLegacyVisionCapability(legacyModel)
      ),
    reasoning:
      !nonChat &&
      decide(
        'reasoning',
        has('reasoning'),
        () => !unknownGPT && !dedicatedImage && hasLegacyReasoningCapability(legacyModel)
      ),
    function_calling:
      !nonChat &&
      decide(
        'function_calling',
        has('function-call'),
        () => !unknownGPT && !dedicatedImage && hasLegacyToolCapability(legacyModel)
      ),
    embedding,
    rerank,
    imageGeneration,
    fileInput: has('file-input'),
    registryId: entry?.id
  }
}
