import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  requestPassword: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@renderer/tauri-shim', () => ({
  buildBackupSnapshot: vi.fn(async (includeCredentials: boolean) => ({
    version: 5,
    includeCredentials,
    localStorage: { 'persist:cherry-studio': '{}' },
    indexedDB: {}
  }))
}))
vi.mock('@renderer/components/Popups/BackupPasswordPopup', () => ({
  requestBackupPassword: mocks.requestPassword
}))

import { decryptPortableBackup, exportPortableBackup } from './PortableBackupService'
import {
  isNativeTauriRuntime,
  reconcilePendingBackupRestore,
  RESTORE_COMMITTED_SETTING_ID
} from './restoreReconciliation'

describe('decryptPortableBackup', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.requestPassword.mockReset().mockResolvedValue(null)
  })

  it('does not invoke decryption when the password dialog is cancelled', async () => {
    await expect(decryptPortableBackup(new Uint8Array([1, 2, 3]))).resolves.toBeNull()

    expect(mocks.requestPassword).toHaveBeenCalledOnce()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('sends raw Uint8Array body and URI-encoded x-backup-password header on encrypted restore', async () => {
    mocks.requestPassword.mockResolvedValueOnce('密鑰#100%')
    mocks.invoke.mockResolvedValueOnce({ payload: '{"version":5}', restoreId: 'restore-previous-enc-1' })
    const payload = new Uint8Array([9, 8, 7])
    await expect(decryptPortableBackup(payload)).resolves.toEqual({
      payload: '{"version":5}',
      restoreId: 'restore-previous-enc-1'
    })
    expect(mocks.invoke).toHaveBeenCalledWith('restore_encrypted_backup_archive', payload, {
      headers: { 'x-backup-password': encodeURIComponent('密鑰#100%') }
    })
  })

  it('exports encrypted portable backups via single one-shot native command', async () => {
    mocks.invoke.mockResolvedValueOnce('/tmp/lich13studio.lich13backup')

    const saved = await exportPortableBackup('lich13studio.20261125.zip', false, {
      includeCredentials: true,
      password: 'fixture-password'
    })

    expect(saved).toBe('/tmp/lich13studio.lich13backup')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('export_portable_backup_archive', {
      fileName: 'lich13studio.20261125.lich13backup',
      state: expect.objectContaining({ version: 5, includeCredentials: true }),
      includeFiles: true,
      password: 'fixture-password'
    })
  })

  it('returns empty string without throwing when the native save dialog is cancelled', async () => {
    mocks.invoke.mockResolvedValueOnce('')
    await expect(exportPortableBackup('lich13studio.20261125.zip', true)).resolves.toBe('')

    mocks.invoke.mockRejectedValueOnce(new Error('User canceled the save dialog'))
    await expect(exportPortableBackup('lich13studio.20261125.zip', true)).resolves.toBe('')
  })
})

