import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  translate: vi.fn((key: string, options?: { lng?: string }) => `${options?.lng ?? 'default'}:${key}`),
  providerLookup: vi.fn(),
  fetch: vi.fn()
}))

vi.mock('i18next', () => ({ t: mocks.translate }))
vi.mock('@renderer/services/ProviderService', () => ({ getProviderById: mocks.providerLookup }))

import { diagnoseError } from './ErrorDiagnosisService'

describe('diagnoseError', () => {
  beforeEach(() => {
    mocks.translate.mockClear()
    mocks.providerLookup.mockReset()
    mocks.fetch.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies known errors locally and uses the requested language', async () => {
    const error = {
      name: 'FixtureError',
      message: 'Unauthorized fixture response',
      stack: null,
      statusCode: 401
    }

    const english = await diagnoseError(error, 'en-US', { providerName: 'fixture-provider', modelId: 'fixture-model' })
    const chinese = await diagnoseError(error, 'zh-CN', { providerName: 'fixture-provider', modelId: 'fixture-model' })

    expect(english).toEqual({
      summary: 'en-US:error.diagnosis.auth',
      category: 'auth',
      explanation: 'en-US:error.diagnosis.auth',
      steps: [{ text: 'en-US:error.diagnosis.go_to_settings' }]
    })
    expect(chinese).toEqual({
      summary: 'zh-CN:error.diagnosis.auth',
      category: 'auth',
      explanation: 'zh-CN:error.diagnosis.auth',
      steps: [{ text: 'zh-CN:error.diagnosis.go_to_settings' }]
    })
    expect(mocks.translate).toHaveBeenCalledWith('error.diagnosis.auth', { lng: 'en-US' })
    expect(mocks.translate).toHaveBeenCalledWith('error.diagnosis.auth', { lng: 'zh-CN' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.providerLookup).not.toHaveBeenCalled()
  })

  it('keeps unknown error bodies, endpoints, and keys out of the diagnosis result', async () => {
    const responseBody = 'fixture-private-error-body'
    const endpoint = 'https://fixture.invalid/v1/responses?apiKey=fixture-query-key'
    const apiKey = 'fixture-api-key'
    const error = {
      name: 'FixtureError',
      message: `Unexpected fixture result: ${responseBody} from ${endpoint}`,
      stack: null,
      url: endpoint,
      responseBody,
      apiKey
    }

    const result = await diagnoseError(error, 'en-US')
    const serializedResult = JSON.stringify(result)

    expect(result.category).toBe('unknown')
    expect(serializedResult).not.toContain(responseBody)
    expect(serializedResult).not.toContain(endpoint)
    expect(serializedResult).not.toContain('fixture-query-key')
    expect(serializedResult).not.toContain(apiKey)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.providerLookup).not.toHaveBeenCalled()
  })
})
