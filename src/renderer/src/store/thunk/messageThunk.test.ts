import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import messageBlocksReducer, { upsertOneBlock } from '@renderer/store/messageBlock'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { getTopicFulfilledActiveTopicId, shouldMarkTopicFulfilled } from '@renderer/utils/topicStatus'
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

  it('uses the visible active topic over the internal loaded topic when deciding unread state', () => {
    expect(getTopicFulfilledActiveTopicId('visible-topic', 'loaded-background-topic')).toBe('visible-topic')
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
})
