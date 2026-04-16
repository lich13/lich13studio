import './assets/styles/index.css'
import './assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import KeyvStorage from '@kangfenmao/keyv-storage'
import StartupScreen from '@renderer/components/StartupScreen'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

const App = lazy(() => import('./App'))

if (!window.keyv) {
  window.keyv = new KeyvStorage()
}
void window.keyv.init()

function BootApp() {
  return (
    <Suspense fallback={<StartupScreen />}>
      <App />
    </Suspense>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<BootApp />)
