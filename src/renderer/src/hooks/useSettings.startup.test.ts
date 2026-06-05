import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'zh-CN', userAgent: 'Vitest' }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        notifyReduxStoreReady: vi.fn(async () => undefined)
      }
    }
  })
})

import { getMainProcessSettingUpdates } from './settingsSync'

describe('useSettings startup/background sync helpers', () => {
  it('syncs launchToTray when setLaunch receives the silent startup value', () => {
    expect(getMainProcessSettingUpdates({ launchToTray: true })).toEqual([
      ['launchToTray', true],
      ['tray', true]
    ])
  })

  it('keeps tray enabled when close-to-background is enabled', () => {
    expect(getMainProcessSettingUpdates({ trayOnClose: true })).toEqual([
      ['trayOnClose', true],
      ['tray', true]
    ])
  })

  it('syncs explicit tray changes without forcing hidden background off', () => {
    expect(getMainProcessSettingUpdates({ tray: false })).toEqual([['tray', false]])
  })

  it('can be applied through the preload config API', async () => {
    const set = vi.fn(async () => undefined)
    for (const [key, value] of getMainProcessSettingUpdates({ launchToTray: true, trayOnClose: true })) {
      await set(key, value, true)
    }

    expect(set).toHaveBeenCalledWith('launchToTray', true, true)
    expect(set).toHaveBeenCalledWith('trayOnClose', true, true)
    expect(set).toHaveBeenCalledWith('tray', true, true)
  })
})
