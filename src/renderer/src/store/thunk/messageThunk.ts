import { loggerService } from '@logger'
import db from '@renderer/databases'
import { dbService } from '@renderer/services/db'
import {
  applyFileCountDeltasInTx,
  collectBlockFileDecrements,
  type FileCountDeltaSpec,
  purgeDetachedAttachments
} from '@renderer/services/db/DexieMessageDataSource'
import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { createCallbacks } from '@renderer/services/messageStreaming/callbacks'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import {
  abortTopicStream,
  beginStream,
  createStreamTerminalGuard,
  finishStream,
  getActiveStream,
  isStreamAcceptingChunks,
  markStreamContent,
  setStreamAbort,
  setStreamPhase
} from '@renderer/services/StreamRegistry'
import store from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import { type Assistant, type FileMetadata, type Model, type Topic } from '@renderer/types'
import type { FileMessageBlock, ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { abortCompletion, addAbortController, removeAbortController } from '@renderer/utils/abortController'
import {
  createAssistantMessage,
  createTranslationBlock,
  resetAssistantMessage
} from '@renderer/utils/messageUtils/create'
import { clearTopicQueue, getTopicQueue, hasTopicPendingRequests, waitForTopicQueue } from '@renderer/utils/queue'
import { defaultAppHeaders } from '@shared/utils'
import { t } from 'i18next'
import throttle from 'lodash/throttle'
import { LRUCache } from 'lru-cache'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, updateOneBlock, upsertManyBlocks, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

const logger = loggerService.withContext('MessageThunk')

export const shouldMarkTopicFulfilled = (topicId: string, currentTopicId: string | null | undefined): boolean => {
  return !currentTopicId || currentTopicId !== topicId
}

const finishTopicLoading = async (topicId: string) => {
  await waitForTopicQueue(topicId)
  const currentTopicId = store.getState().messages.currentTopicId
  store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  store.dispatch(
    newMessagesActions.setTopicFulfilled({
      topicId,
      fulfilled: shouldMarkTopicFulfilled(topicId, currentTopicId)
    })
  )
}

const repairTerminalThinkingBlocks = (messages: Message[], blocks: MessageBlock[]) => {
  const blockMap = new Map(blocks.map((block) => [block.id, block]))
  const repairedBlocks: MessageBlock[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }

    const repairedStatus =
      message.status === AssistantMessageStatus.SUCCESS
        ? MessageBlockStatus.SUCCESS
        : message.status === AssistantMessageStatus.ERROR
          ? MessageBlockStatus.ERROR
          : message.status === AssistantMessageStatus.PAUSED
            ? MessageBlockStatus.PAUSED
            : null

    if (!repairedStatus) {
      continue
    }

    for (const blockId of message.blocks || []) {
      const block = blockMap.get(blockId)
      if (
        !block ||
        block.type !== MessageBlockType.THINKING ||
        (block.status !== MessageBlockStatus.PROCESSING &&
          block.status !== MessageBlockStatus.STREAMING &&
          block.status !== MessageBlockStatus.PENDING)
      ) {
        continue
      }

      const repairedBlock = {
        ...block,
        status: repairedStatus
      }
      blockMap.set(blockId, repairedBlock)
      repairedBlocks.push(repairedBlock)
    }
  }

  return {
    blocks: blocks.map((block) => blockMap.get(block.id) || block),
    repairedBlocks
  }
}

export const isNonTerminalToolStatus = (status: string | undefined): boolean =>
  status !== 'done' && status !== 'error' && status !== 'cancelled'

export const buildPausedBlockChanges = (block: MessageBlock): Partial<MessageBlock> | null => {
  const isBlockActive =
    block.status === MessageBlockStatus.PROCESSING ||
    block.status === MessageBlockStatus.STREAMING ||
    block.status === MessageBlockStatus.PENDING

  if (block.type === MessageBlockType.TOOL) {
    const toolResponse = block.metadata?.rawMcpToolResponse
    const hasRunningTool = Boolean(toolResponse && isNonTerminalToolStatus(toolResponse.status))
    if (!isBlockActive && !hasRunningTool) {
      return null
    }
    return {
      status: isBlockActive ? MessageBlockStatus.PAUSED : block.status,
      ...(hasRunningTool && toolResponse
        ? {
            metadata: {
              ...block.metadata,
              rawMcpToolResponse: {
                ...toolResponse,
                status: 'cancelled'
              }
            }
          }
        : {})
    }
  }

  if (!isBlockActive) {
    return null
  }

  return {
    status: MessageBlockStatus.PAUSED
  }
}

const pauseStaleStreamingState = (topicId: string, messages: Message[], blocks: MessageBlock[]) => {
  if (hasTopicPendingRequests(topicId)) {
    return { messages, blocks, repairedMessages: [] as Message[], repairedBlocks: [] as MessageBlock[] }
  }

  const staleMessageMap = new Map<string, Message>()
  const repairedMessages: Message[] = []

  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      (message.status === AssistantMessageStatus.PROCESSING ||
        message.status === AssistantMessageStatus.PENDING ||
        message.status === AssistantMessageStatus.SEARCHING)
    ) {
      const repairedMessage = {
        ...message,
        status: AssistantMessageStatus.PAUSED
      }
      staleMessageMap.set(message.id, repairedMessage)
      repairedMessages.push(repairedMessage)
    }
  }

  if (repairedMessages.length === 0) {
    return { messages, blocks, repairedMessages, repairedBlocks: [] as MessageBlock[] }
  }

  const repairedBlocks: MessageBlock[] = []
  const normalizedBlocks = blocks.map((block) => {
    if (!staleMessageMap.has(block.messageId)) {
      return block
    }
    const changes = buildPausedBlockChanges(block)
    if (!changes) {
      return block
    }

    const repairedBlock = {
      ...block,
      ...changes
    } as MessageBlock

    repairedBlocks.push(repairedBlock)
    return repairedBlock
  })

  return {
    messages: messages.map((message) => staleMessageMap.get(message.id) || message),
    blocks: normalizedBlocks,
    repairedMessages,
    repairedBlocks
  }
}

const updateExistingMessageAndBlocksInDB = async (
  updatedMessage: Partial<Message> & Pick<Message, 'id' | 'topicId'>,
  updatedBlocks: MessageBlock[]
) => {
  try {
    // Always update blocks if provided
    if (updatedBlocks.length > 0) {
      await dbService.updateBlocks(updatedBlocks)
    }

    // Check if there are message properties to update beyond id and topicId
    const messageKeysToUpdate = Object.keys(updatedMessage).filter((key) => key !== 'id' && key !== 'topicId')

    if (messageKeysToUpdate.length > 0) {
      const messageUpdatesPayload = messageKeysToUpdate.reduce<Partial<Message>>((acc, key) => {
        ;(acc as any)[key] = (updatedMessage as any)[key]
        return acc
      }, {})

      await dbService.updateMessage(updatedMessage.topicId, updatedMessage.id, messageUpdatesPayload)

      store.dispatch(updateTopicUpdatedAt({ topicId: updatedMessage.topicId }))
    }
  } catch (error) {
    logger.error(`[updateExistingMsg] Failed to update message ${updatedMessage.id}:`, error as Error)
  }
}

