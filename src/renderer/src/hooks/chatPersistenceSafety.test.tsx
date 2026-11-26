// @vitest-environment jsdom
import { configureStore } from '@reduxjs/toolkit'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearMessages: vi.fn<(_id: string) => Promise<void>>(),
  deleteTopicRow: vi.fn<(_id: string) => Promise<void>>(),
  updateMessage: vi.fn(async () => undefined),
  updateBlocks: vi.fn(async () => undefined),
  appendMessage: vi.fn<(..._args: any[]) => Promise<void>>(async () => undefined),
  uploadFiles: vi.fn<(_files: any[]) => Promise<any[]>>(async (files) => files),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  storeRef: null as any,
  inputbarCoreProps: null as any,
  inputbarToolsCtx: null as any
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      silly: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/databases', () => ({
  default: {
    topics: {
      get: vi.fn(),
      toArray: vi.fn(async () => []),
      delete: mocks.deleteTopicRow,
      where: vi.fn(() => ({ equals: () => ({ modify: vi.fn() }) }))
    }
  },
  db: {
    topics: {
      get: vi.fn(),
      toArray: vi.fn(async () => []),
      delete: mocks.deleteTopicRow,
      where: vi.fn(() => ({ equals: () => ({ modify: vi.fn() }) }))
    }
  }
}))

vi.mock('@renderer/services/db', () => ({
  dbService: {
    clearMessages: mocks.clearMessages,
    updateMessage: mocks.updateMessage,
    updateBlocks: mocks.updateBlocks,
    appendMessage: mocks.appendMessage,
    deleteMessage: vi.fn(async () => undefined),
    deleteMessages: vi.fn(async () => undefined)
  }
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    uploadFiles: mocks.uploadFiles,
    cleanupUncommittedDraftFiles: vi.fn(async () => undefined)
  }
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/pages/home/Inputbar/components/InputbarCore', async () => {
  const { useInputbarTools } = await import('@renderer/pages/home/Inputbar/context/InputbarToolsProvider')
  return {
    InputbarCore: (props: any) => {
      mocks.inputbarCoreProps = props
      mocks.inputbarToolsCtx = useInputbarTools()
      return null
    }
  }
})

vi.mock('@renderer/pages/home/Inputbar/InputbarTools', () => ({ default: () => null }))
vi.mock('@renderer/pages/home/Inputbar/MentionModelsInput', () => ({ default: () => null }))
vi.mock('@renderer/pages/home/Inputbar/TokenCount', () => ({ default: () => null }))
vi.mock('@renderer/components/ChatRequestModeToggle', () => ({ default: () => null }))

vi.mock('@renderer/store', async () => {
  const { useDispatch, useSelector, useStore } = await import('react-redux')
  return {
    get default() {
      return mocks.storeRef
    },
    useAppDispatch: () => useDispatch(),
    useAppSelector: (selector: any) => useSelector(selector),
    useAppStore: () => useStore()
  }
})

import Inputbar from '@renderer/pages/home/Inputbar/Inputbar'
import { CacheService } from '@renderer/services/CacheService'
import assistantsReducer, { addAssistant } from '@renderer/store/assistants'
import llmReducer, { addProvider } from '@renderer/store/llm'
import messageBlocksReducer, { upsertManyBlocks } from '@renderer/store/messageBlock'
import newMessagesReducer, { newMessagesActions } from '@renderer/store/newMessage'
import runtimeReducer from '@renderer/store/runtime'
import settingsReducer from '@renderer/store/settings'
import shortcutsReducer from '@renderer/store/shortcuts'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

import { useAssistant, useAssistants } from './useAssistant'
import { useInputText } from './useInputText'
import { useMessageOperations } from './useMessageOperations'
import { TopicManager } from './useTopic'

function createTestStore() {
  const testStore = configureStore({
    reducer: {
      assistants: assistantsReducer,
      llm: llmReducer,
      messages: newMessagesReducer,
      messageBlocks: messageBlocksReducer,
      runtime: runtimeReducer,
      settings: settingsReducer,
      shortcuts: shortcutsReducer
    }
  })
  mocks.storeRef = testStore
  return testStore
}

