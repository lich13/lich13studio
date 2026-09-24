import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it, vi } from 'vitest'

import {
  CLI_BASELINES,
  effectiveCliVersion,
  fetchCliVersion,
  isStableVersion,
  platformRequestHeaders,
  releaseVersion
} from './cliIdentity'
import { providerFetch } from './providerFetch'
import { normalizeProviderEndpoint, providerRequestBase } from './providerImport'

describe('official stable CLI identity', () => {
  it('filters unrelated, draft, prerelease and malformed tags', () => {
    expect(
      releaseVersion('openai', [
        { tag_name: 'rust-v0.200.0-alpha', prerelease: true },
        { tag_name: 'rust-v0.199.0', draft: true },
        { tag_name: 'v999.0.0' },
        { tag_name: 123 },
        { tag_name: 'rust-v0.159.0' },
        { tag_name: 'rust-v0.160.0' }
      ])
    ).toBe('0.160.0')
    expect(releaseVersion('anthropic', [{ tag_name: 'v2.2.1' }, { tag_name: 'v2.2.2-beta' }])).toBe('2.2.1')
    expect(isStableVersion('01.2.3')).toBe(false)
    expect(isStableVersion('999999999999999999999.0.0')).toBe(false)
    expect(effectiveCliVersion('openai', '0.1.0')).toBe(CLI_BASELINES.openai)
  })
  it('queries versions without provider credentials and falls back from an unrelated latest tag', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ tag_name: 'unrelated-v9' }))
      .mockResolvedValueOnce(Response.json([{ tag_name: 'rust-v0.180.0' }]))
    expect(await fetchCliVersion('openai', fetcher, new AbortController().signal)).toBe('0.180.0')
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/openai\/codex\/releases/)
      expect(init.credentials).toBe('omit')
      expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'lich13studio-cli-sync' })
    }
    const grok = vi.fn().mockResolvedValue(new Response('1.0.41\n'))
    expect(await fetchCliVersion('grok', grok, new AbortController().signal)).toBe('1.0.41')
    expect(grok.mock.calls[0][0]).toBe('https://x.ai/cli/stable')
  })
  it.each(['openai', 'grok', 'anthropic'] as const)('enforces %s identity on actual SDK requests', async (platform) => {
    const host = normalizeProviderEndpoint('http://127.0.0.1:18763//gateway//v1/v1/')
    const captured: Request[] = []
    const identity = platformRequestHeaders(platform, undefined, {}, 'macOS; arm64')
    const fetcher = providerFetch(host, identity, async (input, init) => {
      captured.push(new Request(input, init))
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'mock rejection' } },
        { status: 400 }
      )
    })
    const options = {
      apiKey: 'simulation-only',
      baseURL: providerRequestBase(host),
      fetch: fetcher,
      headers: { 'uSeR-aGeNt': 'stale-override' }
    }
    const model =
      platform === 'anthropic'
        ? createAnthropic(options)('claude-sonnet-4-6')
        : createOpenAI(options).responses('gpt-test')
    await expect(
      model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'mock' }] }] })
    ).rejects.toThrow('mock rejection')
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(
      `http://127.0.0.1:18763/gateway/v1/${platform === 'anthropic' ? 'messages' : 'responses'}`
    )
    for (const [key, value] of Object.entries(identity)) expect(captured[0].headers.get(key)).toBe(value)
    expect(captured[0].headers.get('user-agent')).not.toContain('ai-sdk')
  })
  it('retains explicit complete endpoints, request bodies and cancellation signals', async () => {
    const capture = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => new Request(input, init))
    const controller = new AbortController()
    const fetcher = providerFetch('http://localhost/custom/endpoint#', {}, capture as unknown as typeof fetch)
    const result = (await fetcher(
      new Request('http://localhost/incorrect/responses', {
        method: 'POST',
        body: 'payload',
        signal: controller.signal
      })
    )) as unknown as Request
    expect(result.url).toBe('http://localhost/custom/endpoint')
    expect(await result.text()).toBe('payload')
    controller.abort()
    expect(result.signal.aborted).toBe(true)
  })
})
