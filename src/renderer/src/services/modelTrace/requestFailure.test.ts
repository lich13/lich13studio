import { describe, expect, it } from 'vitest'

import { classifyModelTestFailure } from './requestFailure'

describe('model test request failure classification', () => {
  it.each([
    new Error('unrecognized gateway failure'),
    'unrecognized gateway failure',
    { message: 'unrecognized gateway failure' },
    { error: { message: 'unrecognized gateway failure' } }
  ])('retries unknown request errors without losing their message', (error) => {
    expect(classifyModelTestFailure(error)).toMatchObject({
      category: 'unknown',
      retryable: true,
      message: 'unrecognized gateway failure'
    })
  })

  it.each([
    [{ cause: { status: '503', message: 'overloaded' } }, 'transient', true],
    [{ statusCode: 429, responseBody: '{"error":{"code":"rate_limit_exceeded"}}' }, 'transient', true],
    [
      { statusCode: 429, responseBody: '{"error":{"code":"insufficient_quota","message":"No credits"}}' },
      'quota',
      false
    ],
    [{ cause: { error: { code: 'model_not_found', message: 'missing' } } }, 'model', false],
    [{ error: { type: 'invalid_request_error', message: 'bad input' } }, 'invalid-request', false],
    [{ status: 401 }, 'auth', false],
    [{ status: 403 }, 'auth', false],
    [{ status: 402 }, 'quota', false],
    [{ status: 422 }, 'invalid-request', false],
    [new DOMException('Connection aborted by upstream', 'AbortError'), 'transient', true]
  ])('uses structured and nested provider errors', (error, category, retryable) => {
    expect(classifyModelTestFailure(error)).toMatchObject({ category, retryable })
  })

  it('handles cyclic causes without serializing request credentials', () => {
    const error: any = {
      message: 'failed',
      request: { apiKey: 'private-key' },
      responseBody: '<html>bad gateway</html>'
    }
    error.cause = error
    expect(classifyModelTestFailure(error)).toEqual({ message: 'failed', category: 'unknown', retryable: true })
  })
})
