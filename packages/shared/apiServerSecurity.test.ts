import { describe, expect, it } from 'vitest'

import { isAllowedApiOrigin, isLoopbackHost, safeTokenEqual } from './apiServerSecurity'

describe('local API server hardening', () => {
  it('accepts only loopback listen hosts', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) expect(isLoopbackHost(host)).toBe(true)
    for (const host of ['0.0.0.0', '::', '192.168.1.2', '10.0.0.1', 'example.com', '', undefined, '127.0.0.1.evil.com'])
      expect(isLoopbackHost(host)).toBe(false)
  })

  it('allows only the app origin or non-browser clients', () => {
    expect(isAllowedApiOrigin(undefined)).toBe(true)
    expect(isAllowedApiOrigin('tauri://localhost')).toBe(true)
    expect(isAllowedApiOrigin('http://tauri.localhost')).toBe(true)
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3000', 'file://'])
      expect(isAllowedApiOrigin(origin)).toBe(false)
  })

  it('compares tokens exactly', () => {
    expect(safeTokenEqual('cs-sk-abc', 'cs-sk-abc')).toBe(true)
    expect(safeTokenEqual('cs-sk-abd', 'cs-sk-abc')).toBe(false)
    expect(safeTokenEqual('cs-sk-ab', 'cs-sk-abc')).toBe(false)
    expect(safeTokenEqual('', 'cs-sk-abc')).toBe(false)
  })
})
