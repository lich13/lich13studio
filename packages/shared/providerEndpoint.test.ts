import { describe, expect, it } from 'vitest'

import { normalizeProviderEndpoint, providerRequestBase } from './providerEndpoint'

describe('provider endpoints', () => {
  it.each([
    ['https://example.invalid', 'https://example.invalid/v1'],
    ['https://example.invalid/', 'https://example.invalid/v1'],
    ['https://example.invalid//v1', 'https://example.invalid/v1'],
    ['https://example.invalid/v1/v1/', 'https://example.invalid/v1'],
    ['https://example.invalid//proxy//foo%2Fbar/v1/v1/messages/', 'https://example.invalid/proxy/foo%2Fbar/v1'],
    ['https://example.invalid/messages', 'https://example.invalid/v1'],
    ['https://example.invalid/proxy/v1/responses/', 'https://example.invalid/proxy/v1'],
    ['https://example.invalid/custom//endpoint#', 'https://example.invalid/custom/endpoint#']
  ])('normalizes %s idempotently', (input, expected) => {
    expect(normalizeProviderEndpoint(input)).toBe(expected)
    expect(normalizeProviderEndpoint(expected)).toBe(expected)
    expect(providerRequestBase(input)).toBe(expected.replace(/#$/, ''))
  })

  it.each([
    'file:///fixture',
    'https://fixture:fixture@example.invalid',
    'https://example.invalid?key=fixture',
    'https://example.invalid#fragment',
    'invalid'
  ])('rejects unsupported addresses without exposing them', (input) => {
    expect(() => normalizeProviderEndpoint(input)).toThrow('无效的服务商地址')
  })

  it('allows an empty unconfigured endpoint', () => {
    expect(normalizeProviderEndpoint('  ')).toBe('')
  })
})
