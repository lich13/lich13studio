import { createBaseCallbacks } from '@renderer/services/messageStreaming/callbacks/baseCallbacks'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  autoRenameTopic: vi.fn()
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    MESSAGE_COMPLETE: 'message_complete'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('@renderer/services/NotificationService', () => ({
  NotificationService: {
    getInstance: () => ({
      send: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateMessagesUsage: vi.fn()
}))

vi.mock('@renderer/store/messageBlock', () => ({
  isTodoWriteBlock: () => false,
  updateOneBlock: (payload: unknown) => ({ type: 'messageBlock/updateOneBlock', payload })
}))

vi.mock('@renderer/store/newMessage', () => ({
  newMessagesActions: {
    updateMessage: (payload: unknown) => ({ type: 'messages/updateMessage', payload })
  },
  selectMessagesForTopic: vi.fn(() => [])
}))

vi.mock('@renderer/store/toolPermissions', () => ({
  toolPermissionsActions: {
    clearRequest: (payload: unknown) => ({ type: 'toolPermissions/clearRequest', payload })
  }
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  findAllBlocks: () => [],
  getMainTextContent: () => ''
}))

vi.mock('@renderer/utils/window', () => ({
  isFocused: () => true
}))

vi.mock('@renderer/utils/analytics', () => ({
  trackTokenUsage: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  uuid: () => 'notification-id'
}))

describe('base message streaming callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not overwrite a paused assistant message when completion arrives later', async () => {
    const dispatch = vi.fn()
    const saveUpdatesToDB = vi.fn()
    const getState = vi.fn(() => ({
      messages: {
        currentTopicId: 'topic-1',
        entities: {
          'assistant-1': {
            id: 'assistant-1',
            role: 'assistant',
            topicId: 'topic-1',
            assistantId: 'assistant-a',
            status: AssistantMessageStatus.PAUSED,
            blocks: []
          }
        }
      },
      messageBlocks: {
        entities: {}
      }
    }))

    const callbacks = createBaseCallbacks({
      blockManager: {
        activeBlockInfo: null,
        lastBlockType: null,
        smartBlockUpdate: vi.fn()
      },
      dispatch,
      getState,
      topicId: 'topic-1',
      assistantMsgId: 'assistant-1',
      saveUpdatesToDB,
      assistant: { id: 'assistant-a' } as any
    })

    await callbacks.onComplete(AssistantMessageStatus.SUCCESS, {
      metrics: undefined,
      usage: undefined
    } as any)

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'messages/updateMessage'
      })
    )
    expect(saveUpdatesToDB).not.toHaveBeenCalled()
  })
})
