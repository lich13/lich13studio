import { describe, expect, it } from 'vitest'

import {
  migrateAssistantSelectionState,
  migrateChatRequestModeState,
  migrateModelTestState,
  migratePlatformState,
  sanitizePersistedState,
  sanitizeState
} from './stateMigration'

const provider = { id: 'new', type: 'openai-response', apiHost: 'http://localhost/v1', apiKey: 'test-key', models: [] }
const fixture = (version: number) => ({
  _persist: { version, rehydrated: true },
  llm: {
    providers: [provider],
    defaultModel: { id: 'gpt-test', provider: 'new' },
    settings: { cherryIn: { accessToken: 'old-secret' } }
  },
  mcp: { servers: [{ env: { TOKEN: 'old-secret' } }] },
  assistants: {
    assistants: [
      {
        id: 'a',
        topics: [{ id: 'topic', title: 'preserved' }],
        model: { id: 'gpt-test', provider: 'new' },
        mcpServers: [{}],
        settings: { reasoning_effort: 'none' },
        regularPhrases: [{ content: 'preserved' }]
      }
    ]
  }
})
const encode = (state: object) =>
  JSON.stringify(Object.fromEntries(Object.entries(state).map(([k, v]) => [k, JSON.stringify(v)])))
const decode = (raw: string) =>
  Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k, JSON.parse(v as string)]))

describe('219 model-test preferences', () => {
  it('initializes from 218 defaults without changing providers, assistants or chat records', () => {
    const state = { ...fixture(218), topics: [{ id: 't', messages: ['original'] }] }
    const before = structuredClone(state)
    const next = migrateModelTestState(state) as any
    expect(next.llm.modelTestSelection).toEqual({ platform: 'openai', modelId: 'gpt-test', providerId: 'new' })
    expect(next.llm.providers).toEqual(before.llm.providers)
    expect(next.assistants).toEqual(before.assistants)
    expect(next.topics).toEqual(before.topics)
    expect(migrateModelTestState(structuredClone(next))).toEqual(next)
  })

  it('preserves the last test choice through restart and current backup restore', () => {
    const state: any = fixture(219)
    state.llm.modelTestSelection = { platform: 'grok', modelId: 'missing-model', providerId: 'removed-provider' }
    const restored = decode(sanitizePersistedState(encode(state)))
    expect(restored.llm.modelTestSelection).toEqual(state.llm.modelTestSelection)
    expect(migrateModelTestState(restored).llm.modelTestSelection).toEqual(state.llm.modelTestSelection)
  })

  it('initializes restored 218 backups, and does not resurrect providers from pre-216 backups', () => {
    expect(decode(sanitizePersistedState(encode(fixture(218)))).llm.modelTestSelection).toEqual({
      platform: 'openai',
      modelId: 'gpt-test',
      providerId: 'new'
    })
    expect(decode(sanitizePersistedState(encode(fixture(215)))).llm.modelTestSelection).toEqual({})
  })
})

describe('216 state boundary', () => {
  it('removes providers, credentials and invalid references from old backups without deleting user content', () => {
    const next = decode(sanitizePersistedState(encode(fixture(215))))
    expect(next.llm.providers).toEqual([])
    expect(next.llm.defaultModel).toBeUndefined()
    expect(JSON.stringify(next)).not.toContain('old-secret')
    expect(next.mcp).toBeUndefined()
    expect(next.assistants.assistants[0]).toMatchObject({
      id: 'a',
      topics: [{ id: 'topic', title: 'preserved' }],
      regularPhrases: [{ content: 'preserved' }],
      settings: { reasoning_effort: 'max' }
    })
    expect(next.assistants.assistants[0].model).toBeUndefined()
  })
  it('keeps new providers on restart and current backups, while scrubbing resurrected MCP data', () => {
    const raw = sanitizePersistedState(encode(fixture(216)))
    const next = decode(raw)
    expect(next.llm.providers[0]).toMatchObject({ id: provider.id, apiKey: provider.apiKey, platform: 'openai' })
    expect(next.llm.providers[0].models).toBeUndefined()
    expect(next.llm.defaultModel.id).toBe('gpt-test')
    expect(next.mcp).toBeUndefined()
    expect(sanitizePersistedState(raw)).toBe(raw)
  })
  it('clears nested model references and normalizes cached strengths without restoring old providers', () => {
    const state = {
      ...fixture(215),
      codeTools: { selectedModels: { codex: { id: 'old' } } },
      openclaw: { selectedModelUniqId: 'old' }
    }
    Object.assign(state.assistants.assistants[0].settings, {
      defaultModel: { id: 'old', provider: 'new' },
      reasoning_effort_cache: 'minimal'
    })
    const next = decode(sanitizePersistedState(encode(state)))
    expect(next.codeTools.selectedModels).toEqual({})
    expect(next.openclaw.selectedModelUniqId).toBeNull()
    expect(next.assistants.assistants[0].settings.defaultModel).toBeUndefined()
    expect(next.assistants.assistants[0].settings.reasoning_effort_cache).toBe('max')
  })
  it.each(['low', 'medium', 'high', 'xhigh', 'max'])('retains the existing %s selection', (effort) => {
    const state = fixture(216)
    state.assistants.assistants[0].settings.reasoning_effort = effort
    expect(sanitizeState(state).assistants.assistants[0].settings.reasoning_effort).toBe(effort)
  })
})