const STREAM_DB_FLUSH_INTERVAL_MS = 1500
const HIDDEN_REDUX_COALESCE_MS = 50
const pendingBlockReduxChanges = new Map<string, Record<string, any>>()
const pendingBlockDbChanges = new Map<string, Record<string, any>>()

type ScheduledReduxFlush = {
  kind: 'raf' | 'timeout'
  handle: any
}

const clearScheduledHandle = (entry: ScheduledReduxFlush) => {
  if (entry.kind === 'raf' && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(entry.handle)
  } else {
    clearTimeout(entry.handle)
  }
}

/**
 * 消息块 Redux 合并调度器（前台按 rAF 合帧，后台/无 rAF 环境按短定时器合并，防止隐藏窗口挂死）。
 */
const blockUpdateSchedulers = new LRUCache<string, ScheduledReduxFlush>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true,
  dispose: (entry) => {
    clearScheduledHandle(entry)
  }
})

const cancelScheduledReduxFlush = (id: string) => {
  const entry = blockUpdateSchedulers.get(id)
  if (entry) {
    clearScheduledHandle(entry)
    blockUpdateSchedulers.delete(id)
  }
}

const flushSingleBlockRedux = (id: string) => {
  cancelScheduledReduxFlush(id)
  const changes = pendingBlockReduxChanges.get(id)
  if (!changes) return
  pendingBlockReduxChanges.delete(id)
  store.dispatch(updateOneBlock({ id, changes }))
}

/**
 * 消息块数据库节流器（1.5s 合并落盘，避免逐帧 IndexedDB 事务放大）。
 */
const blockUpdateThrottlers = new LRUCache<string, ReturnType<typeof throttle>>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true,
  dispose: (throttler, id) => {
    throttler.cancel()
    cancelScheduledReduxFlush(id)
    pendingBlockReduxChanges.delete(id)
    pendingBlockDbChanges.delete(id)
  }
})

const getBlockThrottler = (id: string) => {
  if (!blockUpdateThrottlers.has(id)) {
    const throttler = throttle(
      async () => {
        const changes = pendingBlockDbChanges.get(id)
        if (!changes) return
        pendingBlockDbChanges.delete(id)
        await dbService.updateSingleBlock(id, changes)
      },
      STREAM_DB_FLUSH_INTERVAL_MS,
      { leading: false, trailing: true }
    )

    blockUpdateThrottlers.set(id, throttler)
  }

  return blockUpdateThrottlers.get(id)!
}

export const flushPendingBlockUpdates = async () => {
  for (const id of Array.from(pendingBlockReduxChanges.keys())) {
    flushSingleBlockRedux(id)
  }

  const dbFlushes: Promise<void>[] = []
  for (const [id, changes] of Array.from(pendingBlockDbChanges.entries())) {
    pendingBlockDbChanges.delete(id)
    const throttler = blockUpdateThrottlers.get(id)
    if (throttler) {
      throttler.cancel()
      blockUpdateThrottlers.delete(id)
    }
    dbFlushes.push(dbService.updateSingleBlock(id, changes))
  }
  if (dbFlushes.length > 0) {
    await Promise.all(dbFlushes)
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void flushPendingBlockUpdates()
    } else {
      for (const id of Array.from(pendingBlockReduxChanges.keys())) {
        flushSingleBlockRedux(id)
      }
    }
  })
}

/**
 * 更新单个消息块：前台按 rAF 同帧合并 Redux 更新（后台按短定时器合并），Dexie 按 1.5s 节流写入。
 */
export const throttledBlockUpdate = (id: string, blockUpdate: any) => {
  const prevRedux = pendingBlockReduxChanges.get(id)
  pendingBlockReduxChanges.set(id, prevRedux ? { ...prevRedux, ...blockUpdate } : { ...blockUpdate })

  if (!blockUpdateSchedulers.has(id)) {
    const runFlush = () => {
      blockUpdateSchedulers.delete(id)
      const changes = pendingBlockReduxChanges.get(id)
      if (!changes) return
      pendingBlockReduxChanges.delete(id)
      store.dispatch(updateOneBlock({ id, changes }))
    }
    const useRaf = typeof requestAnimationFrame === 'function' && (typeof document === 'undefined' || !document.hidden)
    const entry: ScheduledReduxFlush = useRaf
      ? { kind: 'raf', handle: requestAnimationFrame(runFlush) }
      : { kind: 'timeout', handle: setTimeout(runFlush, HIDDEN_REDUX_COALESCE_MS) }
    blockUpdateSchedulers.set(id, entry)
  }

  const prevDb = pendingBlockDbChanges.get(id)
  pendingBlockDbChanges.set(id, prevDb ? { ...prevDb, ...blockUpdate } : { ...blockUpdate })
  const throttler = getBlockThrottler(id)
  void throttler()
}

/**
 * 同步冲刷挂起的 Redux 增量并取消单个块的 DB 节流定时器（供完成/暂停/切换块调用方立即接管持久化）。
 */
export const cancelThrottledBlockUpdate = (id: string) => {
  flushSingleBlockRedux(id)
  pendingBlockDbChanges.delete(id)

  const throttler = blockUpdateThrottlers.get(id)
  if (throttler) {
    throttler.cancel()
    blockUpdateThrottlers.delete(id)
  }
}

const discardThrottledBlockUpdate = (id: string) => {
  cancelScheduledReduxFlush(id)
  pendingBlockReduxChanges.delete(id)
  pendingBlockDbChanges.delete(id)

  const throttler = blockUpdateThrottlers.get(id)
  if (throttler) {
    throttler.cancel()
    blockUpdateThrottlers.delete(id)
  }
}

export const cancelMultipleBlockUpdates = (blockIds: string[]) => {
  blockIds.forEach((id) => {
    cancelThrottledBlockUpdate(id)
  })
}

/**
 * 批量清理多个消息块的节流队列与 Redux 实体（数据库与附件引用计数由调用方事务独占处理）。
 */
export const cleanupMultipleBlocks = (dispatch: AppDispatch, blockIds: string[]) => {
  blockIds.forEach((id) => {
    discardThrottledBlockUpdate(id)
  })

  if (blockIds.length > 0) {
    dispatch(removeManyBlocks(blockIds))
  }
}

// 新增: 通用的、非节流的函数，用于保存消息和块的更新到数据库
const saveUpdatesToDB = async (
  messageId: string,
  topicId: string,
  messageUpdates: Partial<Message>, // 需要更新的消息字段
  blocksToUpdate: MessageBlock[] // 需要更新/创建的块
) => {
  try {
    const messageDataToSave: Partial<Message> & Pick<Message, 'id' | 'topicId'> = {
      id: messageId,
      topicId,
      ...messageUpdates
    }
    await updateExistingMessageAndBlocksInDB(messageDataToSave, blocksToUpdate)
  } catch (error) {
    logger.error(`[DB Save Updates] Failed for message ${messageId}:`, error as Error)
  }
}

// 新增: 辅助函数，用于获取并保存单个更新后的 Block 到数据库
const saveUpdatedBlockToDB = async (
  blockId: string | null,
  messageId: string,
  topicId: string,
  getState: () => RootState
) => {
  if (!blockId) {
    logger.warn('[DB Save Single Block] Received null/undefined blockId. Skipping save.')
    return
  }
  const state = getState()
  const blockToSave = state.messageBlocks.entities[blockId]
  if (blockToSave) {
    await saveUpdatesToDB(messageId, topicId, {}, [blockToSave]) // Pass messageId, topicId, empty message updates, and the block
  } else {
    logger.warn(`[DB Save Single Block] Block ${blockId} not found in state. Cannot save.`)
  }
}

