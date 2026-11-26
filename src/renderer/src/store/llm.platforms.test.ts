import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/config/providers', () => ({ SYSTEM_PROVIDERS: [] }))
import reducer, {
  addModel,
  addProvider,
  applyPlatformCatalog,
  applyPlatformCatalogs,
  importPlatformProvider,
  initialState,
  removeModel,
  setDefaultModel,
  setPlatformModels
} from '@renderer/store/llm'
import { modelCatalogMiddleware } from '@renderer/store/modelCatalogMiddleware'
import { bundledModelCatalogs, findOfficialModel, installModelCatalog } from '@shared/modelCatalog/runtime'
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
  it('imports a platform provider, restores excluded models, and sets initial default model when empty', () => {
    let state = reducer(initialState, addProvider(provider('existing')))
    state = reducer(
      state,
      removeModel({
        providerId: 'existing',
        model: { id: 'gpt-6-astra', name: 'gpt-6-astra', group: 'OpenAI', provider: 'existing' }
      })
    )
    expect(state.modelCatalogExclusions.openai).toContain('gpt-6-astra')

    state = reducer(
      state,
      importPlatformProvider({
        provider: {
          ...provider('ccs-1'),
          apiHost: 'https://relay.example.invalid/v1/'
        },
        models: ['gpt-6-astra', 'custom-responses-model'],
        primaryModel: 'custom-responses-model'
      })
    )
    expect(state.providers[0]).toMatchObject({
      id: 'ccs-1',
      apiHost: 'https://relay.example.invalid/v1'
    })
    expect(state.modelCatalogExclusions.openai).not.toContain('gpt-6-astra')
    expect(state.platformModels.openai.some((m) => m.id === 'custom-responses-model')).toBe(true)
    expect(state.defaultModel).toMatchObject({
      id: 'custom-responses-model',
      provider: 'ccs-1'
    })
  })
  it('installs runtime official model metadata when batch applyPlatformCatalogs dispatches at startup', () => {
    const customSnapshot = structuredClone(bundledModelCatalogs.openai)
    customSnapshot.models.find((m) => m.id === 'gpt-6.1-sol')!.aliases.push('gpt-6.1-sol-cached-startup')
    const next = vi.fn((action) => action)
    const dispatch = modelCatalogMiddleware({ dispatch: vi.fn(), getState: () => ({}) } as any)(next)
    try {
      dispatch(applyPlatformCatalogs([customSnapshot]))
      expect(findOfficialModel('gpt-6.1-sol-cached-startup')?.id).toBe('gpt-6.1-sol')
      expect(next).toHaveBeenCalledTimes(1)
    } finally {
      installModelCatalog(bundledModelCatalogs.openai)
    }
  })
})
