import { describe, expect, it } from 'vitest'

import {
  matchesProviderImport,
  normalizeImportEndpoint,
  normalizeProviderEndpoint,
  parseProviderImport,
  PROVIDER_IMPORT_MAX_LINK_LENGTH,
  PROVIDER_IMPORT_MAX_PARAM_LENGTH,
  PROVIDER_IMPORT_REJECTED_MARKER,
  ProviderImportLimitError
} from './providerImport'

const link = (params: Record<string, string> = {}) =>
  `ccswitch://v1/import?${new URLSearchParams({
    resource: 'provider',
    app: 'codex',
    name: 'Local test',
    endpoint: 'http://127.0.0.1:45678/subpath',
    apiKey: 'test-key',
    ...params
  })}`

const toBase64 = (value: string) => Buffer.from(value, 'utf-8').toString('base64')
const toBase64UrlUnpadded = (value: string) =>
  toBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('CC Switch V1 provider imports', () => {
  it('parses Claude, Codex, and Grok Build links and normalizes endpoints', () => {
    expect(
      parseProviderImport(
        link({
          app: 'claude',
          name: 'Anthropic Relay',
          endpoint: 'https://relay.example.invalid/v1/messages/',
          apiKey: 'sk-ant-fixture',
          model: 'claude-sonnet-4-6',
          haikuModel: 'claude-haiku-4-5-20251001',
          sonnetModel: 'claude-sonnet-4-6'
        })
      )
    ).toEqual({
      name: 'Anthropic Relay',
      type: 'anthropic',
      platform: 'anthropic',
      apiHost: 'https://relay.example.invalid/v1',
      apiKey: 'sk-ant-fixture',
      model: 'claude-sonnet-4-6',
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
    })

    expect(
      parseProviderImport(
        link({
          app: 'grokbuild',
          name: 'Grok Proxy',
          endpoint: 'https://proxy.example.invalid/api//v1/v1/responses',
          apiKey: 'xai-fixture',
          model: 'grok-4.7'
        })
      )
    ).toMatchObject({
      type: 'openai-response',
      platform: 'grok',
      apiHost: 'https://proxy.example.invalid/api/v1',
      model: 'grok-4.7',
      models: ['grok-4.7']
    })

    expect(normalizeProviderEndpoint('https://proxy.example.invalid/custom#')).toBe(
      'https://proxy.example.invalid/custom#'
    )
    expect(normalizeImportEndpoint('http://192.168.1.20:15721')).toBe('http://192.168.1.20:15721/v1')
  })

  it('picks the first endpoint when comma-separated failover URLs are supplied', () => {
    const imported = parseProviderImport(
      link({
        endpoint: ' https://primary.example.invalid/api , https://backup.example.invalid/v1 '
      })
    )
    expect(imported.apiHost).toBe('https://primary.example.invalid/api/v1')
  })

  it('enforces apiFormat precedence over app defaults and rejects unsupported formats', () => {
    // app=claude overridden by apiFormat=openai_responses
    const overriddenOpenAi = parseProviderImport(
      link({
        app: 'claude',
        apiFormat: 'openai_responses',
        endpoint: 'https://gateway.example.invalid',
        model: 'gpt-5.6-sol'
      })
    )
    expect(overriddenOpenAi.type).toBe('openai-response')
    expect(overriddenOpenAi.platform).toBe('openai')

    // app=gemini overridden by apiFormat=anthropic
    const overriddenAnthropic = parseProviderImport(
      link({
        app: 'gemini',
        apiFormat: 'anthropic',
        endpoint: 'https://gateway.example.invalid'
      })
    )
    expect(overriddenAnthropic.type).toBe('anthropic')
    expect(overriddenAnthropic.platform).toBe('anthropic')

    // Reject openai_chat and gemini_native
    expect(() => parseProviderImport(link({ apiFormat: 'openai_chat' }))).toThrow()
    expect(() => parseProviderImport(link({ apiFormat: 'gemini_native' }))).toThrow()
    expect(() => parseProviderImport(link({ app: 'gemini' }))).toThrow()
  })

  it('decodes URL-safe, unpadded, and space-corrupted Base64 config payloads across Claude, Codex, Grok Build, and additive apps', () => {
    // 1. Claude env JSON (URL-safe unpadded Base64) + ignored usageScript
    const claudeJson = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://claude-cfg.example.invalid',
        ANTHROPIC_AUTH_TOKEN: 'sk-claude-cfg',
        ANTHROPIC_MODEL: 'claude-opus-4-8',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001'
      }
    })
    const claudeImported = parseProviderImport(
      `ccswitch://v1/import?resource=provider&app=claude&name=ClaudeCfg&config=${toBase64UrlUnpadded(claudeJson)}&usageScript=${toBase64('throw new Error("must not run")')}`
    )
    expect(claudeImported).toEqual({
      name: 'ClaudeCfg',
      type: 'anthropic',
      platform: 'anthropic',
      apiHost: 'https://claude-cfg.example.invalid/v1',
      apiKey: 'sk-claude-cfg',
      model: 'claude-opus-4-8',
      models: ['claude-opus-4-8', 'claude-haiku-4-5-20251001']
    })

    // 2. Codex auth + embedded config.toml with unescaped '+' turned into space in query string
    const codexPayload = JSON.stringify({
      auth: { OPENAI_API_KEY: 'sk-codex-inline-key' },
      config: [
        'model = "gpt-6-astra"',
        'model_provider = "relay"',
        '[model_providers.relay]',
        'name = "Codex Relay?"',
        'base_url = "https://codex-cfg.example.invalid/v1"',
        'wire_api = "responses"'
      ].join('\n')
    })
    const rawBase64WithPlus = toBase64(codexPayload)
    // Simulate unescaped '+' decoded as spaces in raw query string
    const codexImported = parseProviderImport(
      `ccswitch://v1/import?resource=provider&app=codex&config=${rawBase64WithPlus.replace(/=+$/, '')}`
    )
    expect(codexImported).toEqual({
      name: 'Codex Relay?',
      type: 'openai-response',
      platform: 'openai',
      apiHost: 'https://codex-cfg.example.invalid/v1',
      apiKey: 'sk-codex-inline-key',
      model: 'gpt-6-astra',
      models: ['gpt-6-astra']
    })

    // 3. Grok Build TOML [model.*]
    const grokToml = [
      '[model.grok-4.7]',
      'provider_name = "Grok Build Node"',
      'base_url = "https://grok-cfg.example.invalid"',
      'api_key = "xai-toml-key"'
    ].join('\n')
    const grokImported = parseProviderImport(
      `ccswitch://v1/import?resource=provider&app=grokbuild&configFormat=toml&config=${encodeURIComponent(toBase64(grokToml))}`
    )
    expect(grokImported).toEqual({
      name: 'Grok Build Node',
      type: 'openai-response',
      platform: 'grok',
      apiHost: 'https://grok-cfg.example.invalid/v1',
      apiKey: 'xai-toml-key',
      model: 'grok-4.7',
      models: ['grok-4.7']
    })

    // 4. Additive app JSON (OpenCode)
    const openCodeJson = JSON.stringify({
      npm: '@ai-sdk/anthropic',
      name: 'OpenCode Anthropic',
      options: {
        baseURL: 'https://opencode.example.invalid/v1',
        apiKey: 'sk-opencode-ant'
      },
      models: {
        'claude-sonnet-5': { name: 'Claude Sonnet 5' }
      }
    })
    const openCodeImported = parseProviderImport(
      `ccswitch://v1/import?resource=provider&app=opencode&config=${encodeURIComponent(toBase64(openCodeJson))}`
    )
    expect(openCodeImported).toEqual({
      name: 'OpenCode Anthropic',
      type: 'anthropic',
      platform: 'anthropic',
      apiHost: 'https://opencode.example.invalid/v1',
      apiKey: 'sk-opencode-ant',
      model: 'claude-sonnet-5',
      models: ['claude-sonnet-5']
    })

    // 5. Multi-profile Grok Build [models] default="b" selects ONLY [model.b] and never mixes [model.a]
    const multiGrokToml = [
      '[models]',
      'default = "grok-b"',
      '[model.grok-a]',
      'provider_name = "Wrong A"',
      'base_url = "https://wrong-a.example.invalid"',
      'api_key = "xai-wrong-a"',
      '[model.grok-b]',
      'provider_name = "Selected B"',
      'base_url = "https://selected-b.example.invalid"',
      'api_key = "xai-selected-b"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=grokbuild&configFormat=toml&config=${encodeURIComponent(toBase64(multiGrokToml))}`
      )
    ).toEqual({
      name: 'Selected B',
      type: 'openai-response',
      platform: 'grok',
      apiHost: 'https://selected-b.example.invalid/v1',
      apiKey: 'xai-selected-b',
      model: 'grok-b',
      models: ['grok-b']
    })

    // 6. Codex multi-provider TOML must NOT borrow base_url from an unselected provider section
    const incompleteSelectedCodex = [
      'model_provider = "b"',
      '[model_providers.a]',
      'base_url = "https://other-provider.example.invalid/v1"',
      'api_key = "sk-other"',
      '[model_providers.b]',
      'api_key = "sk-b-only"'
    ].join('\n')
    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&config=${encodeURIComponent(toBase64(incompleteSelectedCodex))}`
      )
    ).toThrow()

    // 7. Upstream CC Switch Hermes api_mode (anthropic_messages / codex_responses) and app=claude-desktop
    const hermesAnthropic = JSON.stringify({
      api_mode: 'anthropic_messages',
      endpoint: 'https://hermes-ant.example.invalid',
      apiKey: 'sk-hermes-ant'
    })
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=hermes&config=${encodeURIComponent(toBase64(hermesAnthropic))}`
      )
    ).toMatchObject({ type: 'anthropic', platform: 'anthropic', apiHost: 'https://hermes-ant.example.invalid/v1' })

    const hermesCodex = JSON.stringify({
      api_mode: 'codex_responses',
      endpoint: 'https://hermes-oai.example.invalid',
      apiKey: 'sk-hermes-oai'
    })
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=hermes&config=${encodeURIComponent(toBase64(hermesCodex))}`
      )
    ).toMatchObject({ type: 'openai-response', platform: 'openai', apiHost: 'https://hermes-oai.example.invalid/v1' })

    expect(parseProviderImport(link({ app: 'claude-desktop' }))).toMatchObject({
      type: 'anthropic',
      platform: 'anthropic'
    })

    // 8. Quoted dotted TOML table headers: [model_providers."my-relay"], [model."grok-b"], single quotes, and dots inside quotes
    const quotedCodexToml = [
      'model = "gpt-6-astra"',
      'model_provider = "my-relay"',
      '[model_providers."my-relay"]',
      'name = "Quoted Relay"',
      'base_url = "https://quoted-relay.example.invalid/v1"',
      'api_key = "sk-quoted-relay"',
      'wire_api = "responses"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64(quotedCodexToml))}`
      )
    ).toEqual({
      name: 'Quoted Relay',
      type: 'openai-response',
      platform: 'openai',
      apiHost: 'https://quoted-relay.example.invalid/v1',
      apiKey: 'sk-quoted-relay',
      model: 'gpt-6-astra',
      models: ['gpt-6-astra']
    })

    const quotedDottedProviderToml = [
      'model_provider = "corp.relay"',
      "[ model_providers . 'corp.relay' ]",
      'name = "Corp Dotted Relay"',
      'base_url = "https://corp-relay.example.invalid"',
      'api_key = "sk-corp-relay"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64(quotedDottedProviderToml))}`
      )
    ).toMatchObject({
      name: 'Corp Dotted Relay',
      apiHost: 'https://corp-relay.example.invalid/v1',
      apiKey: 'sk-corp-relay'
    })

    const quotedGrokToml = [
      '[models]',
      'default = "grok-b"',
      '[model."grok-a"]',
      'provider_name = "Wrong Quoted A"',
      'base_url = "https://wrong-a.example.invalid"',
      'api_key = "xai-wrong-a"',
      '[model."grok-b"]',
      'provider_name = "Quoted Grok B"',
      'base_url = "https://quoted-b.example.invalid"',
      'api_key = "xai-quoted-b"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=grokbuild&configFormat=toml&config=${encodeURIComponent(toBase64(quotedGrokToml))}`
      )
    ).toEqual({
      name: 'Quoted Grok B',
      type: 'openai-response',
      platform: 'grok',
      apiHost: 'https://quoted-b.example.invalid/v1',
      apiKey: 'xai-quoted-b',
      model: 'grok-b',
      models: ['grok-b']
    })

    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64('[model_providers."unclosed]\nbase_url = "https://a.example.invalid"'))}`
      )
    ).toThrow()

    // 9. Escaped backslashes before n/r/t/", Codex provider subtables (.http_headers), Grok model subtables, and malformed segment rejection
    const codexWithSubtableAndBackslash = [
      'model = "gpt-6-astra"',
      '[model_providers."team\\\\new"]',
      'name = "C:\\\\new-relay"',
      'base_url = "https://subtable-relay.example.invalid"',
      'api_key = "sk-subtable-relay"',
      'wire_api = "responses"',
      '[model_providers."team\\\\new".http_headers]',
      'X-Trace = "1"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64(codexWithSubtableAndBackslash))}`
      )
    ).toEqual({
      name: 'C:\\new-relay',
      type: 'openai-response',
      platform: 'openai',
      apiHost: 'https://subtable-relay.example.invalid/v1',
      apiKey: 'sk-subtable-relay',
      model: 'gpt-6-astra',
      models: ['gpt-6-astra']
    })

    const grokWithSubtable = [
      '[model."grok-b"]',
      'provider_name = "Grok With Params"',
      'base_url = "https://grok-sub.example.invalid"',
      'api_key = "xai-sub"',
      '[model."grok-b".params]',
      'temperature = "0.2"'
    ].join('\n')
    expect(
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=grokbuild&configFormat=toml&config=${encodeURIComponent(toBase64(grokWithSubtable))}`
      )
    ).toMatchObject({
      name: 'Grok With Params',
      model: 'grok-b',
      models: ['grok-b']
    })

    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64('[model_providers."a" "b"]\nbase_url = "https://a.example.invalid"'))}`
      )
    ).toThrow()
    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&configFormat=toml&config=${encodeURIComponent(toBase64('[table1] [table2]\nbase_url = "https://a.example.invalid"'))}`
      )
    ).toThrow()
  })

  it('rejects configUrl, indirect env_key, wire_api=chat, and dynamic ${...}/{env:...}/{file:...}/!cmd syntax', () => {
    expect(() =>
      parseProviderImport(`${link()}&configUrl=${encodeURIComponent('https://evil.example.invalid/cfg.json')}`)
    ).toThrow()
    expect(() => parseProviderImport(link({ apiKey: '${OPENAI_API_KEY}' }))).toThrow()
    expect(() => parseProviderImport(link({ apiKey: '{env:OPENAI_API_KEY}' }))).toThrow()
    expect(() => parseProviderImport(link({ apiKey: '{file:/etc/passwd}' }))).toThrow()
    expect(() => parseProviderImport(link({ apiKey: '!op read op://vault/key' }))).toThrow()

    const indirectToml = [
      '[model_providers.custom]',
      'base_url = "https://a.example.invalid"',
      'env_key = "MY_KEY"'
    ].join('\n')
    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&config=${encodeURIComponent(toBase64(indirectToml))}`
      )
    ).toThrow()

    const chatToml = [
      '[model_providers.custom]',
      'base_url = "https://a.example.invalid"',
      'api_key = "sk-1"',
      'wire_api = "chat"'
    ].join('\n')
    expect(() =>
      parseProviderImport(
        `ccswitch://v1/import?resource=provider&app=codex&config=${encodeURIComponent(toBase64(chatToml))}`
      )
    ).toThrow()
  })

  it('matches duplicate providers accurately', () => {
    const incoming = parseProviderImport(link())
    expect(
      matchesProviderImport(
        {
          type: 'openai-response',
          platform: 'openai',
          apiHost: 'http://127.0.0.1:45678/subpath/v1/',
          apiKey: 'test-key'
        },
        incoming
      )
    ).toBe(true)
    expect(matchesProviderImport({ ...incoming, type: 'anthropic' }, incoming)).toBe(false)
  })
})

