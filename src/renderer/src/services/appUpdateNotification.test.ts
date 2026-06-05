import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, string | null>) => `${key}${params?.version ? `:${params.version}` : ''}`
  }
}))

const checkLatestReleaseMock = vi.hoisted(() => vi.fn())

vi.mock('./appUpdate', () => ({
  checkLatestRelease: checkLatestReleaseMock
}))

import { notifyLatestReleaseIfAvailable } from './appUpdateNotification'

describe('notifyLatestReleaseIfAvailable', () => {
  beforeEach(() => {
    checkLatestReleaseMock.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(1780647000000)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          notification: {
            send: vi.fn(async () => true)
          }
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a clickable notification when a newer release is available', async () => {
    checkLatestReleaseMock.mockResolvedValue({
      hasUpdate: true,
      currentVersion: '0.1.11',
      latestVersion: '0.1.12',
      releaseUrl: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.12',
      releaseNotes: '',
      asset: {
        name: 'lich13studio_0.1.12_aarch64.dmg',
        url: 'https://github.com/lich13/lich13studio/releases/download/v0.1.12/lich13studio_0.1.12_aarch64.dmg'
      }
    })

    await notifyLatestReleaseIfAvailable('0.1.11', 'darwin')

    expect(window.api.notification.send).toHaveBeenCalledWith({
      title: 'settings.about.updateAvailable:0.1.12',
      message: 'settings.about.updateNotificationMessage',
      id: 'app-update-0.1.12',
      type: 'info',
      timestamp: 1780647000000,
      source: 'update',
      extra: {
        url: 'https://github.com/lich13/lich13studio/releases/download/v0.1.12/lich13studio_0.1.12_aarch64.dmg'
      }
    })
  })

  it('does not notify when there is no newer release', async () => {
    checkLatestReleaseMock.mockResolvedValue({
      hasUpdate: false,
      currentVersion: '0.1.12',
      latestVersion: '0.1.12',
      releaseUrl: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.12',
      releaseNotes: '',
      asset: null
    })

    await notifyLatestReleaseIfAvailable('0.1.12', 'darwin')

    expect(window.api.notification.send).not.toHaveBeenCalled()
  })

  it('uses the release page when a newer release has no platform asset', async () => {
    checkLatestReleaseMock.mockResolvedValue({
      hasUpdate: true,
      currentVersion: '0.1.11',
      latestVersion: '0.1.12',
      releaseUrl: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.12',
      releaseNotes: '',
      asset: null
    })

    await notifyLatestReleaseIfAvailable('0.1.11', 'linux')

    expect(window.api.notification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          url: 'https://github.com/lich13/lich13studio/releases/tag/v0.1.12'
        }
      })
    )
  })
})