// --- Helper Function for Multi-Model Dispatch ---
// 多模型创建和发送请求的逻辑，用于用户消息多模型发送和重发
const dispatchMultiModelResponses = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  triggeringMessage: Message, // userMessage or messageToResend
  assistant: Assistant,
  mentionedModels: Model[]
) => {
  const assistantMessageStubs: Message[] = []
  const tasksToQueue: { assistantConfig: Assistant; messageStub: Message }[] = []

  for (const mentionedModel of mentionedModels) {
    const assistantForThisMention = { ...assistant, model: mentionedModel }
    const assistantMessage = createAssistantMessage(assistant.id, topicId, {
      askId: triggeringMessage.id,
      model: mentionedModel,
      modelId: mentionedModel.id,
      traceId: triggeringMessage.traceId
    })
    dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
    assistantMessageStubs.push(assistantMessage)
    tasksToQueue.push({
      assistantConfig: assistantForThisMention,
      messageStub: assistantMessage
    })
  }

  const topicFromDB = await db.topics.get(topicId)
  if (topicFromDB) {
    const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
    const currentEntities = getState().messages.entities
    const messagesToSaveInDB = currentTopicMessageIds.map((id) => currentEntities[id]).filter((m): m is Message => !!m)
    await db.topics.update(topicId, { messages: messagesToSaveInDB })
  } else {
    logger.error(`[dispatchMultiModelResponses] Topic ${topicId} not found in DB during multi-model save.`)
    throw new Error(`Topic ${topicId} not found in DB.`)
  }

  if (tasksToQueue.length > 0) {
    const queue = getTopicQueue(topicId)
    for (const task of tasksToQueue) {
      void queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, task.assistantConfig, task.messageStub)
      })
    }
  }
}

// --- End Helper Function ---
// 发送和处理助手响应的实现函数，话题提示词在此拼接
const fetchAndProcessAssistantResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  origAssistant: Assistant,
  assistantMessage: Message // Pass the prepared assistant message (new or reset)
) => {
  const topic = origAssistant.topics.find((t) => t.id === topicId)
  const assistant = topic?.prompt
    ? { ...origAssistant, prompt: `${origAssistant.prompt}\n${topic.prompt}` }
    : origAssistant
  const assistantMsgId = assistantMessage.id
  const streamEntry = beginStream(topicId, assistantMsgId)
  if (!streamEntry) return

  let callbacks: StreamProcessorCallbacks = {}
  const terminalGuard = createStreamTerminalGuard()
  let abortKey: string | undefined
  let abortFn: (() => void) | undefined
  try {
    setStreamPhase(streamEntry, 'connecting')
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

    // 创建 BlockManager 实例
    const blockManager = new BlockManager({
      dispatch,
      getState,
      saveUpdatedBlockToDB,
      saveUpdatesToDB,
      assistantMsgId,
      topicId,
      throttledBlockUpdate,
      cancelThrottledBlockUpdate
    })

    const allMessagesForTopic = selectMessagesForTopic(getState(), topicId)

    let messagesForContext: Message[] = []
    const userMessageId = assistantMessage.askId
    abortKey = userMessageId
    const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessageId)

    if (userMessageIndex === -1) {
      logger.error(
        `[fetchAndProcessAssistantResponseImpl] Triggering user message ${userMessageId} (askId of ${assistantMsgId}) not found. Falling back.`
      )
      const assistantMessageIndexFallback = allMessagesForTopic.findIndex((m) => m?.id === assistantMsgId)
      messagesForContext = (
        assistantMessageIndexFallback !== -1
          ? allMessagesForTopic.slice(0, assistantMessageIndexFallback)
          : allMessagesForTopic
      ).filter((m) => m && !m.status?.includes('ing'))
    } else {
      const contextSlice = allMessagesForTopic.slice(0, userMessageIndex + 1)
      messagesForContext = contextSlice.filter((m) => m && !m.status?.includes('ing'))
    }

    // Ensure at least the triggering user message is present to avoid empty payloads
    if ((!messagesForContext || messagesForContext.length === 0) && userMessageId) {
      const stateAfter = getState()
      const maybeUserMessage = stateAfter.messages.entities[userMessageId]
      if (maybeUserMessage) {
        messagesForContext = [maybeUserMessage]
      }
    }

    callbacks = createCallbacks({
      blockManager,
      dispatch,
      getState,
      topicId,
      assistantMsgId,
      saveUpdatesToDB,
      assistant
    })
    const guardedCallbacks: StreamProcessorCallbacks = {
      ...callbacks,
      onTextChunk: async (text, providerMetadata) => {
        if (!isStreamAcceptingChunks(streamEntry) || terminalGuard.isTerminal()) return
        markStreamContent(streamEntry)
        await callbacks.onTextChunk?.(text, providerMetadata)
      },
      onError: async (error) => {
        if (streamEntry.phase === 'aborted' || !getState().messages.entities[assistantMsgId]) return
        if (!terminalGuard.acceptError()) return
        await callbacks.onError?.(error)
      },
      onComplete: async (status, response) => {
        if (!isStreamAcceptingChunks(streamEntry) || !getState().messages.entities[assistantMsgId]) return
        if (!terminalGuard.acceptComplete()) return
        await callbacks.onComplete?.(status, response)
      }
    }
    const streamProcessorCallbacks = createStreamProcessor(guardedCallbacks, {
      shouldAcceptChunk: () => isStreamAcceptingChunks(streamEntry) && !terminalGuard.isTerminal()
    })

    const abortController = new AbortController()
    abortFn = () => abortController.abort()
    logger.silly('Add Abort Controller', { id: userMessageId })
    if (userMessageId) {
      addAbortController(userMessageId, abortFn)
    }
    setStreamAbort(streamEntry, abortFn)

    const { transformMessagesAndFetch } = await import('@renderer/services/ApiService')
    await transformMessagesAndFetch(
      {
        messages: messagesForContext,
        assistant,
        topicId,
        blockManager,
        assistantMsgId,
        callbacks,
        options: {
          signal: abortController.signal,
          headers: defaultAppHeaders()
        }
      },
      streamProcessorCallbacks
    )

    if (
      isStreamAcceptingChunks(streamEntry) &&
      !terminalGuard.isTerminal() &&
      Boolean(getState().messages.entities[assistantMsgId])
    ) {
      const error = new Error('Stream ended without a terminal event')
      terminalGuard.acceptError()
      await callbacks.onError?.(error)
    }
  } catch (error: any) {
    logger.error('Error in fetchAndProcessAssistantResponseImpl:', error)
    // 统一错误处理：确保 loading 状态被正确设置，避免队列任务卡住
    if (
      streamEntry.phase !== 'aborted' &&
      Boolean(getState().messages.entities[assistantMsgId]) &&
      terminalGuard.acceptError()
    ) {
      try {
        await callbacks.onError?.(error)
      } catch (callbackError) {
        logger.error('Error in onError callback:', callbackError as Error)
      }
    }
    // 确保无论如何都设置 loading 为 false（onError 回调中已设置，这里是保险）
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  } finally {
    await flushPendingBlockUpdates()
    if (abortKey && abortFn) removeAbortController(abortKey, abortFn)
    const assistantEntity = getState().messages.entities[assistantMsgId]
    const finalStatus = assistantEntity?.status
    if (assistantEntity && (streamEntry.phase === 'aborted' || finalStatus === AssistantMessageStatus.PAUSED)) {
      const blocksToPersistOnAbort: MessageBlock[] = []
      for (const blockId of assistantEntity.blocks || []) {
        cancelThrottledBlockUpdate(blockId)
        const block = getState().messageBlocks.entities[blockId]
        const changes = block ? buildPausedBlockChanges(block) : null
        if (block && changes) {
          dispatch(updateOneBlock({ id: blockId, changes }))
          const updated = getState().messageBlocks.entities[blockId]
          blocksToPersistOnAbort.push(updated ?? ({ ...block, ...changes } as MessageBlock))
        }
      }
      if (blocksToPersistOnAbort.length > 0) {
        await dbService.updateBlocks(blocksToPersistOnAbort).catch((persistError) => {
          logger.warn('[fetchAndProcessAssistantResponseImpl] Failed to persist paused tool blocks:', persistError)
        })
      }
    }
    const reason =
      finalStatus === AssistantMessageStatus.SUCCESS
        ? 'completed'
        : finalStatus === AssistantMessageStatus.PAUSED || streamEntry.phase === 'aborted'
          ? 'paused'
          : finalStatus === AssistantMessageStatus.ERROR
            ? 'error'
            : 'error'
    finishStream(streamEntry, reason)
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  }
}

