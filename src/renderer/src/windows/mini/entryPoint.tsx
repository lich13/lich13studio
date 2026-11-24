import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@renderer/tauri-shim'

import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

const MiniWindowApp = lazy(() => import('./MiniWindowApp'))

loggerService.initWindowSource('MiniWindow')

function initKeyv() {
  window.keyv = new KeyvStorage()
  void window.keyv.init()
}
initKeyv()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <Suspense fallback={null}>
    <MiniWindowApp />
  </Suspense>
)
