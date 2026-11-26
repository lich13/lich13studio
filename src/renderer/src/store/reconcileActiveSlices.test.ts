// @vitest-environment jsdom
import { combineReducers } from '@reduxjs/toolkit'
import storage from 'redux-persist/lib/storage'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/mobile/credentials', () => ({
  credentialStorageEnabled: false,
  mobilePersistStorage: storage
}))

import store, {
  createPersistStorageAdapter,
  persistor,
  reconcileActiveSlices,
  refreshMiniWindowPersistedState
} from './index'
import migrate from './migrate'
import { setMathEngine } from './settings'

describe('reconcileActiveSlices and lazy store migration', () => {
  it('strips retired slice keys from inbound persisted state without triggering combineReducers warnings', () => {
    const testReducer = combineReducers({
      llm: (state = { providers: [] as string[] }) => state,
      settings: (state = { chatRequestMode: 'stream' }) => state
    })
    const originalState = testReducer(undefined, { type: '@@INIT' })
    const inboundState: Record<string, any> = {
      llm: { providers: ['openai'] },
      settings: { chatRequestMode: 'non-stream' },
      minapps: { enabled: ['legacy-app'] },
      paintings: { zhipu_paintings: [] },
      note: { notesPath: '/legacy/notes' },
      ocr: { providers: [] },
      preprocess: { providers: [] },
      codeTools: { selectedModels: {} },
      copilot: {},
      openclaw: {},
      toolPermissions: { requests: {} },
      _persist: { version: 223, rehydrated: true }
    }

    const reconciled = reconcileActiveSlices(inboundState, originalState as any, originalState as any, {
      key: 'cherry-studio',
      storage
    })

    expect(reconciled).toEqual({
      llm: { providers: ['openai'] },
      settings: { chatRequestMode: 'non-stream' }
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const reduced = testReducer(reconciled, { type: 'ANY_ACTION' })
      expect(reduced.llm.providers).toEqual(['openai'])
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('migrates both modern (>=216) and legacy (<216) persisted snapshots to version 223', async () => {
    const modern = (await migrate(
      {
        _persist: { version: 222, rehydrated: false },
        settings: { enableDataCollection: true },
        assistants: {
          defaultAssistant: { settings: { streamOutput: false } },
          assistants: []
        }
      } as any,
      223
    )) as any

    expect(modern.settings.chatRequestMode).toBe('non-stream')
    expect(modern.settings.enableDataCollection).toBeUndefined()

    const legacy = (await migrate(
      {
        _persist: { version: 210, rehydrated: false },
        llm: {
          providers: [{ id: 'old', type: 'openai-response', apiHost: 'https://example.invalid/v1', apiKey: 'secret' }],
          defaultModel: { id: 'm', provider: 'old' },
          settings: {}
        },
        settings: { notification: {} },
        assistants: {
          defaultAssistant: { settings: {} },
          assistants: []
        }
      } as any,
      223
    )) as any

    expect(legacy.llm.providers).toEqual([])
    expect(legacy.settings.language).toBe('zh-CN')
    expect(legacy.settings.chatRequestMode).toBe('stream')
  })

  it('refreshes mini window persisted state with migration while protecting live synced state inside throttle window', async () => {
    const originalHref = window.location.href
    window.history.replaceState({}, '', '/miniWindow.html')
    try {
      const staleSnapshot = JSON.stringify({
        settings: JSON.stringify({ ...store.getState().settings, mathEngine: 'MathJax', fontSize: 18 }),
        _persist: JSON.stringify({ version: 223, rehydrated: true })
      })
      localStorage.setItem('persist:cherry-studio', staleSnapshot)

      // Live action inside throttle window (<400ms) must not be clobbered by disk snapshot
      store.dispatch(setMathEngine('none'))
      await refreshMiniWindowPersistedState()
      expect(store.getState().settings.mathEngine).toBe('none')

      // Advance past throttle window: changed disk snapshot runs migrate ('MathJax' -> 'KaTeX') and rehydrates once
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
      try {
        await refreshMiniWindowPersistedState()
        expect(store.getState().settings.mathEngine).toBe('KaTeX')
        expect(store.getState().settings.fontSize).toBe(18)

        // Subsequent show with identical raw snapshot is a 0-cost no-op
        const prevSettingsRef = store.getState().settings
        await refreshMiniWindowPersistedState()
        expect(store.getState().settings).toBe(prevSettingsRef)
      } finally {
        nowSpy.mockRestore()
      }
    } finally {
      window.history.replaceState({}, '', originalHref)
      localStorage.removeItem('persist:cherry-studio')
    }
  })

  it('gives MiniWindow a strictly read-only storage adapter so REHYDRATE and flush never overwrite MainWindow state', async () => {
    const underlying = {
      getItem: vi.fn(async () => '{"settings":"{}"}'),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {})
    }
    let miniMode = true
    const adapter = createPersistStorageAdapter(underlying as any, () => miniMode)

    await expect(adapter.getItem('persist:cherry-studio')).resolves.toBe('{"settings":"{}"}')
    await adapter.setItem('persist:cherry-studio', '{"settings":"{\\"theme\\":\\"light\\"}"}')
    await adapter.removeItem('persist:cherry-studio')
    expect(underlying.setItem).not.toHaveBeenCalled()
    expect(underlying.removeItem).not.toHaveBeenCalled()

    miniMode = false
    await adapter.setItem('persist:cherry-studio', '{"settings":"{\\"theme\\":\\"dark\\"}"}')
    expect(underlying.setItem).toHaveBeenCalledTimes(1)

    // Also verify real store + persistor.flush() in MiniWindow context never mutates localStorage['persist:cherry-studio']
    const originalHref = window.location.href
    window.history.replaceState({}, '', '/miniWindow.html')
    const mainWindowSaved = JSON.stringify({
      settings: JSON.stringify({ ...store.getState().settings, fontSize: 22 }),
      _persist: JSON.stringify({ version: 223, rehydrated: true })
    })
    localStorage.setItem('persist:cherry-studio', mainWindowSaved)
    try {
      store.dispatch(setMathEngine('none'))
      await persistor.flush()
      expect(localStorage.getItem('persist:cherry-studio')).toBe(mainWindowSaved)
    } finally {
      window.history.replaceState({}, '', originalHref)
      localStorage.removeItem('persist:cherry-studio')
    }
  })
})
