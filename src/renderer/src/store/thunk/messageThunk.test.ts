import { dbService } from '@renderer/services/db'
import {
  applyFileCountDeltasInTx,
  collectBlockFileDecrements,
  purgeDetachedAttachments
} from '@renderer/services/db/DexieMessageDataSource'
import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import messageBlocksReducer, { upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import messagesReducer, { newMessagesActions } from '@renderer/store/newMessage'
import {
  buildPausedBlockChanges,
  cleanupMultipleBlocks,
  clearTopicMessagesThunk,
  collectTopicBlockIdsToEvict,
  deleteMessageGroupThunk,
  deleteSingleMessageThunk,
  evictInactiveTopicsFromRedux,
  loadTopicMessagesThunk,
  sendMessage,
  shouldMarkTopicFulfilled
} from '@renderer/store/thunk/messageThunk'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

describe('message thunk topic fulfilled state & streaming block flush invariants', () => {
  it('does not show an unread marker when the active topic finishes', () => {
    expect(shouldMarkTopicFulfilled('topic-1', 'topic-1')).toBe(false)
  })

  it('shows an unread marker when a background topic finishes', () => {
    expect(shouldMarkTopicFulfilled('topic-2', 'topic-1')).toBe(true)
  })

  it('shows an unread marker when no active topic is known', () => {
    expect(shouldMarkTopicFulfilled('topic-2', null)).toBe(true)
  })

  it('flushes deferred rAF Redux updates before block completion or block-type transition so fields and DB writes are never lost', () => {
    let messageBlocksState = messageBlocksReducer(
      undefined,
      upsertOneBlock({
        id: 'blk-think',
        messageId: 'msg-1',
        type: MessageBlockType.THINKING,
        content: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: MessageBlockStatus.STREAMING
      } as any)
    )
    messageBlocksState = messageBlocksReducer(
      messageBlocksState,
      upsertOneBlock({
        id: 'blk-text',
        messageId: 'msg-1',
        type: MessageBlockType.MAIN_TEXT,
        content: '',
        createdAt: '2026-01-01T00:00:01.000Z',
        status: MessageBlockStatus.STREAMING
      } as any)
    )

    const dispatch = vi.fn((action: any) => {
      if (typeof action?.type === 'string' && action.type.startsWith('messageBlocks/')) {
        messageBlocksState = messageBlocksReducer(messageBlocksState, action)
      }
      return action
    })
    const getState = () => ({ messageBlocks: messageBlocksState }) as any
    const savedSnapshots: Array<{ blockId: string | null; content: string; citations?: any }> = []
    const saveUpdatedBlockToDB = vi.fn(async (blockId: string | null, _m: string, _t: string, gs: () => any) => {
      const entity = blockId ? gs().messageBlocks.entities[blockId] : null
      savedSnapshots.push({
        blockId,
        content: entity?.content ?? '',
        citations: entity?.citationReferences
      })
    })

    // Simulate messageThunk's deferred rAF queue + synchronous flush inside cancelThrottledBlockUpdate
    const pendingRedux = new Map<string, Record<string, any>>()
    const throttledBlockUpdate = (id: string, changes: Record<string, any>) => {
      const prev = pendingRedux.get(id)
      pendingRedux.set(id, prev ? { ...prev, ...changes } : { ...changes })
    }
    const cancelThrottledBlockUpdate = (id: string) => {
      const pending = pendingRedux.get(id)
      if (pending) {
        pendingRedux.delete(id)
        dispatch({ type: 'messageBlocks/updateOneBlock', payload: { id, changes: pending } })
      }
    }

    const manager = new BlockManager({
      dispatch: dispatch as any,
      getState,
      saveUpdatedBlockToDB,
      saveUpdatesToDB: vi.fn(async () => {}),
      assistantMsgId: 'msg-1',
      topicId: 'topic-1',
      throttledBlockUpdate,
      cancelThrottledBlockUpdate
    })

    // 1. Stream thinking chunks (queued in pendingRedux, rAF has NOT fired yet)
    manager.smartBlockUpdate('blk-think', { content: 'step 1 reasoning' }, MessageBlockType.THINKING, false)
    expect(messageBlocksState.entities['blk-think']?.content).toBe('')

    // 2. Switch to MAIN_TEXT block without prior onThinkingComplete -> previous block must be flushed AND saved to DB!
    manager.smartBlockUpdate(
      'blk-text',
      { content: 'hello ', citationReferences: [{ citationBlockId: 'cit-1' }] } as any,
      MessageBlockType.MAIN_TEXT,
      false
    )
    expect(messageBlocksState.entities['blk-think']?.content).toBe('step 1 reasoning')
    expect(savedSnapshots[0]).toMatchObject({ blockId: 'blk-think', content: 'step 1 reasoning' })

    // 3. Stream another MAIN_TEXT chunk with citationReferences, then complete in the same frame before rAF
    manager.smartBlockUpdate(
      'blk-text',
      { content: 'hello world', citationReferences: [{ citationBlockId: 'cit-1' }] } as any,
      MessageBlockType.MAIN_TEXT,
      false
    )
    manager.smartBlockUpdate(
      'blk-text',
      { content: 'hello world!', status: MessageBlockStatus.SUCCESS },
      MessageBlockType.MAIN_TEXT,
      true
    )

    expect(messageBlocksState.entities['blk-text']).toMatchObject({
      content: 'hello world!',
      status: MessageBlockStatus.SUCCESS,
      citationReferences: [{ citationBlockId: 'cit-1' }]
    })
    expect(savedSnapshots.at(-1)).toMatchObject({
      blockId: 'blk-text',
      content: 'hello world!',
      citations: [{ citationBlockId: 'cit-1' }]
    })
  })

  it('isolates currentTopicId during background/preview loads unless activate: true is specified', async () => {
    const fetchSpy = vi.spyOn(dbService, 'fetchMessages').mockResolvedValue({
      messages: [
        {
          id: 'msg-preview',
          role: 'assistant',
          assistantId: 'ast-1',
          topicId: 'topic-preview',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: AssistantMessageStatus.SUCCESS,
          blocks: ['blk-preview']
        } as any
      ],
      blocks: [
        {
          id: 'blk-preview',
          messageId: 'msg-preview',
          type: MessageBlockType.MAIN_TEXT,
          content: 'preview text',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: MessageBlockStatus.SUCCESS
        } as any
      ]
    })

    let messagesState = messagesReducer(undefined, newMessagesActions.setCurrentTopicId('topic-active'))
    let messageBlocksState = messageBlocksReducer(undefined, { type: '@@INIT' })
    const getState = () => ({ messages: messagesState, messageBlocks: messageBlocksState }) as any
    const dispatch = vi.fn((action: any) => {
      if (typeof action === 'function') {
        return action(dispatch, getState)
      }
      if (typeof action?.type === 'string') {
        if (action.type.startsWith('newMessages/')) {
          messagesState = messagesReducer(messagesState, action)
        } else if (action.type.startsWith('messageBlocks/')) {
          messageBlocksState = messageBlocksReducer(messageBlocksState, action)
        }
      }
      return action
    })

    await loadTopicMessagesThunk('topic-preview', true)(dispatch as any, getState)
    expect(messagesState.currentTopicId).toBe('topic-active')
    expect(messagesState.messageIdsByTopic['topic-preview']).toEqual(['msg-preview'])

    await loadTopicMessagesThunk('topic-preview', false, { activate: true })(dispatch as any, getState)
    expect(messagesState.currentTopicId).toBe('topic-preview')

    fetchSpy.mockRestore()
  })

  it('evicts oldest inactive topics and their blocks while protecting current, preview, and streaming topics', () => {
    let messagesState = messagesReducer(undefined, newMessagesActions.setCurrentTopicId('topic-current'))
    messagesState = messagesReducer(messagesState, newMessagesActions.setPreviewTopicId('topic-preview'))
    let messageBlocksState = messageBlocksReducer(undefined, { type: '@@INIT' })

    const seedTopic = (topicId: string, status: AssistantMessageStatus = AssistantMessageStatus.SUCCESS) => {
      const msgId = `msg-${topicId}`
      const blkId = `blk-${topicId}`
      messageBlocksState = messageBlocksReducer(
        messageBlocksState,
        upsertManyBlocks([
          {
            id: blkId,
            messageId: msgId,
            type: MessageBlockType.MAIN_TEXT,
            content: topicId,
            createdAt: '2026-01-01T00:00:00.000Z',
            status: MessageBlockStatus.SUCCESS
          } as any
        ])
      )
      messagesState = messagesReducer(
        messagesState,
        newMessagesActions.messagesReceived({
          topicId,
          messages: [
            {
              id: msgId,
              role: 'assistant',
              assistantId: 'ast-1',
              topicId,
              createdAt: '2026-01-01T00:00:00.000Z',
              status,
              blocks: [blkId]
            } as any
          ]
        })
      )
    }

    seedTopic('topic-oldest-1')
    seedTopic('topic-streaming', AssistantMessageStatus.PROCESSING)
    seedTopic('topic-oldest-2')
    seedTopic('topic-current')
    seedTopic('topic-preview')
    seedTopic('topic-recent')

    const getState = () => ({ messages: messagesState, messageBlocks: messageBlocksState }) as any
    const dispatch = vi.fn((action: any) => {
      if (typeof action?.type === 'string') {
        if (action.type.startsWith('newMessages/')) {
          messagesState = messagesReducer(messagesState, action)
        } else if (action.type.startsWith('messageBlocks/')) {
          messageBlocksState = messageBlocksReducer(messageBlocksState, action)
        }
      }
      return action
    })

    const evicted = evictInactiveTopicsFromRedux(dispatch as any, getState, 4)
    expect(evicted).toEqual(['topic-oldest-1', 'topic-oldest-2'])
    expect(messagesState.messageIdsByTopic['topic-oldest-1']).toBeUndefined()
    expect(messageBlocksState.entities['blk-topic-oldest-1']).toBeUndefined()
    expect(messagesState.messageIdsByTopic['topic-streaming']).toEqual(['msg-topic-streaming'])
    expect(messagesState.messageIdsByTopic['topic-current']).toEqual(['msg-topic-current'])
    expect(messagesState.messageIdsByTopic['topic-preview']).toEqual(['msg-topic-preview'])
    expect(messagesState.messageIdsByTopic['topic-recent']).toEqual(['msg-topic-recent'])
  })

  it('aggregates duplicate file block decrements atomically before deleting detached files after tx commit', async () => {
    const blocks = [
      { id: 'b1', type: 'image', file: { id: 'f-dup' } },
      { id: 'b2', type: 'file', file: { id: 'f-dup' } },
      { id: 'b3', type: 'file', file: { id: 'f-keep' } }
    ] as any
    const deltas = collectBlockFileDecrements(blocks)
    expect(deltas.get('f-dup')).toEqual({ delta: -2, deleteIfZero: true })
    expect(deltas.get('f-keep')).toEqual({ delta: -1, deleteIfZero: true })

    const records = new Map<string, any>([
      ['f-dup', { id: 'f-dup', ext: '.png', count: 2 }],
      ['f-keep', { id: 'f-keep', ext: '.pdf', count: 3 }]
    ])
    const fakeFilesTable = {
      bulkGet: vi.fn(async (ids: string[]) => ids.map((id) => records.get(id))),
      update: vi.fn(async (id: string, changes: { count: number }) => {
        const rec = records.get(id)
        if (rec) rec.count = changes.count
        return 1
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        ids.forEach((id) => records.delete(id))
      })
    } as any

    const detached = await applyFileCountDeltasInTx(fakeFilesTable, deltas)
    expect(detached).toEqual(['f-dup.png'])
    expect(records.has('f-dup')).toBe(false)
    expect(records.get('f-keep')?.count).toBe(2)

    const deleteFileMock = vi.fn(async () => true)
    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = { api: { file: { delete: deleteFileMock } } }
    try {
      await purgeDetachedAttachments(detached)
      expect(deleteFileMock).toHaveBeenCalledTimes(1)
      expect(deleteFileMock).toHaveBeenCalledWith('f-dup.png')
    } finally {
      ;(globalThis as any).window = prevWindow
    }
  })

  it('self-heals legacy under-counted db.files.count instead of deleting attachments still referenced by surviving blocks', async () => {
    // Legacy <= v0.1.42 state: 3 blocks reference f-legacy, but db.files.count is only 1
    const allBlocks = new Map<string, any>([
      ['b-del', { id: 'b-del', type: 'file', file: { id: 'f-legacy' } }],
      ['b-survive-1', { id: 'b-survive-1', type: 'file', file: { id: 'f-legacy' } }],
      ['b-survive-2', { id: 'b-survive-2', type: 'image', file: { id: 'f-legacy' } }],
      ['b-survive-video', { id: 'b-survive-video', type: 'video', file: { id: 'f-legacy' } }]
    ])
    const records = new Map<string, any>([['f-legacy', { id: 'f-legacy', ext: '.pdf', count: 1 }]])
    const fakeFilesTable = {
      bulkGet: vi.fn(async (ids: string[]) => ids.map((id) => records.get(id))),
      update: vi.fn(async (id: string, changes: { count: number }) => {
        const rec = records.get(id)
        if (rec) rec.count = changes.count
        return 1
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        ids.forEach((id) => records.delete(id))
      })
    } as any
    const fakeMessageBlocksTable = {
      where: vi.fn((indexName: string) => {
        expect(indexName).toBe('file.id')
        return {
          anyOf: (targetFileIds: string[]) => ({
            toArray: async () => Array.from(allBlocks.values()).filter((blk) => targetFileIds.includes(blk.file?.id))
          })
        }
      })
    } as any

    // Step 1: Delete b-del -> nextCount hits 0, but 3 surviving blocks (including video) remain -> self-heal count to 3!
    const firstDeltas = collectBlockFileDecrements([allBlocks.get('b-del')])
    const detached1 = await applyFileCountDeltasInTx(fakeFilesTable, firstDeltas, {
      messageBlocksTable: fakeMessageBlocksTable,
      excludingBlockIds: ['b-del']
    })
    allBlocks.delete('b-del')

    expect(detached1).toEqual([])
    expect(fakeFilesTable.bulkDelete).not.toHaveBeenCalled()
    expect(records.get('f-legacy')?.count).toBe(3)

    // Step 2: Delete b-survive-1 and b-survive-2 while b-survive-video still exists -> self-heal to 1, still no deletion!
    records.get('f-legacy')!.count = 2
    const secondDeltas = collectBlockFileDecrements([allBlocks.get('b-survive-1'), allBlocks.get('b-survive-2')])
    const detachedMid = await applyFileCountDeltasInTx(fakeFilesTable, secondDeltas, {
      messageBlocksTable: fakeMessageBlocksTable,
      excludingBlockIds: ['b-survive-1', 'b-survive-2']
    })
    allBlocks.delete('b-survive-1')
    allBlocks.delete('b-survive-2')
    expect(detachedMid).toEqual([])
    expect(records.get('f-legacy')?.count).toBe(1)

    // Step 3: Once b-survive-video is also removed, decrementing to 0 deletes record & purges!
    allBlocks.clear()
    const detached2 = await applyFileCountDeltasInTx(
      fakeFilesTable,
      new Map([['f-legacy', { delta: -1, deleteIfZero: true }]]),
      {
        messageBlocksTable: fakeMessageBlocksTable
      }
    )

    expect(detached2).toEqual(['f-legacy.pdf'])
    expect(records.has('f-legacy')).toBe(false)
  })

  it('keeps cleanupMultipleBlocks pure to Redux without double-decrementing DB files, and evicts orphan blocks matching messageId', () => {
    const dispatched: any[] = []
    cleanupMultipleBlocks((action: any) => dispatched.push(action), ['b1', 'b2'])
    expect(dispatched).toEqual([{ type: 'messageBlocks/removeManyBlocks', payload: ['b1', 'b2'] }])

    const state = {
      messages: {
        entities: {
          'msg-1': { id: 'msg-1', blocks: ['blk-listed'] }
        }
      },
      messageBlocks: {
        entities: {
          'blk-listed': { id: 'blk-listed', messageId: 'msg-1' },
          'blk-orphan': { id: 'blk-orphan', messageId: 'msg-1' },
          'blk-other': { id: 'blk-other', messageId: 'msg-2' }
        }
      }
    } as any
    expect(collectTopicBlockIdsToEvict(state, ['msg-1']).sort()).toEqual(['blk-listed', 'blk-orphan'])
  })

  it('propagates user-message appendMessage errors in sendMessage before adding to Redux or starting assistant generation', async () => {
    const appendSpy = vi.spyOn(dbService, 'appendMessage').mockRejectedValueOnce(new Error('QuotaExceededError'))

    let messagesState = messagesReducer(undefined, { type: '@@INIT' })
    let messageBlocksState = messageBlocksReducer(undefined, { type: '@@INIT' })
    const getState = () => ({ messages: messagesState, messageBlocks: messageBlocksState }) as any
    const dispatch = vi.fn((action: any) => {
      if (typeof action === 'function') return action(dispatch, getState)
      if (typeof action?.type === 'string') {
        if (action.type.startsWith('newMessages/')) messagesState = messagesReducer(messagesState, action)
        if (action.type.startsWith('messageBlocks/'))
          messageBlocksState = messageBlocksReducer(messageBlocksState, action)
      }
      return action
    })

    const userMsg = {
      id: 'user-msg-fail',
      role: 'user',
      assistantId: 'ast-1',
      topicId: 'topic-send',
      createdAt: '2026-01-01T00:00:00.000Z',
      blocks: ['blk-user-1']
    } as any
    const userBlocks = [
      {
        id: 'blk-user-1',
        messageId: 'user-msg-fail',
        type: MessageBlockType.MAIN_TEXT,
        content: 'important draft',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as any
    ]

    await expect(
      sendMessage(userMsg, userBlocks, { id: 'ast-1', topics: [] } as any, 'topic-send')(dispatch as any, getState)
    ).rejects.toThrow('QuotaExceededError')

    expect(appendSpy).toHaveBeenCalledTimes(1)
    expect(messagesState.entities['user-msg-fail']).toBeUndefined()
    expect(messageBlocksState.entities['blk-user-1']).toBeUndefined()
    appendSpy.mockRestore()
  })

  it('keeps blocks and messages in Redux when Dexie delete/clear fails, and removes both once Dexie succeeds', async () => {
    let messagesState = messagesReducer(
      undefined,
      newMessagesActions.messagesReceived({
        topicId: 'topic-del',
        messages: [
          {
            id: 'u1',
            askId: 'u1',
            role: 'user',
            assistantId: 'ast-1',
            topicId: 'topic-del',
            createdAt: '2026-01-01T00:00:00.000Z',
            blocks: ['b-u1']
          } as any,
          {
            id: 'a1',
            askId: 'u1',
            role: 'assistant',
            assistantId: 'ast-1',
            topicId: 'topic-del',
            createdAt: '2026-01-01T00:00:01.000Z',
            status: AssistantMessageStatus.SUCCESS,
            blocks: ['b-a1']
          } as any
        ]
      })
    )
    let messageBlocksState = messageBlocksReducer(
      undefined,
      upsertManyBlocks([
        {
          id: 'b-u1',
          messageId: 'u1',
          type: MessageBlockType.MAIN_TEXT,
          content: 'question',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: MessageBlockStatus.SUCCESS
        } as any,
        {
          id: 'b-a1',
          messageId: 'a1',
          type: MessageBlockType.MAIN_TEXT,
          content: 'answer',
          createdAt: '2026-01-01T00:00:01.000Z',
          status: MessageBlockStatus.SUCCESS
        } as any
      ])
    )
    const getState = () => ({ messages: messagesState, messageBlocks: messageBlocksState }) as any
    const dispatch = vi.fn((action: any) => {
      if (typeof action === 'function') return action(dispatch, getState)
      if (typeof action?.type === 'string') {
        if (action.type.startsWith('newMessages/')) messagesState = messagesReducer(messagesState, action)
        if (action.type.startsWith('messageBlocks/'))
          messageBlocksState = messageBlocksReducer(messageBlocksState, action)
      }
      return action
    })

    const delSingleSpy = vi.spyOn(dbService, 'deleteMessage').mockRejectedValueOnce(new Error('DexieReadOnlyError'))
    const delGroupSpy = vi.spyOn(dbService, 'deleteMessages').mockRejectedValueOnce(new Error('DexieTxAborted'))
    const clearSpy = vi.spyOn(dbService, 'clearMessages').mockRejectedValueOnce(new Error('DexieClearFailed'))

    await deleteSingleMessageThunk('topic-del', 'a1')(dispatch as any, getState)
    expect(messageBlocksState.entities['b-a1']).toBeDefined()
    expect(messagesState.entities.a1).toBeDefined()

    await deleteMessageGroupThunk('topic-del', 'u1')(dispatch as any, getState)
    expect(messageBlocksState.entities['b-u1']).toBeDefined()
    expect(messageBlocksState.entities['b-a1']).toBeDefined()
    expect(messagesState.messageIdsByTopic['topic-del']).toEqual(['u1', 'a1'])

    await clearTopicMessagesThunk('topic-del')(dispatch as any, getState)
    expect(messageBlocksState.entities['b-u1']).toBeDefined()
    expect(messageBlocksState.entities['b-a1']).toBeDefined()
    expect(messagesState.messageIdsByTopic['topic-del']).toEqual(['u1', 'a1'])

    // Now succeed on deleteSingleMessageThunk (even if stream abort upserted an error block while Dexie awaited)
    delSingleSpy.mockImplementationOnce(async () => {
      dispatch(
        upsertOneBlock({
          id: 'b-a1-abort-err',
          messageId: 'a1',
          type: MessageBlockType.ERROR,
          content: 'aborted',
          createdAt: '2026-01-01T00:00:02.000Z',
          status: MessageBlockStatus.SUCCESS
        } as any)
      )
    })
    await deleteSingleMessageThunk('topic-del', 'a1')(dispatch as any, getState)
    expect(messageBlocksState.entities['b-a1']).toBeUndefined()
    expect(messageBlocksState.entities['b-a1-abort-err']).toBeUndefined()
    expect(messagesState.entities.a1).toBeUndefined()
    expect(messageBlocksState.entities['b-u1']).toBeDefined()

    clearSpy.mockResolvedValueOnce(undefined)
    await clearTopicMessagesThunk('topic-del')(dispatch as any, getState)
    expect(messageBlocksState.entities['b-u1']).toBeUndefined()
    expect(messagesState.messageIdsByTopic['topic-del']).toBeUndefined()

    delSingleSpy.mockRestore()
    delGroupSpy.mockRestore()
    clearSpy.mockRestore()
  })

  it('marks non-terminal ToolMessageBlock rawMcpToolResponse.status as cancelled when pausing or recovering stale streams', async () => {
    const invokingToolBlock = {
      id: 'blk-tool-invoking',
      messageId: 'msg-stale',
      type: MessageBlockType.TOOL,
      toolId: 'call-1',
      status: MessageBlockStatus.PENDING,
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: {
        rawMcpToolResponse: {
          id: 'call-1',
          toolUseId: 'call-1',
          tool: { id: 'search', name: 'search', type: 'builtin' },
          arguments: { q: 'test' },
          status: 'invoking'
        }
      }
    } as any
    const doneToolBlock = {
      ...invokingToolBlock,
      id: 'blk-tool-done',
      status: MessageBlockStatus.SUCCESS,
      metadata: {
        rawMcpToolResponse: {
          ...invokingToolBlock.metadata.rawMcpToolResponse,
          id: 'call-2',
          status: 'done'
        }
      }
    }

    expect(buildPausedBlockChanges(invokingToolBlock)).toEqual({
      status: MessageBlockStatus.PAUSED,
      metadata: {
        rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' })
      }
    })
    // Also cancels tool blocks whose rawMcpToolResponse.status is still undefined
    expect(
      buildPausedBlockChanges({
        ...invokingToolBlock,
        status: MessageBlockStatus.SUCCESS,
        metadata: {
          rawMcpToolResponse: {
            ...invokingToolBlock.metadata.rawMcpToolResponse,
            status: undefined
          }
        }
      })
    ).toEqual({
      status: MessageBlockStatus.SUCCESS,
      metadata: {
        rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' })
      }
    })
    expect(buildPausedBlockChanges(doneToolBlock)).toBeNull()

    const fetchSpy = vi.spyOn(dbService, 'fetchMessages').mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-stale',
          role: 'assistant',
          assistantId: 'ast-1',
          topicId: 'topic-stale',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: AssistantMessageStatus.PROCESSING,
          blocks: ['blk-tool-invoking', 'blk-tool-done']
        } as any
      ],
      blocks: [invokingToolBlock, doneToolBlock]
    })
    const updateBlocksSpy = vi.spyOn(dbService, 'updateBlocks').mockResolvedValueOnce(undefined)
    const updateMsgSpy = vi.spyOn(dbService, 'updateMessage').mockResolvedValueOnce(undefined)

    let messagesState = messagesReducer(undefined, { type: '@@INIT' })
    let messageBlocksState = messageBlocksReducer(undefined, { type: '@@INIT' })
    const getState = () => ({ messages: messagesState, messageBlocks: messageBlocksState }) as any
    const dispatch = vi.fn((action: any) => {
      if (typeof action === 'function') return action(dispatch, getState)
      if (typeof action?.type === 'string') {
        if (action.type.startsWith('newMessages/')) messagesState = messagesReducer(messagesState, action)
        if (action.type.startsWith('messageBlocks/'))
          messageBlocksState = messageBlocksReducer(messageBlocksState, action)
      }
      return action
    })

    await loadTopicMessagesThunk('topic-stale', true)(dispatch as any, getState)
    expect(messageBlocksState.entities['blk-tool-invoking']).toMatchObject({
      status: MessageBlockStatus.PAUSED,
      metadata: { rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' }) }
    })
    expect(updateBlocksSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'blk-tool-invoking',
        status: MessageBlockStatus.PAUSED,
        metadata: { rawMcpToolResponse: expect.objectContaining({ status: 'cancelled' }) }
      })
    ])

    fetchSpy.mockRestore()
    updateBlocksSpy.mockRestore()
    updateMsgSpy.mockRestore()
  })
})
