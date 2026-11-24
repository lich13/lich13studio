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

import { reconcileActiveSlices } from './index'
import migrate from './migrate'

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
})