describe('CCS import size limits', () => {
  it('rejects over-long links, oversized params and the native rejection marker with a limit error', () => {
    const longLink = `${link()}&name=${'n'.repeat(PROVIDER_IMPORT_MAX_LINK_LENGTH)}`
    expect(() => parseProviderImport(longLink)).toThrow(ProviderImportLimitError)
    expect(() => parseProviderImport(link({ apiKey: 'k'.repeat(PROVIDER_IMPORT_MAX_PARAM_LENGTH + 1) }))).toThrow(
      ProviderImportLimitError
    )
    expect(() => parseProviderImport(`${link()}&${'x'.repeat(PROVIDER_IMPORT_MAX_PARAM_LENGTH + 1)}=1`)).toThrow(
      ProviderImportLimitError
    )
    expect(() => parseProviderImport(PROVIDER_IMPORT_REJECTED_MARKER)).toThrow(ProviderImportLimitError)
  })

  it('keeps limit errors free of credentials', () => {
    const secret = `sk-${'s'.repeat(PROVIDER_IMPORT_MAX_PARAM_LENGTH)}`
    try {
      parseProviderImport(link({ apiKey: secret }))
      expect.unreachable()
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret)
    }
  })

  it('still accepts values at the limit', () => {
    const apiKey = 'k'.repeat(PROVIDER_IMPORT_MAX_PARAM_LENGTH)
    expect(parseProviderImport(link({ apiKey })).apiKey).toBe(apiKey)
  })
})
