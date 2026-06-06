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

import { shouldShowStartupWindow } from '../components/startupWindow'
import { getMainProcessSettingUpdates, isMainProcessSettingKey } from './settingsSync'

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

  it('only lets Tauri runtime sync known background setting keys', () => {
    expect(isMainProcessSettingKey('launchToTray')).toBe(true)
    expect(isMainProcessSettingKey('tray')).toBe(true)
    expect(isMainProcessSettingKey('trayOnClose')).toBe(true)
    expect(isMainProcessSettingKey('launchOnBoot')).toBe(false)
    expect(isMainProcessSettingKey('proxyUrl')).toBe(false)
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

  it('keeps the startup screen from showing the main window during silent login startup', async () => {
    const invoke = vi.fn(async () => true)

    await expect(shouldShowStartupWindow({ __TAURI__: { core: { invoke } } })).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledWith('is_startup_silent')
  })

  it('shows the startup window for normal Tauri launches', async () => {
    const invoke = vi.fn(async () => false)

    await expect(shouldShowStartupWindow({ __TAURI__: { core: { invoke } } })).resolves.toBe(true)
  })

  it('shows the startup window when silent state cannot be queried', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('unavailable')
    })

    await expect(shouldShowStartupWindow({ __TAURI__: { core: { invoke } } })).resolves.toBe(true)
    await expect(shouldShowStartupWindow({})).resolves.toBe(true)
  })
})
