import { loggerService } from '@logger'

import { handleData } from './BackupService'

const logger = loggerService.withContext('LegacyLocalMigration')

const MIGRATION_FLAG_KEY = 'legacy-local-migration-done'
const MIGRATION_FILE_NAME = 'legacy-local-migration.json'

const isMissingMigrationFile = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|enoent|failed to read/i.test(message)
}

export async function runLegacyLocalMigrationIfNeeded() {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === '1') {
    return false
  }

  try {
    const appInfo = await window.api.getAppInfo()
    const payload = await window.api.backup.restoreFromLocalBackup(MIGRATION_FILE_NAME, appInfo.configPath)

    if (!payload) {
      return false
    }

    const data = JSON.parse(payload)
    const persistState = data?.localStorage?.['persist:cherry-studio']
    if (!persistState || !data?.indexedDB || typeof data.indexedDB !== 'object') {
      logger.warn('Skipping legacy migration because payload is invalid')
      return false
    }

    localStorage.setItem(MIGRATION_FLAG_KEY, '1')
    logger.info('Applying legacy local migration payload')
    await handleData(data)
    return true
  } catch (error) {
    if (!isMissingMigrationFile(error)) {
      logger.error('Failed to apply legacy local migration payload', error as Error)
    }
    return false
  }
}
