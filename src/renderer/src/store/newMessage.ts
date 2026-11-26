import { loggerService } from '@logger'
import type { EntityState, PayloadAction } from '@reduxjs/toolkit'
import { createEntityAdapter, createSelector, createSlice } from '@reduxjs/toolkit'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

import type { RootState } from './index'

const logger = loggerService.withContext('newMessage')

// 1. Create the Adapter
const messagesAdapter = createEntityAdapter<Message>()

// 2. Define the State Interface
export interface MessagesState extends EntityState<Message, string> {
  messageIdsByTopic: Record<string, string[]> // Map: topicId -> ordered message IDs
  currentTopicId: string | null
  previewTopicId: string | null
  topicLruOrder: string[]
  loadingByTopic: Record<string, boolean>
  fulfilledByTopic: Record<string, boolean>
  displayCount: number
}

// 3. Define the Initial State
const initialState: MessagesState = messagesAdapter.getInitialState({
  messageIdsByTopic: {},
  currentTopicId: null,
  previewTopicId: null,
  topicLruOrder: [],
  loadingByTopic: {},
  fulfilledByTopic: {},
  displayCount: 10
})

function touchTopicLru(state: MessagesState, topicId: string | null | undefined): void {
  if (!topicId) return
  if (!Array.isArray(state.topicLruOrder)) {
    state.topicLruOrder = [topicId]
    return
  }
  const idx = state.topicLruOrder.indexOf(topicId)
  if (idx !== -1) {
    if (idx === state.topicLruOrder.length - 1) return
    state.topicLruOrder.splice(idx, 1)
  }
  state.topicLruOrder.push(topicId)
}

// Payload for receiving messages (used by loadTopicMessagesThunk)
interface MessagesReceivedPayload {
  topicId: string
  messages: Message[]
}

// Payload for setting topic loading state
interface SetTopicLoadingPayload {
  topicId: string
  loading: boolean
}

// Payload for setting topic loading state
interface SetTopicFulfilledPayload {
  topicId: string
  fulfilled: boolean
}

// Payload for upserting a block reference
interface UpsertBlockReferencePayload {
  messageId: string
  blockId: string
  status?: MessageBlockStatus
  blockType?: MessageBlockType
}

// Payload for removing a single message
interface RemoveMessagePayload {
  topicId: string
  messageId: string
}

// Payload for removing messages by askId
interface RemoveMessagesByAskIdPayload {
  topicId: string
  askId: string
}

// Payload for removing multiple messages by ID
interface RemoveMessagesPayload {
  topicId: string
  messageIds: string[]
}

// Payload for inserting a message at a specific index
interface InsertMessageAtIndexPayload {
  topicId: string
  message: Message
  index: number
}

