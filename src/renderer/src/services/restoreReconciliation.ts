import { loggerService } from '@logger'
import { invoke } from '@tauri-apps/api/core'

export const RESTORE_COMMITTED_SETTING_ID = 'backup:committed-restore-id'

const logger = loggerService.withContext('RestoreReconciliation')

export interface RestoreSettingsStore {
  get: (id: string) => Promise<{ id: string; value: unknown } | undefined>
  delete: (id: string) => Promise<void>
}

export function isNativeTauriRuntime(): boolean {
  const win = (globalThis as { window?: { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown } }).window
  return Boolean(win?.__TAURI_INTERNALS__ || win?.__TAURI__)
}

export async function reconcilePendingBackupRestore(options?: {
  isNative?: boolean
  invokeCommand?: typeof invoke
  loadSettingsStore?: () => Promise<RestoreSettingsStore>
}): Promise<'none' | 'committed' | 'rolled_back' | 'deferred'> {
  const isNative = options?.isNative ?? isNativeTauriRuntime()
  if (!isNative) {
    return 'none'
  }
  const invokeCmd = options?.invokeCommand ?? invoke
  let pendingRestoreId: string | null = null
  try {
    pendingRestoreId = await invokeCmd<string | null>('get_pending_restore_id')
  } catch (error) {
    logger.warn('Failed to query pending backup restore marker', error as Error)
    return 'deferred'
  }
  if (!pendingRestoreId) {
    return 'none'
  }

  const loadStore =
    options?.loadSettingsStore ??
    (async () => {
      const { default: db } = await import('@renderer/databases')
      return db.settings
    })

  let settingsStore: RestoreSettingsStore
  let committed = false
  try {
    settingsStore = await loadStore()
    const marker = await settingsStore.get(RESTORE_COMMITTED_SETTING_ID)
    committed = marker?.value === pendingRestoreId
  } catch (error) {
    // Do not commit or roll back if IndexedDB could not be read; keep both directories intact for retry.
    logger.warn('Deferred pending backup restore reconciliation because IndexedDB could not be read', error as Error)
    return 'deferred'
  }

  try {
    await invokeCmd('finish_backup_restore', { commit: committed, restoreId: pendingRestoreId })
  } catch (error) {
    logger.warn('Failed to finalize pending backup restore on startup; marker retained for retry', error as Error)
    return 'deferred'
  }

  if (committed) {
    await settingsStore.delete(RESTORE_COMMITTED_SETTING_ID).catch(() => {})
    return 'committed'
  }
  return 'rolled_back'
}
