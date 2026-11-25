import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@renderer/tauri-shim'

import { loggerService } from '@logger'
import { initializeMobileCredentials } from '@renderer/services/mobile/credentials'
import { reconcilePendingBackupRestore } from '@renderer/services/restoreReconciliation'
import { MemoryKeyv } from '@renderer/utils/memoryKeyv'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

const MiniWindowApp = lazy(async () => {
  await initializeMobileCredentials()
  await reconcilePendingBackupRestore()
  return import('./MiniWindowApp')
})

loggerService.initWindowSource('MiniWindow')

if (!window.keyv) {
  window.keyv = new MemoryKeyv()
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <Suspense fallback={null}>
    <MiniWindowApp />
  </Suspense>
)