const _messagesSlice = createSlice({
  name: 'newMessages',
  initialState,
  reducers: {
    setCurrentTopicId(state, action: PayloadAction<string | null>) {
      state.currentTopicId = action.payload
      if (action.payload) {
        if (!(action.payload in state.messageIdsByTopic)) {
          state.messageIdsByTopic[action.payload] = []
          state.loadingByTopic[action.payload] = false
        }
        touchTopicLru(state as MessagesState, action.payload)
      }
    },
    setPreviewTopicId(state, action: PayloadAction<string | null>) {
      state.previewTopicId = action.payload
      if (action.payload) {
        touchTopicLru(state as MessagesState, action.payload)
      }
    },
    setTopicLoading(state, action: PayloadAction<SetTopicLoadingPayload>) {
      const { topicId, loading } = action.payload
      state.loadingByTopic[topicId] = loading
    },
    setTopicFulfilled(state, action: PayloadAction<SetTopicFulfilledPayload>) {
      const { topicId, fulfilled } = action.payload
      state.fulfilledByTopic[topicId] = fulfilled
    },
    setDisplayCount(state, action: PayloadAction<number>) {
      state.displayCount = action.payload
    },
    messagesReceived(state, action: PayloadAction<MessagesReceivedPayload>) {
      const { topicId, messages } = action.payload
      messagesAdapter.upsertMany(state as MessagesState, messages)
      state.messageIdsByTopic[topicId] = messages.map((m) => m.id)
      touchTopicLru(state as MessagesState, topicId)
    },
    addMessage(state, action: PayloadAction<{ topicId: string; message: Message }>) {
      const { topicId, message } = action.payload
      messagesAdapter.addOne(state as MessagesState, message)
      if (!state.messageIdsByTopic[topicId]) {
        state.messageIdsByTopic[topicId] = []
      }
      state.messageIdsByTopic[topicId].push(message.id)
      touchTopicLru(state as MessagesState, topicId)
      if (!(topicId in state.loadingByTopic)) {
        state.loadingByTopic[topicId] = false
      }
      if (!(topicId in state.fulfilledByTopic)) {
        state.fulfilledByTopic[topicId] = false
      }
    },
    insertMessageAtIndex(state, action: PayloadAction<InsertMessageAtIndexPayload>) {
      const { topicId, message, index } = action.payload
      messagesAdapter.addOne(state as MessagesState, message)
      if (!state.messageIdsByTopic[topicId]) {
        state.messageIdsByTopic[topicId] = []
      }
      const safeIndex = Math.max(0, Math.min(index, state.messageIdsByTopic[topicId].length))
      state.messageIdsByTopic[topicId].splice(safeIndex, 0, message.id)
      touchTopicLru(state as MessagesState, topicId)

      if (!(topicId in state.loadingByTopic)) {
        state.loadingByTopic[topicId] = false
      }
      if (!(topicId in state.fulfilledByTopic)) {
        state.fulfilledByTopic[topicId] = false
      }
    },
    updateMessage(
      state,
      action: PayloadAction<{
        topicId: string
        messageId: string
        updates: Partial<Message> & { blockInstruction?: { id: string; position?: number } }
      }>
    ) {
      const { messageId, updates } = action.payload
      const { blockInstruction, ...otherUpdates } = updates

      if (blockInstruction) {
        const messageToUpdate = state.entities[messageId]
        if (messageToUpdate) {
          const { id: blockIdToAdd, position } = blockInstruction
          const currentBlocks = [...(messageToUpdate.blocks || [])]
          if (!currentBlocks.includes(blockIdToAdd)) {
            if (typeof position === 'number' && position >= 0 && position <= currentBlocks.length) {
              currentBlocks.splice(position, 0, blockIdToAdd)
            } else {
              currentBlocks.push(blockIdToAdd)
            }
            messagesAdapter.updateOne(state as MessagesState, {
              id: messageId,
              changes: { ...otherUpdates, blocks: currentBlocks }
            })
          } else if (Object.keys(otherUpdates).length > 0) {
            messagesAdapter.updateOne(state as MessagesState, { id: messageId, changes: otherUpdates })
          }
        } else {
          logger.warn(`[updateMessage] Message ${messageId} not found in entities.`)
        }
      } else {
        messagesAdapter.updateOne(state as MessagesState, { id: messageId, changes: otherUpdates })
      }
    },
    clearTopicMessages(state, action: PayloadAction<string>) {
      const topicId = action.payload
      const idsToRemove = state.messageIdsByTopic[topicId] || []
      if (idsToRemove.length > 0) {
        messagesAdapter.removeMany(state as MessagesState, idsToRemove)
      }
      delete state.messageIdsByTopic[topicId]
      delete state.loadingByTopic[topicId]
      delete state.fulfilledByTopic[topicId]
      if (Array.isArray(state.topicLruOrder)) {
        state.topicLruOrder = state.topicLruOrder.filter((id) => id !== topicId)
      }
    },
    removeMessage(state, action: PayloadAction<RemoveMessagePayload>) {
      const { topicId, messageId } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId]
      if (currentTopicIds) {
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => id !== messageId)
      }
      messagesAdapter.removeOne(state as MessagesState, messageId)
    },
    removeMessagesByAskId(state, action: PayloadAction<RemoveMessagesByAskIdPayload>) {
      const { topicId, askId } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId] || []
      const idsToRemove: string[] = []

      currentTopicIds.forEach((id) => {
        const message = state.entities[id]
        if (message && message.askId === askId) {
          idsToRemove.push(id)
        }
      })

      if (idsToRemove.length > 0) {
        messagesAdapter.removeMany(state as MessagesState, idsToRemove)
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => !idsToRemove.includes(id))
      }
    },
    removeMessages(state, action: PayloadAction<RemoveMessagesPayload>) {
      const { topicId, messageIds } = action.payload
      const currentTopicIds = state.messageIdsByTopic[topicId]
      const idsToRemoveSet = new Set(messageIds)
      if (currentTopicIds) {
        state.messageIdsByTopic[topicId] = currentTopicIds.filter((id) => !idsToRemoveSet.has(id))
      }
      messagesAdapter.removeMany(state as MessagesState, messageIds)
    },
    upsertBlockReference(state, action: PayloadAction<UpsertBlockReferencePayload>) {
      const { messageId, blockId, status, blockType } = action.payload

      const messageToUpdate = state.entities[messageId]
      if (!messageToUpdate) {
        logger.error(`[upsertBlockReference] Message ${messageId} not found.`)
        return
      }

      const changes: Partial<Message> = {}
      const currentBlocks = messageToUpdate.blocks || []
      if (!currentBlocks.includes(blockId)) {
        if (blockType === MessageBlockType.THINKING) {
          changes.blocks = [blockId, ...currentBlocks]
        } else {
          changes.blocks = [...currentBlocks, blockId]
        }
      }

      if (status) {
        if (
          (status === MessageBlockStatus.PROCESSING || status === MessageBlockStatus.STREAMING) &&
          messageToUpdate.status !== AssistantMessageStatus.PROCESSING &&
          messageToUpdate.status !== AssistantMessageStatus.SUCCESS &&
          messageToUpdate.status !== AssistantMessageStatus.ERROR
        ) {
          changes.status = AssistantMessageStatus.PROCESSING
        } else if (status === MessageBlockStatus.ERROR) {
          changes.status = AssistantMessageStatus.ERROR
        }
      }

      if (Object.keys(changes).length > 0) {
        messagesAdapter.updateOne(state as MessagesState, { id: messageId, changes })
      }
    }
  }
})

