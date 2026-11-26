// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tableRows = new Map<string, Map<string, any>>()
  const ensureTable = (name: string) => {
    let map = tableRows.get(name)
    if (!map) {
      map = new Map()
      tableRows.set(name, map)
    }
    return map
  }
  const makeTable = (name: string) => ({
    name,
    clear: vi.fn(async () => {
      ensureTable(name).clear()
    }),
    bulkAdd: vi.fn(async (rows: any[]) => {
      const map = ensureTable(name)
      for (const row of rows) {
        map.set(String(row.id), structuredClone(row))
      }
    }),
    put: vi.fn(async (row: any) => {
      ensureTable(name).set(String(row.id), structuredClone(row))
      return row.id
    }),
    get: vi.fn(async (id: string) => {
      const val = ensureTable(name).get(String(id))
      return val ? structuredClone(val) : undefined
    }),
    delete: vi.fn(async (id: string) => {
      ensureTable(name).delete(String(id))
    })
  })

  const tableNames = [
    'files',
    'topics',
    'settings',
    'knowledge_notes',
    'translate_history',
    'quick_phrases',
    'message_blocks',
    'translate_languages'
  ]
  const dbObj: Record<string, any> = {
    tables: tableNames.map((name) => makeTable(name)),
    table: (name: string) => dbObj[name],
    transaction: vi.fn(async (_mode: string, _tables: unknown, scope: (tx: any) => Promise<unknown>) => {
      const snapshot = new Map<string, Map<string, any>>()
      for (const [k, v] of tableRows.entries()) {
        snapshot.set(k, new Map(structuredClone([...v.entries()])))
      }
      try {
        return await scope({ table: (name: string) => dbObj[name] })
      } catch (error) {
        tableRows.clear()
        for (const [k, v] of snapshot.entries()) {
          tableRows.set(k, v)
        }
        throw error
      }
    })
  }
  for (const table of dbObj.tables) {
    dbObj[table.name] = table
  }

  return {
    dbObj,
    tableRows,
    invoke: vi.fn(),
    pause: vi.fn(),
    flush: vi.fn(async () => {}),
    persist: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    relaunchApp: vi.fn()
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), verbose: vi.fn() })
  }
}))
vi.mock('@renderer/databases', () => ({ default: mocks.dbObj, db: mocks.dbObj }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      runtime: { filesPath: '/app/Data/Files' },
      settings: {}
    }),
    dispatch: vi.fn()
  },
  persistor: {
    pause: mocks.pause,
    flush: mocks.flush,
    persist: mocks.persist
  }
}))
vi.mock('./mobile/credentials', () => ({
  credentialStorageEnabled: false,
  mobilePersistStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
}))
vi.mock('./mobile/runtime', () => ({
  runtimeCapabilities: { android: false }
}))
vi.mock('./NotificationService', () => ({
  NotificationService: { getInstance: () => ({ send: vi.fn() }) }
}))
vi.mock('./PortableBackupService', () => ({
  exportPortableBackup: vi.fn()
}))

import { handleData, restore, restoreFromLocal, restoreFromWebdav } from './BackupService'
import { reconcilePendingBackupRestore, RESTORE_COMMITTED_SETTING_ID } from './restoreReconciliation'

function makeValidBackupPayload() {
  return {
    version: 5,
    localStorage: {
      'persist:cherry-studio': JSON.stringify({
        settings: JSON.stringify({ theme: 'light' })
      })
    },
    indexedDB: {
      files: [
        {
          id: 'file-1',
          name: 'doc.pdf',
          origin_name: 'doc.pdf',
          path: '/old/file-1.pdf',
          size: 12,
          ext: '.pdf',
          type: 'document',
          created_at: '2026-01-01T00:00:00.000Z',
          count: 1
        }
      ],
      topics: [{ id: 'topic-1', messages: [] }],
      settings: [
        { id: 'user-pref', value: 'yes' },
        { id: RESTORE_COMMITTED_SETTING_ID, value: 'restore-previous-stale-from-archive' }
      ]
    }
  }
}