describe('217 shared catalog migration', () => {
  it('merges old definitions in provider order, preserves keys and chat, and repairs addresses', () => {
    const state: any = {
      llm: {
        providers: [
          {
            ...provider,
            models: [{ id: 'gpt-6-sol', provider: 'new', name: 'My edited name' }],
            apiHost: 'https://happycodeai.com//v1/v1',
            userAgent: 'old',
            extra_headers: { 'uSeR-aGeNt': 'old', 'X-Custom': 'keep' },
            healthStatus: 'passed'
          },
          { ...provider, id: 'second', models: [{ id: 'gpt-6-sol', name: 'Ignored second definition' }] },
          { ...provider, id: 'g', models: [{ id: 'grok-custom', name: 'Custom grok' }] },
          { ...provider, id: 'a', type: 'anthropic', models: [{ id: 'claude-custom' }] }
        ]
      },
      chats: [{ text: 'immutable history', model: { id: 'gpt-6-sol', name: 'historical' } }]
    }
    const history = JSON.stringify(state.chats)
    const next = migratePlatformState(state)
    expect(next.llm.providers.map((p: any) => p.platform)).toEqual(['openai', 'openai', 'grok', 'anthropic'])
    expect(next.llm.providers[0]).toMatchObject({
      apiHost: 'https://happycodeai.com/v1',
      apiKey: 'test-key',
      extra_headers: { 'X-Custom': 'keep' }
    })
    expect(next.llm.providers[0]).not.toHaveProperty('models')
    expect(next.llm.providers[0]).not.toHaveProperty('userAgent')
    expect(next.llm.providers[0]).not.toHaveProperty('healthStatus')
    expect(next.llm.platformModels.openai[0]).toEqual({ id: 'gpt-6-sol', name: 'My edited name' })
    expect(next.llm.platformModels.grok[0].id).toBe('grok-custom')
    expect(JSON.stringify(next.chats)).toBe(history)
    const snapshot = JSON.stringify(next)
    expect(JSON.stringify(migratePlatformState(next))).toBe(snapshot)
  })
  it('preserves old seed deletions and edits while adding new releases on 217 backup restore', () => {
    const state: any = fixture(217)
    state.llm.platformModels = { openai: [], grok: [{ id: 'grok-edited', name: 'My name' }], anthropic: [] }
    const next = decode(sanitizePersistedState(encode(state)))
    expect(next.llm.platformModels.grok).toEqual(state.llm.platformModels.grok)
    expect(next.llm.platformModels.openai.map((model) => model.id)).toEqual(['gpt-6.1-sol'])
    expect(next.llm.platformModels.anthropic.map((model) => model.id)).toEqual(['claude-sonnet-5-5'])
    expect(next.llm.modelCatalogExclusions.openai).toContain('gpt-6-sol')
    expect(next.llm.providers[0].apiKey).toBe('test-key')
  })
})

