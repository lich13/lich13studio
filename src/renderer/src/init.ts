import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import { startAutoSync } from './services/BackupService'
import storeSyncService from './services/StoreSyncService'
import { webTraceService } from './services/WebTraceService'
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
      startAutoSync()
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

initKeyv()
initAutoSync()
initStoreSync()
initWebTrace()