describe('BackupService handleData atomic restoreId journal & crash reconciliation', () => {
  beforeEach(() => {
    mocks.tableRows.clear()
    mocks.invoke.mockReset()
    mocks.pause.mockClear()
    mocks.flush.mockClear()
    mocks.persist.mockClear()
    mocks.toastSuccess.mockClear()
    mocks.toastError.mockClear()
    mocks.relaunchApp.mockClear()
    localStorage.clear()
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings: JSON.stringify({ theme: 'dark' }) }))
    ;(window as any).__TAURI__ = {}
    ;(window as any).toast = { success: mocks.toastSuccess, error: mocks.toastError }
    ;(window as any).api = {
      relaunchApp: mocks.relaunchApp,
      getAppInfo: async () => ({ filesPath: '/app/Data/Files' })
    }
  })

  it('persists restoreId inside the IndexedDB rw transaction and keeps it when finish_backup_restore(true) fails so next startup commits instead of rolling back', async () => {
    const activeRestoreId = 'restore-previous-live-crash-after-commit'
    let markerDuringFinishCall: { id: string; value: unknown } | undefined

    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'finish_backup_restore') {
        markerDuringFinishCall = await mocks.dbObj.settings.get(RESTORE_COMMITTED_SETTING_ID)
        throw new Error('Simulated crash / EBUSY before marker removal')
      }
      return undefined
    })

    await handleData(makeValidBackupPayload(), { restoreId: activeRestoreId })

    expect(mocks.invoke).not.toHaveBeenCalledWith('get_pending_restore_id')
    // Marker was written atomically inside the transaction before finish_backup_restore(true) ran
    expect(markerDuringFinishCall).toEqual({
      id: RESTORE_COMMITTED_SETTING_ID,
      value: activeRestoreId
    })
    // Because finish_backup_restore(true) failed, marker remains in IndexedDB for next startup reconciliation
    expect(await mocks.dbObj.settings.get(RESTORE_COMMITTED_SETTING_ID)).toEqual({
      id: RESTORE_COMMITTED_SETTING_ID,
      value: activeRestoreId
    })

    // Simulate next app startup reconciling the interrupted restore: must commit (commit: true), NOT roll back!
    const startupInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'get_pending_restore_id') return activeRestoreId
      return undefined
    })
    const outcome = await reconcilePendingBackupRestore({
      isNative: true,
      invokeCommand: startupInvoke as any,
      loadSettingsStore: async () => mocks.dbObj.settings
    })

    expect(outcome).toBe('committed')
    expect(startupInvoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: true,
      restoreId: activeRestoreId
    })
    expect(await mocks.dbObj.settings.get(RESTORE_COMMITTED_SETTING_ID)).toBeUndefined()
  })

  it('cleans up committed restoreId marker after normal finish_backup_restore(true) and rolls back cleanly on pre-commit failure', async () => {
    const activeRestoreId = 'restore-previous-clean-run'
    mocks.invoke.mockResolvedValue(undefined)

    await handleData(makeValidBackupPayload(), { restoreId: activeRestoreId })
    expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: true,
      restoreId: activeRestoreId
    })
    expect(await mocks.dbObj.settings.get(RESTORE_COMMITTED_SETTING_ID)).toBeUndefined()
    expect(await mocks.dbObj.settings.get('user-pref')).toEqual({ id: 'user-pref', value: 'yes' })

    // Now simulate a restore that fails mid-transaction BEFORE IndexedDB commit
    const failedRestoreId = 'restore-previous-tx-aborted'
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.dbObj.topics.bulkAdd.mockRejectedValueOnce(new Error('ConstraintError'))

    await expect(handleData(makeValidBackupPayload(), { restoreId: failedRestoreId })).rejects.toThrow(
      'ConstraintError'
    )
    expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: false,
      restoreId: failedRestoreId
    })
    // Transaction rolled back: failedRestoreId is NOT committed in IndexedDB
    expect(await mocks.dbObj.settings.get(RESTORE_COMMITTED_SETTING_ID)).toBeUndefined()
  })

  it('skips finish_backup_restore when no files were staged (restoreId: null) and passes explicit restoreId from unpack IPC', async () => {
    mocks.invoke.mockResolvedValue(undefined)

    // 1. Restore with no staged Data/ (e.g. .json/.bak or skipBackupFile zip) must NEVER touch finish_backup_restore
    await handleData(makeValidBackupPayload())
    expect(mocks.invoke).not.toHaveBeenCalledWith('finish_backup_restore', expect.anything())
    expect(mocks.invoke).not.toHaveBeenCalledWith('get_pending_restore_id')

    // Validation failure with no staged restoreId also must NEVER call finish_backup_restore
    mocks.invoke.mockClear()
    await expect(handleData({ version: 5, localStorage: {}, indexedDB: {} })).rejects.toThrow()
    expect(mocks.invoke).not.toHaveBeenCalledWith('finish_backup_restore', expect.anything())

    // 2. Local/WebDAV unpack returning { payload, restoreId } threads exact restoreId to rollback on malformed JSON
    const unpackedId = 'restore-previous-from-unpack-ipc'
    ;(window as any).api.resolvePath = vi.fn(async () => '/backups')
    ;(window as any).api.backup = {
      restoreFromLocalBackup: vi.fn(async () => ({ payload: '{malformed-json', restoreId: unpackedId })),
      restoreFromWebdav: vi.fn(async () => ({
        payload: JSON.stringify(makeValidBackupPayload()),
        restoreId: null
      }))
    }

    await expect(restoreFromLocal('lich13studio.zip')).rejects.toThrow()
    expect(mocks.invoke).toHaveBeenCalledWith('finish_backup_restore', {
      commit: false,
      restoreId: unpackedId
    })

    mocks.invoke.mockClear()
    await restoreFromWebdav('lich13studio-nodata.zip')
    expect(mocks.invoke).not.toHaveBeenCalledWith('finish_backup_restore', expect.anything())
  })

  it('always evicts memory:// backup paths in BackupService.restore finally even when decompression or JSON parse fails', async () => {
    const deleteSpy = vi.fn(async () => true)
    const modalErrorSpy = vi.fn()
    ;(window as any).modal = { error: modalErrorSpy }
    ;(window as any).api.file = {
      open: vi
        .fn()
        .mockResolvedValueOnce({
          fileName: 'corrupt-1.bak',
          filePath: 'memory://backup-1/corrupt-1.bak',
          path: 'memory://backup-1/corrupt-1.bak',
          content: new Uint8Array([1, 2, 3])
        })
        .mockResolvedValueOnce({
          fileName: 'corrupt-2.bak',
          filePath: 'memory://backup-2/corrupt-2.bak',
          path: 'memory://backup-2/corrupt-2.bak',
          content: new Uint8Array([4, 5, 6])
        }),
      delete: deleteSpy
    }
    ;(window as any).api.zip = {
      decompress: vi
        .fn()
        .mockRejectedValueOnce(new Error('Invalid gzip stream'))
        .mockResolvedValueOnce('{malformed-json')
    }

    await restore()
    expect(deleteSpy).toHaveBeenCalledWith('memory://backup-1/corrupt-1.bak')
    expect(modalErrorSpy).toHaveBeenCalledTimes(1)

    await restore()
    expect(deleteSpy).toHaveBeenCalledWith('memory://backup-2/corrupt-2.bak')
    expect(modalErrorSpy).toHaveBeenCalledTimes(2)
  })
})
