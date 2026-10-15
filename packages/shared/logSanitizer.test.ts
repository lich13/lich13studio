import { describe, expect, it } from 'vitest'

import { sanitizeLogText, sanitizeLogValue } from './logSanitizer'

describe('log sanitizer', () => {
  it('redacts credentials in text and URLs', () => {
    const value = sanitizeLogText('Bearer sk-test-secret; endpoint?apiKey=abc123&next=ok')
    expect(value).toContain('Bearer [REDACTED]')
    expect(value).toContain('apiKey=[REDACTED]')
    expect(value).toContain('&next=ok')
  })

  it('redacts request and response fields while keeping safe metadata', () => {
    expect(
      sanitizeLogValue({
        status: 502,
        authorization: 'Bearer secret',
        headers: { 'x-api-key': 'private' },
        requestBodyValues: { messages: [{ content: 'private prompt' }] },
        modelId: 'gpt-6-sol'
      })
    ).toEqual({
      status: 502,
      authorization: '[REDACTED]',
      headers: '[REDACTED]',
      requestBodyValues: '[REDACTED]',
      modelId: 'gpt-6-sol'
    })
  })

  it('redacts system prompt fields in nested values and serialized log text', () => {
    const value = sanitizeLogValue({
      params: { system: 'fixture-private-system-string', systemPrompt: 'fixture-private-system-prompt' },
      modelId: 'fixture-model'
    })

    expect(value).toEqual({
      params: { system: '[REDACTED]', systemPrompt: '[REDACTED]' },
      modelId: 'fixture-model'
    })

    const text = sanitizeLogText(
      JSON.stringify({ params: { system: 'fixture-text-system', system_prompt: 'fixture-text-system-prompt' } })
    )
    expect(JSON.parse(text)).toEqual({ params: { system: '[REDACTED]', system_prompt: '[REDACTED]' } })
    expect(text).not.toContain('fixture-text-system')
  })

  it('keeps error identity without persisting the full error object', () => {
    const value = sanitizeLogValue(Object.assign(new Error('Bearer secret'), { responseBody: 'private' }))
    expect(value).toEqual({ name: 'Error', message: 'Bearer [REDACTED]' })
  })

  it.each([
    'apiKey',
    'api_key',
    'api-key',
    'accessToken',
    'access_token',
    'access-token',
    'refreshToken',
    'refresh_token',
    'refresh-token',
    'backupPassword',
    'backup_password',
    'backup-password',
    'proxyAuthorization',
    'proxy_authorization',
    'proxy-authorization'
  ])('redacts the %s credential field', (key) => {
    expect(sanitizeLogValue({ [key]: 'fixture-credential', status: 401, modelId: 'fixture-model' })).toEqual({
      [key]: '[REDACTED]',
      status: 401,
      modelId: 'fixture-model'
    })
  })

  it.each(['apiKeys', 'api_keys', 'api-keys'])('redacts the entire %s credential array', (key) => {
    const input = { [key]: ['fixture-first-key', 'fixture-second-key'], status: 401 }

    expect(sanitizeLogValue(input)).toEqual({ [key]: '[REDACTED]', status: 401 })
    expect(input[key]).toEqual(['fixture-first-key', 'fixture-second-key'])
  })

  it('sanitizes nested plain error and cause objects while retaining safe diagnostics', () => {
    const value = sanitizeLogValue({
      status: 502,
      modelId: 'fixture-model',
      error: {
        name: 'ProviderError',
        message: 'request failed: {"backupPassword":"fixture-message-password"}',
        status: 401,
        backupPassword: 'fixture-error-password',
        cause: {
          name: 'TransportError',
          message: 'Bearer fixture-cause-token',
          apiKeys: ['fixture-cause-key'],
          responseBody: 'fixture-private-response',
          modelId: 'fixture-upstream-model'
        }
      }
    })

    expect(value).toMatchObject({
      status: 502,
      modelId: 'fixture-model',
      error: {
        name: 'ProviderError',
        message: expect.stringContaining('[REDACTED]'),
        status: 401,
        backupPassword: '[REDACTED]',
        cause: {
          name: 'TransportError',
          message: 'Bearer [REDACTED]',
          apiKeys: '[REDACTED]',
          responseBody: '[REDACTED]',
          modelId: 'fixture-upstream-model'
        }
      }
    })
    expect(JSON.stringify(value)).not.toMatch(
      /fixture-(?:message-password|error-password|cause-token|cause-key|private-response)/
    )
  })

  it.each([
    ['apiKey', 'fixture credential with spaces'],
    ['api_key', 'fixture credential, with separators; and=equals'],
    ['api-key', 'fixture "quoted" credential'],
    ['backupPassword', 'fixture "quoted" credential\\with\\escapes'],
    ['access_token', 'fixture credential\nwith a second line'],
    ['refresh-token', 'fixture credential\twith a tab']
  ])('redacts the complete quoted %s value in JSON log text', (key, credential) => {
    const prefix = 'provider failed: '
    const input = prefix + JSON.stringify({ [key]: credential, status: 401, modelId: 'fixture-model' }, null, 2)
    const value = sanitizeLogText(input)

    expect(value.startsWith(prefix)).toBe(true)
    expect(JSON.parse(value.slice(prefix.length))).toEqual({
      [key]: '[REDACTED]',
      status: 401,
      modelId: 'fixture-model'
    })
  })

  it.each([
    ['Bearer', 'fixture-access-credential'],
    ['bearer', 'fixture-access-credential'],
    ['Basic', 'Zml4dHVyZTpzZWNyZXQ='],
    ['basic', 'Zml4dHVyZTpzZWNyZXQ=']
  ])('redacts %s authorization text and retains the surrounding diagnostics', (scheme, credential) => {
    expect(sanitizeLogText(`upstream auth=${scheme} ${credential}; status=401`)).toBe(
      `upstream auth=${scheme} [REDACTED]; status=401`
    )
  })

  it('redacts URL user information and query credentials while retaining the safe route', () => {
    const value = sanitizeLogText(
      'request failed: https://fixture%40user:fixture%3Apassword@example.invalid/v1/models?apiKey=fixture-query-key&modelId=fixture-model#details'
    )

    expect(value).not.toContain('fixture%40user')
    expect(value).not.toContain('fixture%3Apassword')
    expect(value).not.toContain('fixture-query-key')
    expect(value).toContain('example.invalid/v1/models?')
    expect(value).toContain('modelId=fixture-model#details')
    expect(value).toContain('[REDACTED]')
  })

  it.each(['apiKey', 'api_key', 'api-key', 'accessToken', 'refresh_token', 'backupPassword', 'password', 'token'])(
    'redacts the %s URL query value including percent-encoded characters',
    (key) => {
      const value = sanitizeLogText(
        `https://example.invalid/v1/models?${key}=${encodeURIComponent('fixture query & credential')}&modelId=fixture-model#details`
      )

      expect(value).toContain(`${key}=[REDACTED]`)
      expect(value).not.toContain('fixture%20query')
      expect(value).toContain('&modelId=fixture-model#details')
    }
  )

  it('handles a circular error object without retaining credentials', () => {
    const error: Record<string, unknown> = {
      name: 'ProviderError',
      status: 503,
      backupPassword: 'fixture-cycle-password'
    }
    error.cause = error

    expect(sanitizeLogValue(error)).toEqual({
      name: 'ProviderError',
      status: 503,
      backupPassword: '[REDACTED]',
      cause: '[Circular]'
    })
  })

  it('handles circular arrays while sanitizing their string values', () => {
    const values: unknown[] = ['Bearer fixture-array-credential', 503, null]
    values.push(values)

    expect(sanitizeLogValue(values)).toEqual(['Bearer [REDACTED]', 503, null, '[Circular]'])
  })

  it('summarizes objects and arrays at the depth limit without leaking their contents', () => {
    expect(
      sanitizeLogValue({
        status: 503,
        modelId: 'fixture-model',
        diagnostic: {
          attempt: 2,
          details: {
            object: { opaque: 'fixture-private-object', backupPassword: 'fixture-deep-password' },
            array: ['fixture-private-array']
          }
        }
      })
    ).toEqual({
      status: 503,
      modelId: 'fixture-model',
      diagnostic: {
        attempt: 2,
        details: { object: { type: 'object' }, array: { type: 'array', length: 1 } }
      }
    })
  })
})
