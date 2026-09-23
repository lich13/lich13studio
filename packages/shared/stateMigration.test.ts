import { describe, expect, it } from 'vitest'

import { sanitizePersistedState, sanitizeState } from './stateMigration'

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
    expect(next.llm.providers).toEqual([provider])
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
