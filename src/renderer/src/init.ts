import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import storeSyncService from './services/StoreSyncService'
import store from './store'

loggerService.initWindowSource('mainWindow')

function initKeyv() {
  window.keyv = window.keyv || new KeyvStorage()
  void window.keyv.init()
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
