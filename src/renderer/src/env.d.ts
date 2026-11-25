/// <reference types="vite/client" />

import type { HookAPI } from 'antd/es/modal/useModal'
import type { NavigateFunction } from 'react-router-dom'

import type {
  addToast,
  closeAll,
  closeToast,
  error,
  getToastQueue,
  info,
  isToastClosing,
  loading,
  success,
  warning
} from './components/TopView/toast'
import type { MemoryKeyv } from './utils/memoryKeyv'

interface ImportMetaEnv {
  VITE_RENDERER_INTEGRATED_MODEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    api: Record<string, any>
    root: HTMLElement
    modal: HookAPI
    keyv: MemoryKeyv
    store: any
    navigate: NavigateFunction
    toast: {
      getToastQueue: typeof getToastQueue
      addToast: typeof addToast
      closeToast: typeof closeToast
      closeAll: typeof closeAll
      isToastClosing: typeof isToastClosing
      error: typeof error
      success: typeof success
      warning: typeof warning
      info: typeof info
      loading: typeof loading
    }
    __TAURI__?: {
      event?: {
        emit?: <T>(event: string, payload?: T) => Promise<void>
        listen?: <T>(
          event: string,
          handler: (event: { event: string; id: number; payload: T }) => void
        ) => Promise<() => void>
      }
      core?: {
        invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
      }
    }
    __LICH13_TAURI_SHIM__?: boolean
  }
}
