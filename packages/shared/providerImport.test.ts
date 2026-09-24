import { describe, expect, it } from 'vitest'

import {
  matchesProviderImport,
  normalizeImportEndpoint,
  normalizeProviderEndpoint,
  parseProviderImport
} from './providerImport'
const link = (params: Record<string, string> = {}) =>
  `ccswitch://v1/import?${new URLSearchParams({ resource: 'provider', app: 'codex', name: 'Local test', endpoint: 'http://127.0.0.1:45678/subpath', apiKey: 'test-key', ...params })}`
describe('Sub2API CCS imports', () => {
  it.each([
    ['codex', 'openai-response', 'openai'],
    ['grokbuild', 'openai-response', 'grok'],
    ['claude', 'anthropic', 'anthropic']
  ])('accepts %s as %s', (app, type, platform) => {
    expect(parseProviderImport(link({ app, model: 'model-1', usageScript: 'DO NOT EXECUTE' }))).toEqual({
      type,
      platform,
      name: 'Local test',
      apiHost: 'http://127.0.0.1:45678/subpath/v1',
      apiKey: 'test-key',
      model: 'model-1',
      models: ['model-1']
    })
  })
  it.each<Record<string, string>>([
    { app: 'gemini' },
    { app: 'unknown' },
    { resource: 'skill' },
    { apiKey: '' },
    { endpoint: 'file:///etc/passwd' },
    { endpoint: 'https://user:secret@example.com' }
  ])('rejects invalid inputs %j without exposing credentials', (params) => {
    expect(() => parseProviderImport(link(params))).toThrow()
  })
  it.each([
    ['https://happycodeai.com', 'https://happycodeai.com/v1'],
    ['https://happycodeai.com/', 'https://happycodeai.com/v1'],
    ['https://happycodeai.com//v1', 'https://happycodeai.com/v1'],
    ['https://happycodeai.com/v1/v1/', 'https://happycodeai.com/v1'],
    ['https://example.com//proxy//foo%2Fbar/v1/v1/messages/', 'https://example.com/proxy/foo%2Fbar/v1'],
    ['https://example.com/messages', 'https://example.com/v1'],
    ['https://example.com/custom//endpoint#', 'https://example.com/custom/endpoint#']
  ])('normalizes %s idempotently', (input, expected) => {
    expect(normalizeProviderEndpoint(input)).toBe(expected)
    expect(normalizeProviderEndpoint(expected)).toBe(expected)
  })
  it('accepts New API Claude models and deduplicates primary aliases', () => {
    const parsed = parseProviderImport(
      link({
        app: 'claude',
        model: 'claude-sonnet-4-6',
        haikuModel: 'claude-haiku-4-5-20251001',
        sonnetModel: 'claude-sonnet-4-6',
        opusModel: 'claude-opus-4-6'
      })
    )
    expect(parsed.models).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'])
    expect(parsed.platform).toBe('anthropic')
  })
  it('allows a New API Codex import to be corrected to grok before deduplication', () => {
    const incoming = { ...parseProviderImport(link({ model: 'grok-4.6' })), platform: 'grok' as const }
    expect(matchesProviderImport({ ...incoming, platform: 'openai' }, incoming)).toBe(false)
    expect(matchesProviderImport(incoming, incoming)).toBe(true)
  })
  it('preserves subpaths and avoids duplicate v1 suffixes', () => {
    expect(normalizeImportEndpoint('https://example.com/proxy/v1/responses/')).toBe('https://example.com/proxy/v1')
    expect(normalizeImportEndpoint('https://example.com/proxy/v1/')).toBe('https://example.com/proxy/v1')
  })
  it('deduplicates only identical protocol, endpoint and key', () => {
    const incoming = parseProviderImport(link())
    expect(matchesProviderImport({ ...incoming, apiHost: 'http://127.0.0.1:45678/subpath' }, incoming)).toBe(true)
    expect(matchesProviderImport({ ...incoming, apiKey: 'another-test-key' }, incoming)).toBe(false)
    expect(matchesProviderImport({ ...incoming, type: 'anthropic' }, incoming)).toBe(false)
  })
})
