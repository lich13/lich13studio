import type { Model } from '@renderer/types'
import { afterAll, describe, expect, it, vi } from 'vitest'

const previousLocalStorage = vi.hoisted(() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined }
  })
  return descriptor
})

vi.mock('@renderer/services/AssistantService', () => ({ getProviderByModel: vi.fn() }))
vi.mock('@renderer/services/SpanManagerService', () => ({}))
vi.mock('@renderer/utils', () => ({
  getLowerBaseModelName: (id: string) => id.toLowerCase().split('/').pop() ?? ''
}))

import { normalizeModelCapabilityKey, resolveModelCapabilities, restoreAutomaticCapabilities } from './capabilities'

afterAll(() => {
  if (previousLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

function model(id: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    provider: 'test-provider',
    name: id,
    group: 'test',
    ...overrides
  }
}

describe('model capability resolution', () => {
  it.each(['gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5-6-sol', 'gpt-5-6-luna', 'gpt-5-6-terra'])(
    'reads text and advanced capabilities for %s from the registry snapshot',
    (id) => {
      const capabilities = resolveModelCapabilities(model(id))

      expect(capabilities).toMatchObject({
        text: true,
        vision: true,
        reasoning: true,
        function_calling: true,
        embedding: false,
        rerank: false,
        imageGeneration: false,
        registryId: id
      })
    }
  )

  it('normalizes provider prefixes, case, underscores, dotted versions, and date aliases for lookup only', () => {
    const requestId = 'OpenAI/Codex/GPT_5.6_Sol-2026-09-12'
    const request = Object.freeze(model(requestId))

    expect(normalizeModelCapabilityKey(' Codex/GPT_5.6_Sol ')).toBe('gpt-5-6-sol')
    expect(resolveModelCapabilities(request).registryId).toBe('gpt-5-6-sol')
    expect(request.id).toBe(requestId)
  })

  it('uses manual true and false overrides before registry data', () => {
    const disabledVision = resolveModelCapabilities(
      model('gpt-6-sol', {
        capabilities: [{ type: 'vision', isUserSelected: false }]
      })
    )
    const enabledEmbedding = resolveModelCapabilities(
      model('gpt-6-sol', {
        capabilities: [{ type: 'embedding', isUserSelected: true }]
      })
    )

    expect(disabledVision.vision).toBe(false)
    expect(enabledEmbedding.embedding).toBe(true)
  })

  it('uses registry data before custom declarations and custom declarations before legacy rules', () => {
    const registryWins = resolveModelCapabilities(
      model('gpt-6-sol', {
        capabilities: [{ type: 'embedding' }],
        type: ['embedding']
      })
    )
    const declarationWins = resolveModelCapabilities(
      model('custom-reasoning-model', {
        capabilities: [{ type: 'reasoning' }]
      })
    )
    const legacyFallback = resolveModelCapabilities(model('grok-4-reasoning-beta'))

    expect(registryWins.embedding).toBe(false)
    expect(declarationWins.reasoning).toBe(true)
    expect(legacyFallback).toMatchObject({
      registryId: undefined,
      reasoning: true,
      function_calling: true,
      vision: true
    })
  })

  it('does not infer capabilities from display names and keeps ordinary text models out of embedding', () => {
    const misleadingName = resolveModelCapabilities(
      model('custom-vendor/plain-chat', { name: 'GPT-6 Sol vision reasoning function calling' })
    )
    const ordinaryText = resolveModelCapabilities(model('text-generation-v2', { name: 'Embedding Vision GPT-6' }))

    expect(misleadingName).toMatchObject({
      text: true,
      vision: false,
      reasoning: false,
      function_calling: false,
      embedding: false
    })
    expect(ordinaryText).toMatchObject({ text: true, embedding: false, rerank: false })
  })

  it('allows unknown GPT models for text without enabling advanced capabilities', () => {
    expect(resolveModelCapabilities(model('gpt-99-preview', { name: 'Claude Opus Vision Tools' }))).toMatchObject({
      text: true,
      vision: false,
      reasoning: false,
      function_calling: false,
      embedding: false,
      rerank: false,
      imageGeneration: false,
      fileInput: false
    })
  })

  it('resolves Grok, Claude, embedding, and rerank snapshot records', () => {
    expect(resolveModelCapabilities(model('grok-4-5'))).toMatchObject({
      reasoning: true,
      function_calling: true,
      vision: true,
      registryId: 'grok-4-5'
    })
    expect(resolveModelCapabilities(model('claude-opus-4-6'))).toMatchObject({
      vision: true,
      reasoning: true,
      function_calling: true,
      fileInput: true,
      imageGeneration: false,
      registryId: 'claude-opus-4-6'
    })
    expect(resolveModelCapabilities(model('text-embedding-3-small'))).toMatchObject({
      text: false,
      embedding: true,
      rerank: false,
      registryId: 'text-embedding-3-small'
    })
    expect(resolveModelCapabilities(model('rerank-v4-pro'))).toMatchObject({
      text: false,
      embedding: false,
      rerank: true,
      registryId: 'rerank-v4-pro'
    })
  })

  it('keeps image input, image generation, and file input independent', () => {
    const gpt6 = resolveModelCapabilities(model('gpt-6-sol'))
    const imageModel = resolveModelCapabilities(model('dall-e-3'))

    expect(gpt6).toMatchObject({ vision: true, imageGeneration: false, fileInput: false })
    expect(imageModel).toMatchObject({ vision: false, imageGeneration: true, fileInput: true })
  })

  it('restores automatic capabilities without mutating the supplied array or entries', () => {
    const automatic = Object.freeze({ type: 'reasoning' as const })
    const enabled = Object.freeze({ type: 'vision' as const, isUserSelected: true })
    const disabled = Object.freeze({ type: 'function_calling' as const, isUserSelected: false })
    const original = Object.freeze([automatic, enabled, disabled])

    const restored = restoreAutomaticCapabilities(original)

    expect(restored).toEqual([automatic])
    expect(restored[0]).toBe(automatic)
    expect(original).toEqual([automatic, enabled, disabled])
  })
})