describe('chat hooks persistence & partial-failure safety', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.clearMessages.mockReset().mockResolvedValue(undefined)
    mocks.deleteTopicRow.mockReset().mockResolvedValue(undefined)
    mocks.updateMessage.mockReset().mockResolvedValue(undefined)
    mocks.updateBlocks.mockReset().mockResolvedValue(undefined)
    mocks.toastError.mockReset()
    mocks.toastWarning.mockReset()
    ;(window as any).toast = {
      error: mocks.toastError,
      warning: mocks.toastWarning,
      success: vi.fn(),
      info: vi.fn()
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains undeleted topics and assistant in Redux when Dexie fails mid-deletion in removeAssistant and removeAllTopics', async () => {
    const store = createTestStore()
    const topicOk = {
      id: 'topic-ok',
      assistantId: 'ast-target',
      name: 'Succeeded Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const topicFail = {
      id: 'topic-fail',
      assistantId: 'ast-target',
      name: 'Failed Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    store.dispatch(
      addAssistant({
        id: 'ast-target',
        name: 'Target Assistant',
        prompt: '',
        topics: [topicOk, topicFail],
        type: 'chat'
      } as any)
    )

    let assistantsHook!: ReturnType<typeof useAssistants>
    let assistantHook!: ReturnType<typeof useAssistant>
    function Harness() {
      assistantsHook = useAssistants()
      assistantHook = useAssistant('ast-target')
      return null
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Provider, { store }, createElement(Harness)))
    })

    // 1. removeAllTopics partial failure: removes topic-ok, retains topic-fail in Redux, surfaces toast & throws
    mocks.deleteTopicRow.mockImplementation(async (id: string) => {
      if (id === 'topic-fail') throw new Error('DexieLockedError')
    })

    await act(async () => {
      await expect(assistantHook.removeAllTopics()).rejects.toThrow('DexieLockedError')
    })

    const afterPartialClear = store.getState().assistants.assistants.find((a) => a.id === 'ast-target')!
    expect(afterPartialClear.topics.map((t) => t.id)).toEqual(['topic-fail'])
    expect(mocks.toastError).toHaveBeenCalledWith('common.delete_failed')

    // 2. removeAssistant partial failure: keeps ast-target and topic-fail in Redux so user can retry
    mocks.toastError.mockClear()
    await act(async () => {
      await expect(assistantsHook.removeAssistant('ast-target')).rejects.toThrow('DexieLockedError')
    })
    expect(
      store
        .getState()
        .assistants.assistants.find((a) => a.id === 'ast-target')
        ?.topics.map((t) => t.id)
    ).toEqual(['topic-fail'])
    expect(mocks.toastError).toHaveBeenCalledWith('common.delete_failed')

    // 3. Retry once Dexie succeeds: assistant is now removed cleanly
    mocks.deleteTopicRow.mockResolvedValue(undefined)
    await act(async () => {
      await assistantsHook.removeAssistant('ast-target')
    })
    expect(store.getState().assistants.assistants.find((a) => a.id === 'ast-target')).toBeUndefined()

    await act(async () => {
      root.unmount()
    })
  })

  it('preserves live edits made after send snapshot in useInputText without stale-closure clobbering', async () => {
    const onChanges: string[] = []
    let hookApi!: ReturnType<typeof useInputText>

    function InputHarness() {
      hookApi = useInputText({
        initialValue: 'first message',
        onChange: (val) => onChanges.push(val)
      })
      return null
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(InputHarness))
    })

    // Capture handleSetText BEFORE user types new text while async uploadFiles is awaiting
    const capturedSetTextAtSendStart = hookApi.setText
    const sendingText = hookApi.text

    // Simulate user typing a follow-up draft while uploadFiles / appendMessage is awaiting
    await act(async () => {
      hookApi.setText('follow-up typed during upload')
    })
    expect(hookApi.text).toBe('follow-up typed during upload')

    // Send finishes and runs Inputbar's conditional clear using capturedSetTextAtSendStart
    let cleared = false
    await act(async () => {
      capturedSetTextAtSendStart((currentText) => {
        if (currentText === sendingText) {
          cleared = true
          return ''
        }
        return currentText
      })
    })

    expect(cleared).toBe(false)
    expect(hookApi.text).toBe('follow-up typed during upload')
    expect(onChanges.at(-1)).toBe('follow-up typed during upload')

    // When user did NOT edit during send, conditional clear resets text to ''
    const secondSnapshot = hookApi.text
    await act(async () => {
      capturedSetTextAtSendStart((currentText) => {
        if (currentText === secondSnapshot) {
          cleared = true
          return ''
        }
        return currentText
      })
    })
    expect(cleared).toBe(true)
    expect(hookApi.text).toBe('')

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps blocks in Redux when TopicManager.clearTopicMessages fails in Dexie and cancels invoking tools in pauseMessages', async () => {
    const store = createTestStore()
    const toolBlock = {
      id: 'blk-tool-live',
      messageId: 'msg-ast-live',
      type: MessageBlockType.TOOL,
      toolId: 'call-live',
      status: MessageBlockStatus.STREAMING,
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: {
        rawMcpToolResponse: {
          id: 'call-live',
          toolUseId: 'call-live',
          tool: { id: 'bash', name: 'bash', type: 'builtin' },
          arguments: { cmd: 'ls' },
          status: 'invoking'
        }
      }
    } as any

    store.dispatch(upsertManyBlocks([toolBlock]))
    store.dispatch(
      newMessagesActions.messagesReceived({
        topicId: 'topic-live',
        messages: [
          {
            id: 'msg-ast-live',
            askId: 'ask-1',
            role: 'assistant',
            assistantId: 'ast-1',
            topicId: 'topic-live',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: AssistantMessageStatus.PROCESSING,
            blocks: ['blk-tool-live']
          } as any
        ]
      })
    )

    // 1. pauseMessages marks both block.status = PAUSED and rawMcpToolResponse.status = 'cancelled' and persists them
    let ops!: ReturnType<typeof useMessageOperations>
    const topicObj = {
      id: 'topic-live',
      assistantId: 'ast-1',
      name: 'Live',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    function OpsHarness() {
      ops = useMessageOperations(topicObj as any)
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Provider, { store }, createElement(OpsHarness)))
    })

    await act(async () => {
      await ops.pauseMessages()
    })

    expect(store.getState().messageBlocks.entities['blk-tool-live']).toMatchObject({
      status: MessageBlockStatus.PAUSED,
      metadata: { rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' }) }
    })
    expect(mocks.updateBlocks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'blk-tool-live',
        status: MessageBlockStatus.PAUSED,
        metadata: { rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' }) }
      })
    ])

    // 2. TopicManager.clearTopicMessages retains Redux blocks when Dexie clearMessages fails
    mocks.clearMessages.mockRejectedValueOnce(new Error('DexieDiskIOError'))
    await expect(TopicManager.clearTopicMessages('topic-live')).rejects.toThrow('DexieDiskIOError')
    expect(store.getState().messageBlocks.entities['blk-tool-live']).toBeDefined()
    expect(store.getState().messages.messageIdsByTopic['topic-live']).toEqual(['msg-ast-live'])

    // Once Dexie succeeds, both blocks and messages are removed together
    mocks.clearMessages.mockResolvedValueOnce(undefined)
    await TopicManager.clearTopicMessages('topic-live')
    expect(store.getState().messageBlocks.entities['blk-tool-live']).toBeUndefined()
    expect(store.getState().messages.messageIdsByTopic['topic-live']).toBeUndefined()

    await act(async () => {
      root.unmount()
    })
  })

  it('Inputbar awaits user-message DB persistence before clearing draft and preserves newly edited text/files during async upload', async () => {
    const store = createTestStore()
    mocks.appendMessage.mockReset().mockResolvedValue(undefined)
    mocks.uploadFiles.mockReset().mockImplementation(async (files) => files)
    ;(window as any).keyv = { get: vi.fn(), set: vi.fn(), remove: vi.fn() }

    store.dispatch(
      addProvider({
        id: 'prov-openai',
        name: 'OpenAI',
        type: 'openai-response',
        apiHost: 'https://api.example.invalid/v1',
        apiKey: 'sk-test',
        enabled: true,
        models: []
      } as any)
    )
    const model = { id: 'gpt-6.1-sol', provider: 'prov-openai', name: 'GPT-6.1', group: 'OpenAI' } as any
    const topic = {
      id: 'topic-inputbar',
      assistantId: 'ast-inputbar',
      name: 'Inputbar Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const assistant = {
      id: 'ast-inputbar',
      name: 'Coder',
      prompt: '',
      model,
      topics: [topic],
      type: 'chat'
    } as any
    store.dispatch(addAssistant(assistant))

    const draftKey = 'inputbar-draft-topic-inputbar'
    CacheService.set(draftKey, 'unsent important prompt', 60_000)

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Inputbar, { assistant, topic: topic as any, setActiveTopic: vi.fn() })
        )
      )
    })

    const file1 = { id: 'file-1', name: 'a.txt', origin_name: 'a.txt', path: '/tmp/a.txt', size: 5, ext: '.txt' } as any
    const file2 = { id: 'file-2', name: 'b.txt', origin_name: 'b.txt', path: '/tmp/b.txt', size: 6, ext: '.txt' } as any
    await act(async () => {
      mocks.inputbarToolsCtx.setFiles([file1])
    })

    // 1. User-message DB persistence fails -> draft text, files, and CacheService remain intact and toast.error fires
    mocks.appendMessage.mockRejectedValueOnce(new Error('IDB QuotaExceeded'))
    await act(async () => {
      await mocks.inputbarCoreProps.handleSendMessage()
    })
    expect(mocks.toastError).toHaveBeenCalledWith('common.errors.create_message')
    expect(mocks.inputbarCoreProps.text).toBe('unsent important prompt')
    expect(mocks.inputbarToolsCtx.files.map((f: any) => f.id)).toEqual(['file-1'])
    expect(CacheService.get<string>(draftKey)).toBe('unsent important prompt')

    // 2. User edits text and attaches file-2 while uploadFiles is awaiting -> submitted file-1 is removed, file-2 & new text survive!
    let resolveUpload!: (uploaded: any[]) => void
    mocks.uploadFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    // Persist userMessage succeeds; reject assistant stub append so background LLM network call does not start in test
    mocks.appendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('skip-llm'))

    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = mocks.inputbarCoreProps.handleSendMessage()
    })
    await act(async () => {
      mocks.inputbarCoreProps.onTextChange('newly typed while uploading')
      mocks.inputbarToolsCtx.setFiles([file1, file2])
    })
    await act(async () => {
      resolveUpload([file1])
      await sendPromise
    })

    expect(mocks.inputbarCoreProps.text).toBe('newly typed while uploading')
    expect(CacheService.get<string>(draftKey)).toBe('newly typed while uploading')
    expect(mocks.inputbarToolsCtx.files.map((f: any) => f.id)).toEqual(['file-2'])

    // 3. Normal send with no concurrent edits clears text, files, and CacheService draft
    mocks.appendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('skip-llm'))
    await act(async () => {
      await mocks.inputbarCoreProps.handleSendMessage()
    })
    expect(mocks.inputbarCoreProps.text).toBe('')
    expect(CacheService.get<string>(draftKey)).toBeNull()
    expect(mocks.inputbarToolsCtx.files).toEqual([])

    // 4. Duplicate rapid send while uploadFiles is awaiting is ignored, and topic-switching A -> B -> A
    // while re-typing the exact same text ("yes") preserves Topic A's newly edited draft & CacheService!
    await act(async () => {
      mocks.inputbarCoreProps.onTextChange('yes')
      mocks.inputbarToolsCtx.setFiles([file1])
    })
    let resolveTopicAUpload!: (uploaded: any[]) => void
    mocks.uploadFiles.mockClear()
    mocks.uploadFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTopicAUpload = resolve
        })
    )
    mocks.appendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('skip-llm'))

    let firstSendInFlight!: Promise<void>
    await act(async () => {
      firstSendInFlight = mocks.inputbarCoreProps.handleSendMessage()
      // Rapid second Enter while first send is still uploading must be a no-op
      await mocks.inputbarCoreProps.handleSendMessage()
    })
    expect(mocks.uploadFiles).toHaveBeenCalledTimes(1)

    const topicB = {
      id: 'topic-inputbar-b',
      assistantId: 'ast-inputbar',
      name: 'Topic B',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const draftKeyB = 'inputbar-draft-topic-inputbar-b'
    CacheService.set(draftKeyB, 'draft on topic B', 60_000)

    // Switch A -> B while Topic A upload is still pending
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Inputbar, { assistant, topic: topicB as any, setActiveTopic: vi.fn() })
        )
      )
    })
    expect(mocks.inputbarCoreProps.text).toBe('draft on topic B')

    // Switch B -> A and re-edit Topic A's text back to the exact same string ("yes")
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Inputbar, { assistant, topic: topic as any, setActiveTopic: vi.fn() })
        )
      )
    })
    await act(async () => {
      mocks.inputbarCoreProps.onTextChange('')
      mocks.inputbarCoreProps.onTextChange('yes')
    })

    // Resolve Topic A's earlier send: neither Topic A's re-typed "yes" nor Topic B's draft may be wiped
    await act(async () => {
      resolveTopicAUpload([file1])
      await firstSendInFlight
    })
    expect(mocks.inputbarCoreProps.text).toBe('yes')
    expect(CacheService.get<string>(draftKey)).toBe('yes')
    expect(CacheService.get<string>(draftKeyB)).toBe('draft on topic B')

    await act(async () => {
      root.unmount()
    })
  })
})
