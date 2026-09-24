import { CLI_BASELINES, CLI_SYNC_INTERVAL, type CliVersions } from '@shared/cliIdentity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ versions: {} as CliVersions, fetcher: vi.fn() }))
vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({ llm: { cliVersions: mocks.versions } }),
    dispatch: ({ platform, cache }) => {
      mocks.versions[platform] = cache
    }
  }
}))
vi.mock('@renderer/store/llm', () => ({ setCliVersion: (action) => action }))
vi.mock('@renderer/utils/tauriNativeFetch', () => ({ getTauriNativeFetch: () => mocks.fetcher }))
import { startCliVersionSync, syncCliVersion } from './CliVersionService'

beforeEach(() => {
  mocks.versions = {}
  mocks.fetcher.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
  vi.stubGlobal('window', { api: { getAppInfo: async () => ({ platform: 'darwin', arch: 'arm64' }) } })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CLI version cache and scheduler', () => {
  it('keeps valid cache offline and throttles background checks for an hour', async () => {
    mocks.versions.grok = { version: '1.1.0', checkedAt: Date.now() - CLI_SYNC_INTERVAL, syncedAt: 123 }
    mocks.fetcher.mockRejectedValue(new Error('offline'))
    await syncCliVersion('grok')
    expect(mocks.versions.grok).toEqual({ version: '1.1.0', checkedAt: Date.now(), syncedAt: 123 })
    await syncCliVersion('grok')
    expect(mocks.fetcher).toHaveBeenCalledTimes(1)
    await syncCliVersion('grok', true)
    expect(mocks.fetcher).toHaveBeenCalledTimes(2)
  })
  it('only upgrades stable versions and uses a bundled version when there is no cache', async () => {
    mocks.fetcher.mockImplementation(async () => new Response('0.1.0'))
    await syncCliVersion('grok')
    expect(mocks.versions.grok?.version).toBe(CLI_BASELINES.grok)
    mocks.fetcher.mockImplementation(async () => new Response('1.2.0'))
    await syncCliVersion('grok', true)
    expect(mocks.versions.grok?.version).toBe('1.2.0')
    mocks.fetcher.mockImplementation(async () => new Response('1.0.0'))
    await syncCliVersion('grok', true)
    expect(mocks.versions.grok?.version).toBe('1.2.0')
  })
  it('aborts stalled queries without blocking the caller indefinitely', async () => {
    mocks.fetcher.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))))
    )
    const task = syncCliVersion('grok')
    expect(syncCliVersion('grok')).toBe(task)
    await vi.advanceTimersByTimeAsync(10000)
    await task
    expect(mocks.versions.grok?.version).toBe(CLI_BASELINES.grok)
  })
  it('schedules each platform hourly and cancels the timer when unmounted', async () => {
    mocks.fetcher.mockImplementation(async (url: string) =>
      url.includes('x.ai')
        ? new Response('1.0.41')
        : Response.json({ tag_name: url.includes('openai') ? 'rust-v0.156.1' : 'v2.1.281' })
    )
    const stop = startCliVersionSync()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.fetcher).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(CLI_SYNC_INTERVAL)
    expect(mocks.fetcher).toHaveBeenCalledTimes(6)
    stop()
    await vi.advanceTimersByTimeAsync(CLI_SYNC_INTERVAL)
    expect(mocks.fetcher).toHaveBeenCalledTimes(6)
  })
})