describe('reconcilePendingBackupRestore', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('skips IndexedDB lookup when no pending restore marker exists', async () => {
    mocks.invoke.mockResolvedValueOnce(null)
    const loadSettingsStore = vi.fn()

    await expect(
      reconcilePendingBackupRestore({
        isNative: true,
        invokeCommand: mocks.invoke as any,
        loadSettingsStore
      })
    ).resolves.toBe('none')

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('get_pending_restore_id')
    expect(loadSettingsStore).not.toHaveBeenCalled()
  })

  it('rolls back staged Data/ on startup when app crashed BEFORE IndexedDB committed restoreId', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_pending_restore_id') return 'restore-previous-crash-before-idb'
      return undefined
    })
    const settingsMap = new Map<string, { id: string; value: unknown }>([
      [RESTORE_COMMITTED_SETTING_ID, { id: RESTORE_COMMITTED_SETTING_ID, value: 'restore-previous-older-run' }]
    ])
    const settingsStore = {
      get: vi.fn(async (id: string) => settingsMap.get(id)),
      delete: vi.fn(async (id: string) => {
        settingsMap.delete(id)
      })
    }

    await expect(
      reconcilePendingBackupRestore({
        isNative: true,
        invokeCommand: mocks.invoke as any,
        loadSettingsStore: async () => settingsStore
      })
    ).resolves.toBe('rolled_back')

    expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: false,
      restoreId: 'restore-previous-crash-before-idb'
    })
    expect(settingsStore.delete).not.toHaveBeenCalled()
  })

  it('commits new Data/ and deletes restore-previous-* on startup when app crashed AFTER IndexedDB committed restoreId', async () => {
    const restoreId = 'restore-previous-crash-after-idb'
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_pending_restore_id') return restoreId
      return undefined
    })
    const settingsMap = new Map<string, { id: string; value: unknown }>([
      [RESTORE_COMMITTED_SETTING_ID, { id: RESTORE_COMMITTED_SETTING_ID, value: restoreId }]
    ])
    const settingsStore = {
      get: vi.fn(async (id: string) => settingsMap.get(id)),
      delete: vi.fn(async (id: string) => {
        settingsMap.delete(id)
      })
    }

    await expect(
      reconcilePendingBackupRestore({
        isNative: true,
        invokeCommand: mocks.invoke as any,
        loadSettingsStore: async () => settingsStore
      })
    ).resolves.toBe('committed')

    expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: true,
      restoreId
    })
    expect(settingsStore.delete).toHaveBeenCalledWith(RESTORE_COMMITTED_SETTING_ID)
    expect(settingsMap.has(RESTORE_COMMITTED_SETTING_ID)).toBe(false)
  })

  it('retains committed restoreId in IndexedDB if finish_backup_restore(true) fails, and defers if IndexedDB cannot be read', async () => {
    const restoreId = 'restore-previous-locked-cleanup'
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_pending_restore_id') return restoreId
      if (cmd === 'finish_backup_restore') throw new Error('EPERM: directory busy')
      return undefined
    })
    const settingsStore = {
      get: vi.fn(async () => ({ id: RESTORE_COMMITTED_SETTING_ID, value: restoreId })),
      delete: vi.fn(async () => {})
    }

    await expect(
      reconcilePendingBackupRestore({
        isNative: true,
        invokeCommand: mocks.invoke as any,
        loadSettingsStore: async () => settingsStore
      })
    ).resolves.toBe('deferred')
    expect(settingsStore.delete).not.toHaveBeenCalled()

    // If IndexedDB read fails, neither commit nor rollback may execute.
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValueOnce(restoreId)
    await expect(
      reconcilePendingBackupRestore({
        isNative: true,
        invokeCommand: mocks.invoke as any,
        loadSettingsStore: async () => ({
          get: async () => {
            throw new Error('IndexedDB blocked')
          },
          delete: async () => {}
        })
      })
    ).resolves.toBe('deferred')
    expect(mocks.invoke).not.toHaveBeenCalledWith('finish_backup_restore', expect.anything())
  })

  it('detects native Tauri runtime via __TAURI_INTERNALS__ even when withGlobalTauri is false (__TAURI__ undefined)', async () => {
    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = { __TAURI_INTERNALS__: {} }
    try {
      expect(isNativeTauriRuntime()).toBe(true)
      const restoreId = 'restore-previous-internals-only'
      mocks.invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_pending_restore_id') return restoreId
        return undefined
      })
      const settingsStore = {
        get: vi.fn(async () => ({ id: RESTORE_COMMITTED_SETTING_ID, value: restoreId })),
        delete: vi.fn(async () => {})
      }
      await expect(
        reconcilePendingBackupRestore({
          invokeCommand: mocks.invoke as any,
          loadSettingsStore: async () => settingsStore
        })
      ).resolves.toBe('committed')
      expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
        commit: true,
        restoreId
      })
    } finally {
      ;(globalThis as any).window = prevWindow
    }
  })
})