export const messagesSlice = {
  reducer: _messagesSlice.reducer,
  actions: _messagesSlice.actions
}

export const newMessagesActions = _messagesSlice.actions
export default _messagesSlice.reducer

export const selectMessagesState = (state: RootState) => state.messages

// Selectors generated by createEntityAdapter
export const {
  selectAll: selectAllMessages, // Selects all messages as an array
  selectById: selectMessageById, // Selects a single message by ID
  selectIds: selectAllMessageIds, // Selects all message IDs as an array
  selectEntities: selectMessageEntities // Selects the entity dictionary { id: message }
} = messagesAdapter.getSelectors(selectMessagesState)

const EMPTY_MESSAGES: Message[] = Object.freeze([]) as unknown as Message[]
const prevTopicMessagesCache = new Map<string, Message[]>()

// Custom Selector: Selects messages for a specific topic in order with stable per-topic array references
export const selectMessagesForTopic = createSelector(
  [
    selectMessageEntities,
    (state: RootState, topicId: string) => state.messages.messageIdsByTopic[topicId],
    (_state: RootState, topicId: string) => topicId
  ],
  (messageEntities, topicMessageIds, topicId) => {
    if (!topicMessageIds || topicMessageIds.length === 0) {
      prevTopicMessagesCache.delete(topicId)
      return EMPTY_MESSAGES
    }
    const next = topicMessageIds.map((id) => messageEntities[id]).filter((m): m is Message => !!m)
    if (next.length === 0) {
      prevTopicMessagesCache.delete(topicId)
      return EMPTY_MESSAGES
    }
    const prev = prevTopicMessagesCache.get(topicId)
    if (prev && prev.length === next.length && prev.every((msg, idx) => msg === next[idx])) {
      return prev
    }
    if (prevTopicMessagesCache.size > 32) {
      const oldest = prevTopicMessagesCache.keys().next().value
      if (oldest !== undefined) prevTopicMessagesCache.delete(oldest)
    }
    prevTopicMessagesCache.set(topicId, next)
    return next
  }
)