/**
 * 发送消息并处理助手回复
 * @param userMessage 已创建的用户消息
 * @param userMessageBlocks 用户消息关联的消息块
 * @param assistant 助手对象
 * @param topicId 主题ID
 */
export const sendMessage =
  (userMessage: Message, userMessageBlocks: MessageBlock[], assistant: Assistant, topicId: Topic['id']) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    if (userMessage.blocks.length === 0) {
      const emptyError = new Error('sendMessage: No blocks in the provided message.')
      logger.warn(emptyError.message)
      throw emptyError
    }

    try {
      await dbService.appendMessage(topicId, userMessage, userMessageBlocks)
    } catch (error) {
      logger.error('Error persisting user message in sendMessage thunk:', error as Error)
      throw error
    }

    if (userMessageBlocks.length > 0) {
      dispatch(upsertManyBlocks(userMessageBlocks))
    }
    dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))

    try {
      const mentionedModels = userMessage.mentions

      if (mentionedModels && mentionedModels.length > 0) {
        await dispatchMultiModelResponses(dispatch, getState, topicId, userMessage, assistant, mentionedModels)
      } else {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model,
          traceId: userMessage.traceId
        })
        await dbService.appendMessage(topicId, assistantMessage, [])
        dispatch(
          newMessagesActions.addMessage({
            topicId,
            message: assistantMessage
          })
        )

        void getTopicQueue(topicId).add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)
        })
      }
    } catch (error) {
      logger.error('Error starting assistant response in sendMessage thunk:', error as Error)
      window.toast?.error(t('common.errors.create_message'))
    } finally {
      void finishTopicLoading(topicId)
    }
  }

/**
 * Thunk to delete a single message and its associated blocks.
 */
