import { loggerService } from '@logger'
import { MemoryKeyv } from '@renderer/utils/memoryKeyv'

import storeSyncService from './services/StoreSyncService'
import store from './store'

loggerService.initWindowSource('mainWindow')

function initKeyv() {
  if (!window.keyv) {
    window.keyv = new MemoryKeyv()
  }
}

function initAutoSync() {
  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync } = store.getState().settings
    if (webdavAutoSync || localBackupAutoSync) {
      void import('./services/BackupService')
        .then(({ startAutoSync }) => {
          startAutoSync()
        })
        .catch((error) => {
          loggerService.withContext('Init').error('Failed to load BackupService for auto sync:', error as Error)
        })
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

initKeyv()
initAutoSync()
initStoreSync()
