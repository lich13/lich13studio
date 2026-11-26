import '@ant-design/v5-patch-for-react-19'
import '@renderer/databases'

import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import storeSyncService from '@renderer/services/StoreSyncService'
import store, { persistor } from '@renderer/store'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import StyleSheetManager from '../../context/StyleSheetManager'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

storeSyncService.subscribe()

function MiniWindow(): React.ReactElement {
  useEffect(() => {
    window.toast = getToastUtilities()
  }, [])

  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider>
          <AntdProvider>
            <CodeStyleProvider>
              <PersistGate loading={null} persistor={persistor}>
                <ErrorBoundary>
                  <HomeWindow />
                </ErrorBoundary>
              </PersistGate>
            </CodeStyleProvider>
          </AntdProvider>
        </ThemeProvider>
      </StyleSheetManager>
    </Provider>
  )
}

export default MiniWindow
