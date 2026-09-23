import { describe, expect, it } from 'vitest'

import { matchesProviderImport, normalizeImportEndpoint, parseProviderImport } from './providerImport'
const link = (params: Record<string, string> = {}) =>
  `ccswitch://v1/import?${new URLSearchParams({ resource: 'provider', app: 'codex', name: 'Local test', endpoint: 'http://127.0.0.1:45678/subpath', apiKey: 'test-key', ...params })}`
describe('Sub2API CCS imports', () => {
  it.each([
    ['codex', 'openai-response'],
    ['grokbuild', 'openai-response'],
    ['claude', 'anthropic']
  ])('accepts %s as %s', (app, type) => {
    expect(parseProviderImport(link({ app, model: 'model-1', usageScript: 'DO NOT EXECUTE' }))).toEqual({
      type,
      name: 'Local test',
      apiHost: 'http://127.0.0.1:45678/subpath/v1',
      apiKey: 'test-key',
      model: 'model-1'
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
