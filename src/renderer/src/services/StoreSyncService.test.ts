import type { StoreSyncAction } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

import storeSyncService from './StoreSyncService'

const createWindowApi = () => {
  let broadcastCallback: ((action: StoreSyncAction) => void) | undefined

  return {
    api: {
      storeSync: {
        onUpdate: vi.fn(async () => undefined),
        onBroadcast: vi.fn((callback: (action: StoreSyncAction) => void) => {
          broadcastCallback = callback
          return vi.fn()
        }),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined)
      }
    },
    addEventListener: vi.fn(),
    emitBroadcast: (action: StoreSyncAction) => broadcastCallback?.(action)
  }
}

describe('StoreSyncService', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { window: unknown }).window = createWindowApi()
    storeSyncService.unsubscribe()
    vi.clearAllMocks()
  })

  it('broadcasts whitelisted store updates to other windows', async () => {
    const windowApi = createWindowApi()
    ;(globalThis as typeof globalThis & { window: unknown }).window = windowApi
    storeSyncService.setOptions({ syncList: ['assistants/'] })

    const next = vi.fn()
    const action = {
      type: 'assistants/addTopic',
      payload: { assistantId: 'default', topic: { id: 'mini-topic' } }
    }
    const middleware = storeSyncService.createMiddleware()({} as any)(next)

    middleware(action)
    await vi.waitFor(() => expect(windowApi.api.storeSync.onUpdate).toHaveBeenCalledWith(action))
    expect(next).toHaveBeenCalledWith(action)
  })

  it('dispatches broadcast actions received from another window', () => {
    const windowApi = createWindowApi()
    const dispatch = vi.fn()
    ;(globalThis as typeof globalThis & { window: unknown }).window = {
      ...windowApi,
      store: { dispatch }
    }

    storeSyncService.subscribe()
    windowApi.emitBroadcast({
      type: 'assistants/addTopic',
      payload: { assistantId: 'default', topic: { id: 'mini-topic' } },
      meta: { fromSync: true, source: 'tauri:mini-window' }
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'assistants/addTopic',
      payload: { assistantId: 'default', topic: { id: 'mini-topic' } },
      meta: { fromSync: true, source: 'tauri:mini-window' }
    })
  })

  it('does not rebroadcast actions that came from sync', () => {
    const windowApi = createWindowApi()
    ;(globalThis as typeof globalThis & { window: unknown }).window = windowApi
    storeSyncService.setOptions({ syncList: ['assistants/'] })

    const action = {
      type: 'assistants/addTopic',
      payload: { assistantId: 'default', topic: { id: 'mini-topic' } },
      meta: { fromSync: true }
    }
    const middleware = storeSyncService.createMiddleware()({} as any)(vi.fn())

    middleware(action)

    expect(windowApi.api.storeSync.onUpdate).not.toHaveBeenCalled()
  })
})
