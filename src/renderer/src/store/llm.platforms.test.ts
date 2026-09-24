import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/config/providers', () => ({ SYSTEM_PROVIDERS: [] }))
import reducer, { addProvider, importPlatformProvider, initialState, setPlatformModels } from '@renderer/store/llm'
import { inferProviderPlatform, resolveProviders } from '@shared/platforms'
import { matchesProviderImport, parseProviderImport } from '@shared/providerImport'
import type { Provider } from '@types'

const provider = (id: string): Provider => ({
  id,
  name: id,
  type: 'openai-response',
  platform: 'openai',
  apiHost: 'http://localhost/v1',
  apiKey: 'mock-key',
  models: [],
  enabled: true
})
describe('shared platform catalogs', () => {
  it('has no default providers and shares edits immediately while retaining provider binding', () => {
    expect(initialState.providers).toEqual([])
    let state = reducer(initialState, addProvider(provider('one')))
    state = reducer(state, addProvider(provider('two')))
    state = reducer(
      state,
      setPlatformModels({ platform: 'openai', models: [{ id: 'my-model', name: 'Edited', group: 'Custom' }] })
    )
    expect(state.providers.every((p) => !('models' in p))).toBe(true)
    for (const p of resolveProviders(state))
      expect(p.models).toEqual([{ id: 'my-model', name: 'Edited', group: 'Custom', provider: p.id }])
    state = reducer(state, setPlatformModels({ platform: 'openai', models: [] }))
    expect(resolveProviders(state).every((p) => p.models.length === 0)).toBe(true)
  })
  it('merges repeated imports, chooses the primary model once, and preserves later selection', () => {
    const incoming = parseProviderImport(
      'ccswitch://v1/import?resource=provider&app=codex&endpoint=http%3A%2F%2Flocalhost%2F%2Fv1&apiKey=mock-key&model=custom-one'
    )
    let state = reducer(
      initialState,
      importPlatformProvider({ provider: provider('one'), models: incoming.models, primaryModel: incoming.model })
    )
    expect(state.defaultModel).toMatchObject({ id: 'custom-one', provider: 'one' })
    const existing = state.providers.find((p) => matchesProviderImport(p, incoming))!
    expect(existing.id).toBe('one')
    state = reducer(
      state,
      importPlatformProvider({
        provider: { ...existing, models: [] },
        models: ['custom-one', 'custom-two'],
        primaryModel: 'custom-two'
      })
    )
    expect(state.providers).toHaveLength(1)
    expect(state.platformModels.openai.filter((m) => m.id === 'custom-one')).toHaveLength(1)
    expect(state.platformModels.openai.some((m) => m.id === 'custom-two')).toBe(true)
    expect(state.defaultModel?.id).toBe('custom-one')
  })
  it('uses the first platform model when an import has no model', () => {
    const state = reducer(initialState, importPlatformProvider({ provider: provider('one'), models: [] }))
    expect(state.defaultModel).toEqual({ ...state.platformModels.openai[0], provider: 'one' })
  })
  it('only infers grok from explicit model or official xAI host evidence', () => {
    expect(inferProviderPlatform({ type: 'openai-response', apiHost: 'https://api.x.ai/v1' })).toBe('grok')
    expect(inferProviderPlatform({ type: 'openai-response', apiHost: 'https://api.x.ai.attacker.example' })).toBe(
      'openai'
    )
    expect(inferProviderPlatform({ type: 'openai-response', models: [{ id: 'grok-custom' }] })).toBe('grok')
    expect(
      inferProviderPlatform({ platform: 'openai', type: 'openai-response', models: [{ id: 'grok-custom' }] })
    ).toBe('openai')
  })
})
