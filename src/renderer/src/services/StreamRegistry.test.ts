import { createStreamProcessor } from '@renderer/services/StreamProcessingService'
import {
  abortTopicStream,
  beginStream,
  clearStreamRegistry,
  createStreamTerminalGuard,
  finishStream,
  getActiveStream,
  isStreamAcceptingChunks,
  markStreamContent,
  setStreamAbort,
  setStreamPhase
} from '@renderer/services/StreamRegistry'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('StreamRegistry', () => {
  beforeEach(() => clearStreamRegistry())

  it('allows one active stream per topic and ignores stale generations', () => {
    const first = beginStream('topic-1', 'assistant-1')
    expect(first).toBeDefined()
    expect(beginStream('topic-1', 'assistant-2')).toBeUndefined()

    expect(first).toBeDefined()
    if (!first) return
    markStreamContent(first)
    expect(getActiveStream('topic-1')?.hasContent).toBe(true)
    finishStream(first, 'completed')
    expect(getActiveStream('topic-1')).toBeUndefined()
  })

  it('aborts and removes the active stream when a topic queue is cleared', () => {
    const abort = vi.fn()
    const entry = beginStream('topic-2', 'assistant-2')!
    expect(isStreamAcceptingChunks(entry)).toBe(true)
    setStreamPhase(entry, 'connecting')
    expect(isStreamAcceptingChunks(entry)).toBe(true)
    setStreamAbort(entry, abort)
    abortTopicStream('topic-2')
    expect(abort).toHaveBeenCalledOnce()
    expect(entry.phase).toBe('aborted')
    expect(getActiveStream('topic-2')).toBeUndefined()
    expect(isStreamAcceptingChunks(entry)).toBe(false)
    expect(beginStream('topic-2', 'assistant-3')).toBeDefined()
  })

  it('deduplicates terminal callbacks', () => {
    const guard = createStreamTerminalGuard()
    expect(guard.acceptError()).toBe(true)
    expect(guard.acceptComplete()).toBe(false)
    expect(guard.acceptError()).toBe(false)
    expect(guard.isTerminal()).toBe(true)
  })

  it('delivers LLM_RESPONSE_COMPLETE immediately after BLOCK_COMPLETE while dropping late deltas and duplicate terminals', async () => {
    const events: string[] = []
    const processor = createStreamProcessor({
      onTextChunk: (text) => {
        events.push(`text:${text}`)
      },
      onComplete: (status) => {
        events.push(`complete:${status}`)
      },
      onLLMResponseComplete: () => {
        events.push('llm_complete')
      },
      onError: () => {
        events.push('error')
      }
    })

    await processor({ type: ChunkType.TEXT_DELTA, text: 'hello' } as any)
    await processor({ type: ChunkType.BLOCK_COMPLETE, response: { text: 'hello' } } as any)
    await processor({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text: 'hello' } } as any)
    await processor({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text: 'hello' } } as any)
    await processor({ type: ChunkType.TEXT_DELTA, text: 'late' } as any)
    await processor({ type: ChunkType.ERROR, error: new Error('late error') } as any)

    expect(events).toEqual(['text:hello', `complete:${AssistantMessageStatus.SUCCESS}`, 'llm_complete'])
  })
})