describe('218 network search removal', () => {
  it('removes active search state and assistant switches while preserving chat history', () => {
    const state: any = {
      ...fixture(217),
      websearch: { providers: [{ id: 'tavily', apiKey: 'search-secret' }] },
      inputTools: { toolOrder: { visible: ['web_search', 'url_context'], hidden: [] } },
      chats: [{ id: 'old', blocks: [{ type: 'websearch', content: 'historical result' }] }]
    }
    state.assistants.assistants[0].enableWebSearch = true
    state.assistants.assistants[0].webSearchProviderId = 'tavily'
    const raw = sanitizePersistedState(encode(state))
    const next = decode(raw)
    expect(next.websearch).toBeUndefined()
    expect(next.assistants.assistants[0]).not.toHaveProperty('enableWebSearch')
    expect(next.assistants.assistants[0]).not.toHaveProperty('webSearchProviderId')
    expect(next.inputTools.toolOrder.visible).toEqual(['url_context'])
    expect(next.chats).toEqual(state.chats)
    expect(JSON.stringify(next)).not.toContain('search-secret')
    expect(sanitizePersistedState(raw)).toBe(raw)
  })
})

describe('220 assistant selections', () => {
  it('derives selections by existing priority, preserves history, and is idempotent', () => {
    const state: any = fixture(219)
    state.assistants.defaultAssistant = { defaultModel: { id: 'mini', provider: 'new' } }
    state.assistants.assistants.push({ id: 'other' })
    const topics = structuredClone(state.assistants.assistants[0].topics)
    migrateAssistantSelectionState(state)
    expect(state.assistants.defaultAssistant.modelSelection).toEqual({
      platform: 'openai',
      modelId: 'mini',
      providerId: 'new'
    })
    expect(state.assistants.assistants[0].modelSelection.modelId).toBe('gpt-test')
    expect(state.assistants.assistants[1].modelSelection.modelId).toBe('gpt-test')
    expect(state.assistants.assistants[0].topics).toEqual(topics)
    const before = structuredClone(state)
    expect(migrateAssistantSelectionState(state)).toEqual(before)
  })
  it('retains invalid independent choices after backup restore without resurrecting a provider', () => {
    const state: any = fixture(220)
    state.assistants.assistants[0].modelSelection = { platform: 'grok', modelId: 'custom', providerId: 'gone' }
    const restored = decode(sanitizePersistedState(encode(state)))
    expect(restored.assistants.assistants[0].modelSelection).toEqual(state.assistants.assistants[0].modelSelection)
    expect(sanitizePersistedState(encode(restored))).toBe(encode(restored))
    const old = decode(sanitizePersistedState(encode({ ...state, _persist: { version: 215 } })))
    expect(old.assistants.assistants[0].modelSelection).toEqual({})
  })
  it('uses the saved default assistant entry before falling back to the global default model', () => {
    const state: any = fixture(219)
    state.llm.defaultModel = { id: 'global', provider: 'new' }
    state.assistants.defaultAssistant = { id: 'a' }
    migrateAssistantSelectionState(state)
    expect(state.assistants.defaultAssistant.modelSelection).toEqual({
      platform: 'openai',
      modelId: 'gpt-test',
      providerId: 'new'
    })
  })
})

describe('223 global chat request mode', () => {
  it('derives the first global mode from the legacy assistant flag and removes assistant-only state', () => {
    const state: any = fixture(222)
    state.settings = { enableDataCollection: true }
    state.assistants.assistants[0].settings.streamOutput = false
    state.assistants.defaultAssistant = { settings: { streamOutput: false } }

    migrateChatRequestModeState(state)

    expect(state.settings.chatRequestMode).toBe('non-stream')
    expect(state.settings.enableDataCollection).toBeUndefined()
    expect(state.assistants.defaultAssistant.settings.streamOutput).toBeUndefined()
    expect(state.assistants.assistants[0].settings.streamOutput).toBeUndefined()
  })

  it('keeps an explicit mode and is idempotent for backup restore', () => {
    const state: any = fixture(223)
    state.settings = { chatRequestMode: 'stream', enableDataCollection: false }
    state.assistants.assistants[0].settings.streamOutput = false
    const once = migrateChatRequestModeState(state)
    const snapshot = structuredClone(once)

    expect(migrateChatRequestModeState(once)).toEqual(snapshot)
    expect(once.settings.chatRequestMode).toBe('stream')
    expect(once.assistants.assistants[0].settings.streamOutput).toBeUndefined()
  })
})
