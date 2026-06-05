import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkLatestRelease, compareVersions, getPlatformAsset } from './appUpdate'

describe('compareVersions', () => {
  it('orders stable semantic versions with optional v prefixes', () => {
    expect(compareVersions('v0.1.11', '0.1.10')).toBeGreaterThan(0)
    expect(compareVersions('0.1.10', 'v0.1.10')).toBe(0)
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0)
  })
})

describe('getPlatformAsset', () => {
  it('prefers the macOS dmg on darwin', () => {
    expect(
      getPlatformAsset(
        [
          { name: 'lich13studio_0.1.11_x64-setup.exe', browser_download_url: 'https://example.com/setup.exe' },
          { name: 'lich13studio_0.1.11_aarch64.dmg', browser_download_url: 'https://example.com/app.dmg' }
        ],
        'darwin'
      )
    ).toEqual({ name: 'lich13studio_0.1.11_aarch64.dmg', url: 'https://example.com/app.dmg' })
  })
})

describe('checkLatestRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses latest GitHub release data and flags updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.1.11',
          html_url: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.11',
          body: 'Release notes',
          assets: [
            {
              name: 'lich13studio_0.1.11_aarch64.dmg',
              browser_download_url:
                'https://github.com/lich13/lich13studio/releases/download/v0.1.11/lich13studio_0.1.11_aarch64.dmg'
            }
          ]
        })
      }))
    )

    await expect(checkLatestRelease('0.1.10', 'darwin')).resolves.toEqual({
      hasUpdate: true,
      currentVersion: '0.1.10',
      latestVersion: '0.1.11',
      releaseUrl: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.11',
      releaseNotes: 'Release notes',
      asset: {
        name: 'lich13studio_0.1.11_aarch64.dmg',
        url: 'https://github.com/lich13/lich13studio/releases/download/v0.1.11/lich13studio_0.1.11_aarch64.dmg'
      }
    })
  })

  it('falls back to the releases page when GitHub data has no usable assets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.1.10',
          html_url: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.10',
          body: '',
          assets: []
        })
      }))
    )

    await expect(checkLatestRelease('0.1.10', 'darwin')).resolves.toEqual({
      hasUpdate: false,
      currentVersion: '0.1.10',
      latestVersion: '0.1.10',
      releaseUrl: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.10',
      releaseNotes: '',
      asset: null
    })
  })

  it('returns a failure result when the GitHub request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500
      }))
    )

    await expect(checkLatestRelease('0.1.10', 'darwin')).resolves.toEqual({
      hasUpdate: false,
      currentVersion: '0.1.10',
      latestVersion: null,
      releaseUrl: 'https://github.com/lich13/lich13studio/releases',
      releaseNotes: '',
      asset: null,
      error: 'GitHub releases request failed with status 500'
    })
  })
})
