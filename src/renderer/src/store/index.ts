import { loggerService } from '@logger'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { credentialStorageEnabled, mobilePersistStorage } from '@renderer/services/mobile/credentials'
import { isMainTauriWindow, runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { useDispatch, useSelector, useStore } from 'react-redux'
import {
  FLUSH,
  getStoredState,
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

export const isMiniWindowContext = () =>
  typeof window !== 'undefined' &&
  (window.location?.pathname?.endsWith('miniWindow.html') ||
    (!runtimeCapabilities.android && Boolean((window as any).__TAURI_INTERNALS__) && !isMainTauriWindow()))

const basePersistStorage = credentialStorageEnabled ? mobilePersistStorage : storage

export const createPersistStorageAdapter = (
  underlyingStorage: typeof basePersistStorage,
  isReadOnly: () => boolean = isMiniWindowContext
) => ({
  getItem: (key: string) => underlyingStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (isReadOnly()) {
      return
    }
    await underlyingStorage.setItem(key, value)
  },
  removeItem: async (key: string) => {
    if (isReadOnly()) {
      return
    }
    await underlyingStorage.removeItem(key)
  }
})

const persistConfig: PersistConfig<RootState> = {
  key: 'cherry-studio',
  storage: createPersistStorageAdapter(basePersistStorage),
  version: 223,
  throttle: 250,
  blacklist: ['runtime', 'messages', 'messageBlocks'],
  stateReconciler: reconcileActiveSlices,
  migrate
}

const persistedReducer = persistReducer<RootState>(persistConfig, rootReducer)

const SYNCED_SLICE_PREFIXES = ['assistants/', 'settings/', 'llm/', 'shortcuts/', 'inputTools/', 'backup/']

storeSyncService.setOptions({
  syncList: SYNCED_SLICE_PREFIXES
})

let lastMiniRawSnapshot: string | null = null
let lastMiniLiveSyncAt = 0

const store = configureStore({
  reducer: persistedReducer as unknown as typeof rootReducer,
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    }).concat(
      modelCatalogMiddleware,
      () => (next) => (action) => {
        const result = next(action)
        const type = (action as { type?: unknown })?.type
        if (typeof type === 'string' && SYNCED_SLICE_PREFIXES.some((prefix) => type.startsWith(prefix))) {
          lastMiniLiveSyncAt = Date.now()
        }
        return result
      },
      storeSyncService.createMiddleware()
    )
  },
  devTools: import.meta.env.DEV
})

export type AppDispatch = typeof store.dispatch

export const persistor = persistStore(store, undefined, () => {
  if (typeof window === 'undefined') {
    return
  }
  if (isMiniWindowContext()) {
    lastMiniRawSnapshot = localStorage.getItem(`persist:${persistConfig.key}`)
    persistor.pause()
  }
  void window.api?.notifyReduxStoreReady?.()
  logger.info('Redux store ready, notified main process')
})

export async function refreshMiniWindowPersistedState(): Promise<void> {
  if (!isMiniWindowContext()) return
  const rawKey = `persist:${persistConfig.key}`
  const currentRaw = localStorage.getItem(rawKey)
  if (currentRaw === lastMiniRawSnapshot) return
  if (Date.now() - lastMiniLiveSyncAt < 400) return
  try {
    const stored = await getStoredState(persistConfig)
    const migrated = persistConfig.migrate
      ? await persistConfig.migrate(stored as any, persistConfig.version ?? 223)
      : stored
    lastMiniRawSnapshot = currentRaw
    if (migrated) {
      store.dispatch({
        type: REHYDRATE,
        key: persistConfig.key,
        payload: migrated,
        err: undefined
      })
    }
  } catch (error) {
    logger.warn('Failed to refresh mini window persisted state:', error as Error)
  }
}

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
if (typeof window !== 'undefined') {
  window.store = store
}

export async function handleSaveData() {
  logger.info('Flushing redux persistor data')
  await persistor.flush()
  logger.info('Flushed redux persistor data')
}

export default store
