import {
  abortTopicStream,
  beginStream,
  clearStreamRegistry,
  createStreamTerminalGuard,
  finishStream,
  getActiveStream,
  markStreamContent,
  setStreamAbort
} from '@renderer/services/StreamRegistry'
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
    setStreamAbort(entry, abort)
    abortTopicStream('topic-2')
    expect(abort).toHaveBeenCalledOnce()
    expect(getActiveStream('topic-2')?.phase).toBe('aborted')
  })

  it('deduplicates terminal callbacks', () => {
    const guard = createStreamTerminalGuard()
    expect(guard.acceptError()).toBe(true)
    expect(guard.acceptComplete()).toBe(false)
    expect(guard.acceptError()).toBe(false)
    expect(guard.isTerminal()).toBe(true)
  })
})