export const deleteSingleMessageThunk =
  (topicId: string, messageId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const messageToDelete = currentState.messages.entities[messageId]
    if (!messageToDelete || messageToDelete.topicId !== topicId) {
      logger.error(`[deleteSingleMessage] Message ${messageId} not found in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messageToDelete.blocks || []

    try {
      if (getActiveStream(topicId)?.assistantMsgId === messageId) {
        abortTopicStream(topicId)
      }
      if (messageToDelete.role === 'assistant' && messageToDelete.askId) {
        abortCompletion(messageToDelete.askId)
      }
      cancelMultipleBlockUpdates(blockIdsToDelete)
      await dbService.deleteMessage(topicId, messageId)
      const finalBlocksToDelete = Array.from(
        new Set([...blockIdsToDelete, ...collectTopicBlockIdsToEvict(getState(), [messageId])])
      )
      cleanupMultipleBlocks(dispatch, finalBlocksToDelete)
      dispatch(newMessagesActions.removeMessage({ topicId, messageId }))
    } catch (error) {
      logger.error(`[deleteSingleMessage] Failed to delete message ${messageId}:`, error as Error)
    }
  }

/**
 * Thunk to delete a group of messages (user query + assistant responses) based on askId.
 */
export const deleteMessageGroupThunk =
  (topicId: string, askId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const topicMessageIds = currentState.messages.messageIdsByTopic[topicId] || []
    const messagesToDelete: Message[] = []

    topicMessageIds.forEach((id) => {
      const msg = currentState.messages.entities[id]
      if (msg && msg.askId === askId) {
        messagesToDelete.push(msg)
      }
    })

    if (messagesToDelete.length === 0) {
      logger.warn(`[deleteMessageGroup] No messages found with askId ${askId} in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messagesToDelete.flatMap((m) => m.blocks || [])
    const messageIdsToDelete = messagesToDelete.map((m) => m.id)

    try {
      const activeStream = getActiveStream(topicId)
      if (activeStream && messageIdsToDelete.includes(activeStream.assistantMsgId)) {
        abortTopicStream(topicId)
      }
      abortCompletion(askId)
      cancelMultipleBlockUpdates(blockIdsToDelete)
      await dbService.deleteMessages(topicId, messageIdsToDelete)
      const finalBlocksToDelete = Array.from(
        new Set([...blockIdsToDelete, ...collectTopicBlockIdsToEvict(getState(), messageIdsToDelete)])
      )
      cleanupMultipleBlocks(dispatch, finalBlocksToDelete)
      dispatch(newMessagesActions.removeMessagesByAskId({ topicId, askId }))
    } catch (error) {
      logger.error(`[deleteMessageGroup] Failed to delete messages with askId ${askId}:`, error as Error)
    }
  }

/**
 * Thunk to clear all messages and associated blocks for a topic.
 */
export const clearTopicMessagesThunk =
  (topicId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      clearTopicQueue(topicId)
      if (getActiveStream(topicId)) {
        abortTopicStream(topicId)
      }
      const state = getState()
      const messageIdsToClear = state.messages.messageIdsByTopic[topicId] || []
      const blockIdsToDeleteSet = new Set<string>(collectTopicBlockIdsToEvict(state, messageIdsToClear))

      messageIdsToClear.forEach((messageId) => {
        const message = state.messages.entities[messageId]
        if (message?.role === 'assistant' && message.askId) {
          abortCompletion(message.askId)
        }
        message?.blocks?.forEach((blockId) => blockIdsToDeleteSet.add(blockId))
      })

      const blockIdsToDelete = Array.from(blockIdsToDeleteSet)

      cancelMultipleBlockUpdates(blockIdsToDelete)
      await dbService.clearMessages(topicId)
      const latestState = getState()
      const latestMsgIds = latestState.messages.messageIdsByTopic[topicId] || []
      const finalBlocksToDelete = Array.from(
        new Set([...blockIdsToDelete, ...collectTopicBlockIdsToEvict(latestState, latestMsgIds)])
      )
      cleanupMultipleBlocks(dispatch, finalBlocksToDelete)
      dispatch(newMessagesActions.clearTopicMessages(topicId))
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    } catch (error) {
      logger.error(`[clearTopicMessagesThunk] Failed to clear messages for topic ${topicId}:`, error as Error)
    }
  }

/**
 * Thunk to resend a user message by regenerating its associated assistant responses.
 * Finds all assistant messages responding to the given user message, resets them,
 * and queues them for regeneration without deleting other messages.
 */
export const resendMessageThunk =
  (topicId: Topic['id'], userMessageToResend: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      // Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // Filter to find the assistant messages to reset
      const assistantMessagesToReset = allMessagesForTopic.filter(
        (m) => m.askId === userMessageToResend.id && m.role === 'assistant'
      )

      // Clear cached search results for the user message being resent
      // This ensures that the regenerated responses will not use stale search results
      try {
        window.keyv.remove(`web-search-${userMessageToResend.id}`)
        window.keyv.remove(`knowledge-search-${userMessageToResend.id}`)
      } catch (error) {
        logger.warn(`Failed to clear keyv cache for message ${userMessageToResend.id}:`, error as Error)
      }

      const resetDataList: Message[] = []

      if (assistantMessagesToReset.length === 0 && !userMessageToResend?.mentions?.length) {
        // 没有相关的助手消息且没有提及模型时，使用助手模型创建一条消息

        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessageToResend.id,
          model: assistant.model
        })
        assistantMessage.traceId = userMessageToResend.traceId
        resetDataList.push(assistantMessage)

        resetDataList.forEach((message) => {
          dispatch(newMessagesActions.addMessage({ topicId, message }))
        })
      }

      // 处理存在相关的助手消息的情况
      const allBlockIdsToDelete: string[] = []
      const messagesToUpdateInRedux: {
        topicId: string
        messageId: string
        updates: Partial<Message>
      }[] = []

      // 先处理已有的重传
      for (const originalMsg of assistantMessagesToReset) {
        const modelToSet =
          assistantMessagesToReset.length === 1 && !userMessageToResend?.mentions?.length
            ? assistant.model
            : originalMsg.model
        const blockIdsToDelete = [...(originalMsg.blocks || [])]
        const resetMsg = resetAssistantMessage(originalMsg, {
          status: AssistantMessageStatus.PENDING,
          updatedAt: new Date().toISOString(),
          model: modelToSet
        })

        resetDataList.push(resetMsg)
        allBlockIdsToDelete.push(...blockIdsToDelete)
        messagesToUpdateInRedux.push({
          topicId,
          messageId: resetMsg.id,
          updates: resetMsg
        })
      }

      // 再处理新的重传（用户消息提及，但是现有助手消息中不存在提及的模型）
      const originModelSet = new Set(assistantMessagesToReset.map((m) => m.model).filter((m) => m !== undefined))
      const mentionedModelSet = new Set(userMessageToResend.mentions ?? [])
      const newModelSet = new Set([...mentionedModelSet].filter((m) => !originModelSet.has(m)))
      for (const model of newModelSet) {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessageToResend.id,
          model: model,
          modelId: model.id
        })
        resetDataList.push(assistantMessage)
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
      }

      messagesToUpdateInRedux.forEach((update) => dispatch(newMessagesActions.updateMessage(update)))
      cleanupMultipleBlocks(dispatch, allBlockIdsToDelete)

      try {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        let attachmentsToDelete: string[] = []
        await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
          if (allBlockIdsToDelete.length > 0) {
            const blocks = await db.message_blocks.where('id').anyOf(allBlockIdsToDelete).toArray()
            const deltas = collectBlockFileDecrements(blocks)
            attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
              messageBlocksTable: db.message_blocks,
              excludingBlockIds: allBlockIdsToDelete
            })
            await db.message_blocks.bulkDelete(allBlockIdsToDelete)
          }
          await db.topics.update(topicId, { messages: finalMessagesToSave })
        })
        await purgeDetachedAttachments(attachmentsToDelete)
      } catch (dbError) {
        logger.error('[resendMessageThunk] Error updating database:', dbError as Error)
      }

      if (resetDataList.length > 0) {
        const queue = getTopicQueue(topicId)
        for (const resetMsg of resetDataList) {
          const assistantConfigForThisRegen = {
            ...assistant,
            ...(resetMsg.model ? { model: resetMsg.model } : {})
          }
          void queue.add(async () => {
            await fetchAndProcessAssistantResponseImpl(
              dispatch,
              getState,
              topicId,
              assistantConfigForThisRegen,
              resetMsg
            )
          })
        }
      }
    } catch (error) {
      logger.error(`[resendMessageThunk] Error resending user message ${userMessageToResend.id}:`, error as Error)
    } finally {
      void finishTopicLoading(topicId)
    }
  }

/**
 * Thunk to resend a user message after its content has been edited.
 * Updates the user message's text block and then triggers the regeneration
 * of its associated assistant responses using resendMessageThunk.
 */
export const resendUserMessageWithEditThunk =
  (topicId: Topic['id'], originalMessage: Message, assistant: Assistant) => async (dispatch: AppDispatch) => {
    // Trigger the regeneration logic for associated assistant messages
    void dispatch(resendMessageThunk(topicId, originalMessage, assistant))
  }

/**
 * Thunk to regenerate a specific assistant response.
 */
