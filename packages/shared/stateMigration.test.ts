import { describe, expect, it } from 'vitest'

import { migratePlatformState, sanitizePersistedState, sanitizeState } from './stateMigration'

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
  it('preserves intentionally emptied catalogs and edits on 217 backup restore', () => {
    const state: any = fixture(217)
    state.llm.platformModels = { openai: [], grok: [{ id: 'grok-edited', name: 'My name' }], anthropic: [] }
    const next = decode(sanitizePersistedState(encode(state)))
    expect(next.llm.platformModels).toEqual(state.llm.platformModels)
    expect(next.llm.providers[0].apiKey).toBe('test-key')
  })
})
