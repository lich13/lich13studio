import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/config/providers', () => ({ SYSTEM_PROVIDERS: [] }))
import reducer, {
  addModel,
  addProvider,
  applyPlatformCatalog,
  initialState,
  setDefaultModel,
  setPlatformModels
} from '@renderer/store/llm'
import { bundledModelCatalogs } from '@shared/modelCatalog/runtime'
import { inferProviderPlatform, resolveProviders } from '@shared/platforms'
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
  it('merges a pending update against latest edits without restoring deleted models or changing selections', () => {
    let state = reducer(initialState, addProvider(provider('one')))
    state = reducer(
      state,
      setDefaultModel({ model: { id: 'gpt-6-sol', name: 'Selected', group: '', provider: 'one' } })
    )
    const selection = state.defaultModel
    const edited = {
      id: 'gpt-6-sol',
      name: 'Keep this name',
      group: 'Custom',
      capabilities: [{ type: 'vision' as const, isUserSelected: false }]
    }
    state = reducer(state, setPlatformModels({ platform: 'openai', models: [edited] }))
    const persisted = JSON.parse(JSON.stringify(state))
    state = reducer(persisted, applyPlatformCatalog(bundledModelCatalogs.openai))
    expect(state.platformModels.openai).toEqual([edited])
    expect(state.defaultModel).toEqual(selection)
    expect(state.providers).toEqual(persisted.providers)
    expect(state).not.toHaveProperty('snapshot')
    state = reducer(
      state,
      addModel({ providerId: 'one', model: { id: 'gpt-6.1-sol', name: 'Added again', group: '', provider: 'one' } })
    )
    expect(state.modelCatalogExclusions.openai).not.toContain('gpt-6.1-sol')
    state = reducer(state, applyPlatformCatalog(bundledModelCatalogs.openai))
    expect(state.platformModels.openai.map((model) => model.name)).toEqual(['Keep this name', 'Added again'])
  })
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
