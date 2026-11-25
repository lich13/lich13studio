import { loggerService } from '@logger'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { credentialStorageEnabled, mobilePersistStorage } from '@renderer/services/mobile/credentials'
import { isMainTauriWindow, runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { useDispatch, useSelector, useStore } from 'react-redux'
import {
  FLUSH,
  PAUSE,
  PERSIST,
  type PersistConfig,
  persistReducer,
  persistStore,
  PURGE,
  REGISTER,
  REHYDRATE
} from 'redux-persist'
import autoMergeLevel1 from 'redux-persist/lib/stateReconciler/autoMergeLevel1'
import storage from 'redux-persist/lib/storage'

import storeSyncService from '../services/StoreSyncService'
import assistants from './assistants'
import backup from './backup'
import inputToolsReducer from './inputTools'
import llm from './llm'
import messageBlocksReducer from './messageBlock'
import migrate from './migrate'
import { modelCatalogMiddleware } from './modelCatalogMiddleware'
import newMessagesReducer from './newMessage'
import runtime from './runtime'
import settings from './settings'
import shortcuts from './shortcuts'

const logger = loggerService.withContext('Store')

const rootReducer = combineReducers({
  assistants,
  backup,
  llm,
  settings,
  runtime,
  shortcuts,
  messages: newMessagesReducer,
  messageBlocks: messageBlocksReducer,
  inputTools: inputToolsReducer
})

export type RootState = ReturnType<typeof rootReducer>

export function reconcileActiveSlices<S extends Record<string, any>>(
  inboundState: S,
  originalState: S,
  reducedState: S,
  config: PersistConfig<S>
): S {
  if (!inboundState || typeof inboundState !== 'object') {
    return autoMergeLevel1(inboundState, originalState, reducedState, config)
  }
  const allowedInbound = {} as S
  for (const key of Object.keys(inboundState) as Array<keyof S>) {
    if (Object.prototype.hasOwnProperty.call(originalState, key)) {
      allowedInbound[key] = inboundState[key]
    }
  }
  return autoMergeLevel1(allowedInbound, originalState, reducedState, config)
}

const persistedReducer = persistReducer<RootState>(
  {
    key: 'cherry-studio',
    storage: credentialStorageEnabled ? mobilePersistStorage : storage,
    version: 223,
    blacklist: ['runtime', 'messages', 'messageBlocks'],
    stateReconciler: reconcileActiveSlices,
    migrate
  },
  rootReducer
)

storeSyncService.setOptions({
  syncList: ['assistants/', 'settings/', 'llm/']
})

const store = configureStore({
  reducer: persistedReducer as unknown as typeof rootReducer,
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    }).concat(modelCatalogMiddleware, storeSyncService.createMiddleware())
  },
  devTools: import.meta.env.DEV
})

export type AppDispatch = typeof store.dispatch

const isMiniWindowContext = () =>
  typeof window !== 'undefined' &&
  (window.location?.pathname?.endsWith('miniWindow.html') ||
    (!runtimeCapabilities.android && Boolean((window as any).__TAURI_INTERNALS__) && !isMainTauriWindow()))

export const persistor = persistStore(store, undefined, () => {
  if (!isMiniWindowContext()) {
    void import('@renderer/services/PlatformModelCatalogService').then(({ platformModelCatalogService }) =>
      platformModelCatalogService.initialize()
    )
  }
  void window.api?.notifyReduxStoreReady?.()
  logger.info('Redux store ready, notified main process')
})

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
window.store = store

export async function handleSaveData() {
  logger.info('Flushing redux persistor data')
  await persistor.flush()
  logger.info('Flushed redux persistor data')
}

export default store
