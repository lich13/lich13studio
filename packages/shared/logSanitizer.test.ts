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

  it('keeps error identity without persisting the full error object', () => {
    const value = sanitizeLogValue(Object.assign(new Error('Bearer secret'), { responseBody: 'private' }))
    expect(value).toEqual({ name: 'Error', message: 'Bearer [REDACTED]' })
  })
})
