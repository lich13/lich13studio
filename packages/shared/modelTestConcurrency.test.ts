import { describe, expect, it } from 'vitest'

import { emptyCatalogExclusions } from './modelCatalog/merge'
import { normalizeModelTestConcurrency } from './modelTestOptions'
import { createPlatformModels } from './platforms'
import {
  migrateModelTestConcurrencyState,
  MODEL_TEST_CONCURRENCY_VERSION,
  sanitizePersistedState
} from './stateMigration'

function fixture(concurrency?: unknown, version = 220) {
  const model = { id: 'user-model', name: 'User model', group: 'Custom', provider: 'saved' }
  const modelSelection = { platform: 'openai', modelId: model.id, providerId: model.provider }
  const platformModels = createPlatformModels()
  platformModels.openai.push({ id: model.id, name: model.name, group: model.group })
  return {
    _persist: { version, rehydrated: true },
    llm: {
      providers: [
        {
          id: 'saved',
          name: 'Saved provider',
          platform: 'openai',
          type: 'openai-response',
          enabled: true,
          apiHost: 'https://example.test/v1',
          apiKey: 'fixture-only-credential',
          extra_headers: { 'X-Custom': 'preserved' }
        }
      ],
      platformModels,
      cliVersions: {},
      defaultModel: model,
      quickModel: model,
      modelTestSelection: modelSelection,
      settings: { vertexai: { serviceAccount: { privateKey: 'fixture-only-private-key' } } },
      ...(concurrency === undefined ? {} : { modelTestConcurrency: concurrency })
    },
    assistants: {
      defaultAssistant: {
        id: 'assistant',
        model,
        modelSelection,
        settings: { reasoning_effort: 'max' },
        topics: [{ id: 'topic', title: 'User title' }]
      },
      assistants: [],
      presets: []
    },
    topics: [
      {
        id: 'topic',
        messages: [
          {
            id: 'message',
            content: 'Original conversation',
            model,
            llm: { modelTestConcurrency: 99, apiKey: 'fixture-message-text' }
          }
        ]
      }
    ]
  }
}

const encode = (state: object) =>
  JSON.stringify(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)])))
const decode = (raw: string) =>
  Object.fromEntries(Object.entries(JSON.parse(raw)).map(([key, value]) => [key, JSON.parse(value as string)]))

describe('221 model-test concurrency migration', () => {
  it('uses the next migration version', () => {
    expect(MODEL_TEST_CONCURRENCY_VERSION).toBe(221)
  })

  it.each([1, 2, 3])('preserves legal concurrency %i without changing any other state', (concurrency) => {
    const state = fixture(concurrency)
    const before = structuredClone(state)
    expect(normalizeModelTestConcurrency(concurrency)).toBe(concurrency)
    expect(migrateModelTestConcurrencyState(state)).toBe(state)
    expect(state).toEqual(before)
    expect(migrateModelTestConcurrencyState(state)).toEqual(before)
  })

  it.each([
    { label: 'missing', value: undefined },
    { label: 'null', value: null },
    { label: 'zero', value: 0 },
    { label: 'negative', value: -1 },
    { label: 'above the limit', value: 4 },
    { label: 'fraction', value: 1.5 },
    { label: 'numeric string', value: '2' },
    { label: 'empty string', value: '' },
    { label: 'true', value: true },
    { label: 'false', value: false },
    { label: 'object', value: { concurrency: 2 } },
    { label: 'array', value: [3] },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'negative infinity', value: Number.NEGATIVE_INFINITY }
  ])('defaults $label to one and remains idempotent', ({ value }) => {
    const state = fixture(value)
    const before = structuredClone(state)
    const expected = { ...before, llm: { ...before.llm, modelTestConcurrency: 1 } }
    expect(normalizeModelTestConcurrency(value)).toBe(1)
    expect(migrateModelTestConcurrencyState(state)).toEqual(expected)
    expect(migrateModelTestConcurrencyState(state)).toEqual(expected)
    expect(state.llm.providers).toEqual(before.llm.providers)
    expect(state.llm.platformModels).toEqual(before.llm.platformModels)
    expect(state.topics).toEqual(before.topics)
    expect(state.assistants).toEqual(before.assistants)
  })

  it('leaves a state without an llm slice intact', () => {
    const state = { _persist: { version: 220 }, topics: [{ id: 'original', content: 'User text' }] }
    const before = structuredClone(state)
    expect(migrateModelTestConcurrencyState(state)).toBe(state)
    expect(state).toEqual(before)
    expect(state).not.toHaveProperty('llm')
  })

  it.each([218, 219, 220])(
    'initializes a version %i backup without rewriting chat, models or credentials',
    (version) => {
      const state = fixture(undefined, version)
      const before = structuredClone(state)
      const raw = encode(state)
      const restoredRaw = sanitizePersistedState(raw)
      const restored = decode(restoredRaw)
      expect(restored).toEqual({
        ...before,
        llm: { ...before.llm, modelTestConcurrency: 1, modelCatalogExclusions: emptyCatalogExclusions() }
      })
      expect(restored._persist.version).toBe(version)
      expect(sanitizePersistedState(restoredRaw)).toBe(restoredRaw)
      expect(state).toEqual(before)
      expect(encode(state)).toBe(raw)
    }
  )

  it.each([1, 2, 3])(
    'preserves concurrency %i across a current backup restore and repeated migration',
    (concurrency) => {
      const state = fixture(concurrency, MODEL_TEST_CONCURRENCY_VERSION)
      const restoredRaw = sanitizePersistedState(encode(state))
      const restored = decode(restoredRaw)
      const expected = { ...state, llm: { ...state.llm, modelCatalogExclusions: emptyCatalogExclusions() } }
      expect(restored).toEqual(expected)
      expect(migrateModelTestConcurrencyState(restored)).toEqual(expected)
      expect(sanitizePersistedState(restoredRaw)).toBe(restoredRaw)
    }
  )

  it.each([null, 0, 4, '3', { value: 2 }])(
    'normalizes malformed concurrency %j at the backup restore boundary',
    (value) => {
      const state = fixture(value, MODEL_TEST_CONCURRENCY_VERSION)
      const restored = decode(sanitizePersistedState(encode(state)))
      expect(restored).toEqual({
        ...state,
        llm: { ...state.llm, modelTestConcurrency: 1, modelCatalogExclusions: emptyCatalogExclusions() }
      })
    }
  )
})
