import './services/mobile/webviewCompatibility'
import './assets/styles/index.css'
import './assets/styles/tailwind.css'
import './assets/styles/mobile.css'
import './services/mobile/runtime'
import '@ant-design/v5-patch-for-react-19'

import KeyvStorage from '@kangfenmao/keyv-storage'
import StartupScreen from '@renderer/components/StartupScreen'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'

import { initializeMobileCredentials } from './services/mobile/credentials'

let secureStorageFailed = false
const App = lazy(async () => {
  try {
    await initializeMobileCredentials()
  } catch (error) {
    secureStorageFailed = true
    throw error
  }
  return import('./App')
})

if (!window.keyv) {
  window.keyv = new KeyvStorage()
}
void window.keyv.init()

function BootApp() {
  return (
    <ErrorBoundary
      fallbackRender={() => (
        <main style={{ padding: 24, overflowWrap: 'anywhere' }}>
          <p>
            {secureStorageFailed
              ? navigator.language.startsWith('zh')
                ? '无法读取安全存储，原有数据未被清除。'
                : 'Secure storage could not be opened. Existing data has been preserved.'
              : navigator.language.startsWith('zh')
                ? '应用启动失败，请重试。'
                : 'Could not start the app. Please retry.'}
          </p>
          <button type="button" style={{ minHeight: 48, padding: '8px 24px' }} onClick={() => location.reload()}>
            {navigator.language.startsWith('zh') ? '重试' : 'Retry'}
          </button>
        </main>
      )}>
      <Suspense fallback={<StartupScreen />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<BootApp />)