export const regenerateAssistantResponseThunk =
  (topicId: Topic['id'], assistantMessageToRegenerate: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      const askId = assistantMessageToRegenerate.askId

      if (!askId) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${assistantMessageToRegenerate.id} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      if (!state.messages.entities[askId]) {
        logger.error(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Cannot create assistant response without corresponding user message.`
        )

        // Show error popup instead of creating error message block
        window.toast.error(t('error.missing_user_message'))

        return
      }

      // 2. Find the original user query (Restored Logic)
      const originalUserQuery = allMessagesForTopic.find((m) => m.id === assistantMessageToRegenerate.askId)
      if (!originalUserQuery) {
        logger.error(
          `[regenerateAssistantResponseThunk] Original user query (askId: ${assistantMessageToRegenerate.askId}) not found for assistant message ${assistantMessageToRegenerate.id}. Cannot regenerate.`
        )
        return
      }

      // 3. Verify the assistant message itself exists in entities
      const messageToResetEntity = state.messages.entities[assistantMessageToRegenerate.id]
      if (!messageToResetEntity) {
        // No need to check topicId again as selector implicitly handles it
        logger.error(
          `[regenerateAssistantResponseThunk] Assistant message ${assistantMessageToRegenerate.id} not found in entities despite being in the topic list. State might be inconsistent.`
        )
        return
      }

      // 4. Get Block IDs to delete
      const blockIdsToDelete = [...(messageToResetEntity.blocks || [])]

      // 5. Reset the message entity in Redux
      const resetAssistantMsg = resetAssistantMessage(
        messageToResetEntity,
        // Grouped message (mentioned model message) should not reset model and modelId, always use the original model
        assistantMessageToRegenerate.modelId
          ? {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString()
            }
          : {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString(),
              model: assistant.model
            }
      )

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: resetAssistantMsg.id,
          updates: resetAssistantMsg
        })
      )

      // 6. Remove old blocks from Redux
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)

      // 7. Update DB: Save the reset message state within the topic and delete old blocks
      // Fetch the current state *after* Redux updates to get the latest message list
      // Use the selector to get the final ordered list of messages for the topic
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
      let attachmentsToDelete: string[] = []

      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        // Use the result from the selector to update the DB
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        if (blockIdsToDelete.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIdsToDelete).toArray()
          const deltas = collectBlockFileDecrements(blocks)
          attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
            messageBlocksTable: db.message_blocks,
            excludingBlockIds: blockIdsToDelete
          })
          await db.message_blocks.bulkDelete(blockIdsToDelete)
        }
      })
      await purgeDetachedAttachments(attachmentsToDelete)

      // 8. Add fetch/process call to the queue
      const assistantConfigForRegen = {
        ...assistant,
        ...(resetAssistantMsg.model ? { model: resetAssistantMsg.model } : {})
      }
      void getTopicQueue(topicId).add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForRegen,
          resetAssistantMsg
        )
      })
    } catch (error) {
      logger.error(
        `[regenerateAssistantResponseThunk] Error regenerating response for assistant message ${assistantMessageToRegenerate.id}:`,
        error as Error
      )
      // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    } finally {
      void finishTopicLoading(topicId)
    }
  }

// --- Thunk to initiate translation and create the initial block ---
export const initiateTranslationThunk =
  (
    messageId: string,
    topicId: string,
    targetLanguage: string,
    sourceBlockId?: string, // Optional: If known
    sourceLanguage?: string // Optional: If known
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<string | undefined> => {
    // Return the new block ID
    try {
      const state = getState()
      const originalMessage = state.messages.entities[messageId]

      if (!originalMessage) {
        logger.error(`[initiateTranslationThunk] Original message ${messageId} not found.`)
        return undefined
      }

      // 1. Create the initial translation block (streaming state)
      const newBlock = createTranslationBlock(
        messageId,
        '', // Start with empty content
        targetLanguage,
        {
          status: MessageBlockStatus.STREAMING, // Set to STREAMING
          sourceBlockId,
          sourceLanguage
        }
      )

      // 2. Update Redux State
      const updatedBlockIds = [...(originalMessage.blocks || []), newBlock.id]
      dispatch(upsertOneBlock(newBlock)) // Add the new block
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId,
          updates: { blocks: updatedBlockIds } // Update message's block list
        })
      )

      // 3. Update Database
      // Get the final message list from Redux state *after* updates
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        await db.message_blocks.put(newBlock) // Save the initial block
        await db.topics.update(topicId, { messages: finalMessagesToSave }) // Save updated message list
      })
      return newBlock.id // Return the ID
    } catch (error) {
      logger.error(`[initiateTranslationThunk] Failed for message ${messageId}:`, error as Error)
      return undefined
      // Optional: Dispatch an error action or show notification
    }
  }

// --- Thunk to update the translation block with new content ---
export const updateTranslationBlockThunk =
  (blockId: string, accumulatedText: string, isComplete: boolean = false) =>
  async (dispatch: AppDispatch) => {
    // Logger.log(`[updateTranslationBlockThunk] 更新翻译块 ${blockId}, isComplete: ${isComplete}`)
    try {
      const status = isComplete ? MessageBlockStatus.SUCCESS : MessageBlockStatus.STREAMING
      const changes: Partial<MessageBlock> = {
        content: accumulatedText,
        status: status
      }

      if (isComplete) {
        cancelThrottledBlockUpdate(blockId)
        dispatch(updateOneBlock({ id: blockId, changes }))
        await dbService.updateSingleBlock(blockId, changes)
      } else {
        throttledBlockUpdate(blockId, changes)
      }
      // Logger.log(`[updateTranslationBlockThunk] Successfully updated translation block ${blockId}.`)
    } catch (error) {
      logger.error(`[updateTranslationBlockThunk] Failed to update translation block ${blockId}:`, error as Error)
    }
  }

/**
 * Thunk to append a new assistant response (using a potentially different model)
 * in reply to the same user query as an existing assistant message.
 */
export const appendAssistantResponseThunk =
  (
    topicId: Topic['id'],
    existingAssistantMessageId: string, // ID of the assistant message the user interacted with
    newModel: Model, // The new model selected by the user
    assistant: Assistant, // Base assistant configuration
    traceId?: string
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Find the existing assistant message to get the original askId
      const existingAssistantMsg = state.messages.entities[existingAssistantMessageId]
      if (!existingAssistantMsg) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} not found.`
        )
        return // Stop if the reference message doesn't exist
      }
      if (existingAssistantMsg.role !== 'assistant') {
        logger.error(
          `[appendAssistantResponseThunk] Message ${existingAssistantMessageId} is not an assistant message.`
        )
        return // Ensure it's an assistant message
      }
      const askId = existingAssistantMsg.askId
      if (!askId) {
        logger.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      // (Optional but recommended) Verify the original user query exists
      if (!state.messages.entities[askId]) {
        logger.error(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Cannot create assistant response without corresponding user message.`
        )

        // Show error popup instead of creating error message block
        window.toast.error(t('error.missing_user_message'))

        return
      }

      // 2. Create the new assistant message stub
      const newAssistantMessageStub = createAssistantMessage(assistant.id, topicId, {
        askId: askId, // Crucial: Use the original askId
        model: newModel,
        modelId: newModel.id,
        traceId: traceId
      })

      // 3. Update Redux Store
      const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
      const existingMessageIndex = currentTopicMessageIds.findIndex((id) => id === existingAssistantMessageId)
      const insertAtIndex = existingMessageIndex !== -1 ? existingMessageIndex + 1 : currentTopicMessageIds.length

      // 4. Update Database (Save the stub to the topic's message list)
      await dbService.appendMessage(topicId, newAssistantMessageStub, [], insertAtIndex)

      dispatch(
        newMessagesActions.insertMessageAtIndex({
          topicId,
          message: newAssistantMessageStub,
          index: insertAtIndex
        })
      )

      void dispatch(updateMessageAndBlocksThunk(topicId, { id: existingAssistantMessageId, foldSelected: false }, []))
      void dispatch(updateMessageAndBlocksThunk(topicId, { id: newAssistantMessageStub.id, foldSelected: true }, []))

      // 5. Prepare and queue the processing task
      const assistantConfigForThisCall = {
        ...assistant,
        model: newModel
      }
      void getTopicQueue(topicId).add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForThisCall,
          newAssistantMessageStub // Pass the newly created stub
        )
      })
    } catch (error) {
      logger.error(`[appendAssistantResponseThunk] Error appending assistant response:`, error as Error)
      // Optionally dispatch an error action or notification
      // Resetting loading state should be handled by the underlying fetchAndProcessAssistantResponseImpl
    } finally {
      void finishTopicLoading(topicId)
    }
  }

/**
 * Clones messages from a source topic up to a specified index into a *pre-existing* new topic.
 * Generates new unique IDs for all cloned messages and blocks.
 * Updates the DB and Redux message/block state for the new topic.
 * Assumes the newTopic object already exists in Redux topic state and DB.
 * @param sourceTopicId The ID of the topic to branch from.
 * @param branchPointIndex The index *after* which messages should NOT be copied (slice endpoint).
 * @param newTopic The newly created Topic object (created and added to Redux/DB by the caller).
 */
export const cloneMessagesToNewTopicThunk =
  (
    sourceTopicId: string,
    branchPointIndex: number,
    newTopic: Topic // Receive newTopic object
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<boolean> => {
    if (!newTopic || !newTopic.id) {
      logger.error(`[cloneMessagesToNewTopicThunk] Invalid newTopic provided.`)
      return false
    }
    try {
      const state = getState()
      const sourceMessages = selectMessagesForTopic(state, sourceTopicId)

      if (!sourceMessages || sourceMessages.length === 0) {
        logger.error(`[cloneMessagesToNewTopicThunk] Source topic ${sourceTopicId} not found or is empty.`)
        return false
      }

      // 1. Slice messages to clone
      const messagesToClone = sourceMessages.slice(0, branchPointIndex)
      if (messagesToClone.length === 0) {
        logger.warn(`[cloneMessagesToNewTopicThunk] No messages to branch (index ${branchPointIndex}).`)
        return true // Nothing to clone, operation considered successful but did nothing.
      }

      // 2. Prepare for cloning: Maps and Arrays
      const clonedMessages: Message[] = []
      const clonedBlocks: MessageBlock[] = []
      const filesToUpdateCount: FileMetadata[] = []
      const originalToNewMsgIdMap = new Map<string, string>() // Map original message ID -> new message ID

      // 3. First pass: Create ID mappings for all messages
      for (const oldMessage of messagesToClone) {
        const newMsgId = uuid()
        originalToNewMsgIdMap.set(oldMessage.id, newMsgId) // Store mapping for all cloned messages
      }

      // 4. Second pass: Clone Messages and Blocks with New IDs using complete mapping
      for (const oldMessage of messagesToClone) {
        const newMsgId = originalToNewMsgIdMap.get(oldMessage.id)!

        let newAskId: string | undefined = undefined // Initialize newAskId
        if (oldMessage.role === 'assistant' && oldMessage.askId) {
          // If it's an assistant message with an askId, find the NEW ID of the user message it references
          const mappedNewAskId = originalToNewMsgIdMap.get(oldMessage.askId)
          if (mappedNewAskId) {
            newAskId = mappedNewAskId // Use the new ID
          } else {
            // This happens if the user message corresponding to askId was *before* the branch point index
            // and thus wasn't included in messagesToClone or the map.
            // In this case, the link is broken in the new topic.
            logger.warn(
              `[cloneMessages] Could not find new ID mapping for original askId ${oldMessage.askId} (likely outside branch). Setting askId to undefined for new assistant message ${newMsgId}.`
            )
            // newAskId remains undefined
          }
        }

        // --- Clone Blocks ---
        const newBlockIds: string[] = []
        if (oldMessage.blocks && oldMessage.blocks.length > 0) {
          for (const oldBlockId of oldMessage.blocks) {
            const oldBlock = state.messageBlocks.entities[oldBlockId]
            if (oldBlock) {
              const newBlockId = uuid()
              const newBlock = {
                ...oldBlock,
                id: newBlockId,
                messageId: newMsgId // Link block to the NEW message ID
              }
              clonedBlocks.push(newBlock)
              newBlockIds.push(newBlockId)

              if (newBlock.type === MessageBlockType.FILE || newBlock.type === MessageBlockType.IMAGE) {
                const fileInfo = (newBlock as FileMessageBlock | ImageMessageBlock).file
                if (fileInfo) {
                  filesToUpdateCount.push(fileInfo)
                }
              }
            } else {
              logger.warn(
                `[cloneMessagesToNewTopicThunk] Block ${oldBlockId} not found in state for message ${oldMessage.id}. Skipping block clone.`
              )
            }
          }
        }

        // --- Create New Message Object ---
        const newMessage: Message = {
          ...oldMessage,
          id: newMsgId,
          topicId: newTopic.id, // Use the NEW topic ID provided
          blocks: newBlockIds // Use the NEW block IDs
        }
        if (newMessage.role === 'assistant') {
          newMessage.askId = newAskId // Use the mapped/updated askId
        }
        clonedMessages.push(newMessage)
      }

      // 5. Update Database (Atomic Transaction)
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        // Update the NEW topic with the cloned messages
        // Assumes topic entry was added by caller, so we UPDATE.
        await db.topics.put({ id: newTopic.id, messages: clonedMessages })

        // Add the NEW blocks
        if (clonedBlocks.length > 0) {
          await dbService.bulkAddBlocks(clonedBlocks)
        }
        // Update file counts per cloned block reference (preserving multi-block multiplicity)
        const fileIncrements = new Map<string, FileCountDeltaSpec>()
        for (const file of filesToUpdateCount) {
          if (!file.id) continue
          const prev = fileIncrements.get(file.id)
          fileIncrements.set(file.id, {
            delta: (prev?.delta ?? 0) + 1,
            deleteIfZero: false
          })
        }
        await applyFileCountDeltasInTx(db.files, fileIncrements)
      })

      // --- Update Redux State ---
      dispatch(
        newMessagesActions.messagesReceived({
          topicId: newTopic.id,
          messages: clonedMessages
        })
      )
      if (clonedBlocks.length > 0) {
        dispatch(upsertManyBlocks(clonedBlocks))
      }

      return true // Indicate success
    } catch (error) {
      logger.error(`[cloneMessagesToNewTopicThunk] Failed to clone messages:`, error as Error)
      return false // Indicate failure
    }
  }

/**
 * Thunk to edit properties of a message and/or its associated blocks.
 * Updates Redux state and persists changes to the database within a transaction.
 * Message updates are optional if only blocks need updating.
 */
export const updateMessageAndBlocksThunk =
  (
    topicId: string,
    // Allow messageUpdates to be optional or just contain the ID if only blocks are updated
    messageUpdates: (Partial<Message> & Pick<Message, 'id'>) | null, // ID is always required for context
    blockUpdatesList: MessageBlock[] // Block updates remain required for this thunk's purpose
  ) =>
  async (dispatch: AppDispatch): Promise<void> => {
    const messageId = messageUpdates?.id

    if (messageUpdates && !messageId) {
      logger.error('[updateMessageAndUpdateBlocksThunk] Message ID is required.')
      return
    }

    try {
      // 1. 更新 Redux Store
      if (messageUpdates && messageId) {
        // oxlint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: msgId, ...actualMessageChanges } = messageUpdates // Separate ID from actual changes

        // Only dispatch message update if there are actual changes beyond the ID
        if (Object.keys(actualMessageChanges).length > 0) {
          dispatch(
            newMessagesActions.updateMessage({
              topicId,
              messageId,
              updates: actualMessageChanges
            })
          )
        }
      }

      if (blockUpdatesList.length > 0) {
        dispatch(upsertManyBlocks(blockUpdatesList))
      }
      // Update message properties if provided
      if (messageUpdates && Object.keys(messageUpdates).length > 0 && messageId) {
        await dbService.updateMessage(topicId, messageId, messageUpdates)
      }
      // Update blocks if provided
      if (blockUpdatesList.length > 0) {
        await dbService.updateBlocks(blockUpdatesList)
      }

      dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`[updateMessageAndBlocksThunk] Failed to process updates for message ${messageId}:`, error as Error)
    }
  }

export const removeBlocksThunk =
  (topicId: string, messageId: string, blockIdsToRemove: string[]) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!blockIdsToRemove.length) {
      logger.warn('[removeBlocksThunk] No block IDs provided to remove.')
      return
    }

    try {
      const state = getState()
      const message = state.messages.entities[messageId]

      if (!message) {
        logger.error(`[removeBlocksThunk] Message ${messageId} not found in state.`)
        return
      }
      const blockIdsToRemoveSet = new Set(blockIdsToRemove)

      const updatedBlockIds = (message.blocks || []).filter((id) => !blockIdsToRemoveSet.has(id))

      cancelMultipleBlockUpdates(blockIdsToRemove)

      // 1. Update database first so Redux never drops blocks if Dexie fails
      const finalMessagesToSave = selectMessagesForTopic(state, topicId).map((m) =>
        m.id === messageId ? { ...m, blocks: updatedBlockIds } : m
      )
      let attachmentsToDelete: string[] = []
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        if (blockIdsToRemove.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIdsToRemove).toArray()
          const deltas = collectBlockFileDecrements(blocks)
          attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
            messageBlocksTable: db.message_blocks,
            excludingBlockIds: blockIdsToRemove
          })
          await db.message_blocks.bulkDelete(blockIdsToRemove)
        }
      })
      await purgeDetachedAttachments(attachmentsToDelete)

      // 2. Update Redux state after Dexie succeeds
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId,
          updates: { blocks: updatedBlockIds }
        })
      )
      cleanupMultipleBlocks(dispatch, blockIdsToRemove)

      dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`[removeBlocksThunk] Failed to remove blocks from message ${messageId}:`, error as Error)
      throw error
    }
  }

//以下内容从原 messageThunk.v2.ts 迁移过来，原文件已经删除
//原因：v2.ts并不是v2数据重构的一部分，而相关命名对v2重构造成重大误解，故两文件合并，以消除误解

export const MAX_CACHED_REDUX_TOPICS = 12

export function collectTopicBlockIdsToEvict(
  state: Pick<RootState, 'messages' | 'messageBlocks'>,
  messageIds: readonly string[]
): string[] {
  if (messageIds.length === 0) return []
  const messageIdSet = new Set(messageIds)
  const blockIds = new Set<string>()
  for (const msgId of messageIds) {
    const blocks = state.messages.entities[msgId]?.blocks
    if (blocks) {
      for (const blockId of blocks) blockIds.add(blockId)
    }
  }
  const blockEntities = state.messageBlocks.entities as Record<string, MessageBlock | undefined>
  for (const [blockId, block] of Object.entries(blockEntities)) {
    if (block && messageIdSet.has(block.messageId)) {
      blockIds.add(blockId)
    }
  }
  return Array.from(blockIds)
}

export function evictInactiveTopicsFromRedux(
  dispatch: AppDispatch,
  getState: () => RootState,
  maxCachedTopics: number = MAX_CACHED_REDUX_TOPICS,
  protectedTopicId?: string
): string[] {
  const state = getState()
  const cachedTopicIds = Object.keys(state.messages.messageIdsByTopic)
  if (cachedTopicIds.length <= maxCachedTopics) {
    return []
  }

  const lruOrder = state.messages.topicLruOrder?.length ? state.messages.topicLruOrder : cachedTopicIds
  const orderedCandidates = [
    ...cachedTopicIds.filter((id) => !lruOrder.includes(id)),
    ...lruOrder.filter((id) => id in state.messages.messageIdsByTopic)
  ]

  let remainingCount = cachedTopicIds.length
  const evicted: string[] = []

  for (const candidateTopicId of orderedCandidates) {
    if (remainingCount <= maxCachedTopics) {
      break
    }
    if (
      candidateTopicId === state.messages.currentTopicId ||
      candidateTopicId === state.messages.previewTopicId ||
      candidateTopicId === protectedTopicId ||
      state.messages.loadingByTopic[candidateTopicId] ||
      Boolean(getActiveStream(candidateTopicId))
    ) {
      continue
    }

    const messageIds = state.messages.messageIdsByTopic[candidateTopicId] || []
    const hasActiveMessage = messageIds.some((msgId) => {
      const status = state.messages.entities[msgId]?.status
      return (
        status === AssistantMessageStatus.PROCESSING ||
        status === AssistantMessageStatus.PENDING ||
        status === AssistantMessageStatus.SEARCHING
      )
    })
    if (hasActiveMessage) {
      continue
    }

    const blockIdsToRemove = collectTopicBlockIdsToEvict(state, messageIds)
    dispatch(newMessagesActions.clearTopicMessages(candidateTopicId))
    if (blockIdsToRemove.length > 0) {
      dispatch(removeManyBlocks(blockIdsToRemove))
    }
    evicted.push(candidateTopicId)
    remainingCount -= 1
  }

  return evicted
}

/**
 * Load messages for a topic using unified DbService
 */
export const loadTopicMessagesThunk =
  (topicId: string, forceReload: boolean = false, options?: { activate?: boolean }) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const alreadyLoaded = Boolean(
      state.messages.messageIdsByTopic[topicId] &&
        (state.messages.messageIdsByTopic[topicId].length > 0 || !options?.activate)
    )

    if (options?.activate) {
      dispatch(newMessagesActions.setCurrentTopicId(topicId))
    }

    // Skip if already cached and not forcing reload
    if (!forceReload && alreadyLoaded) {
      evictInactiveTopicsFromRedux(dispatch, getState, MAX_CACHED_REDUX_TOPICS, topicId)
      return
    }

    try {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

      // Unified call - no need to check isAgentSessionTopicId
      const { messages, blocks } = await dbService.fetchMessages(topicId)
      const {
        messages: pausedMessages,
        blocks: pausedBlocks,
        repairedMessages,
        repairedBlocks: pausedBlocksToPersist
      } = pauseStaleStreamingState(topicId, messages, blocks)
      const { blocks: normalizedBlocks, repairedBlocks: repairedThinkingBlocks } = repairTerminalThinkingBlocks(
        pausedMessages,
        pausedBlocks
      )
      const blocksToPersist = [...pausedBlocksToPersist, ...repairedThinkingBlocks]

      logger.silly('Loaded messages via DbService', {
        topicId,
        messageCount: pausedMessages.length,
        blockCount: normalizedBlocks.length,
        repairedThinkingBlockCount: repairedThinkingBlocks.length,
        repairedMessageCount: repairedMessages.length
      })

      if (repairedMessages.length > 0) {
        await Promise.all(
          repairedMessages.map((message) => dbService.updateMessage(topicId, message.id, { status: message.status }))
        )
      }

      if (blocksToPersist.length > 0) {
        await dbService.updateBlocks(blocksToPersist)
      }

      // Update Redux state with fetched data
      if (normalizedBlocks.length > 0) {
        dispatch(upsertManyBlocks(normalizedBlocks))
      }
      dispatch(newMessagesActions.messagesReceived({ topicId, messages: pausedMessages }))
    } catch (error) {
      logger.error(`Failed to load messages for topic ${topicId}:`, error as Error)
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
      evictInactiveTopicsFromRedux(dispatch, getState, MAX_CACHED_REDUX_TOPICS, topicId)
    }
  }
