import { IdleTimeoutController } from '@renderer/utils/IdleTimeoutController'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('IdleTimeoutController', () => {
  afterEach(() => vi.useRealTimers())

  it('aborts when no first token arrives before the watchdog deadline', () => {
    vi.useFakeTimers()
    const timeout = new IdleTimeoutController(60_000, 1_000)
    vi.advanceTimersByTime(999)
    expect(timeout.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(timeout.signal.aborted).toBe(true)
    expect((timeout.signal.reason as DOMException).name).toBe('TimeoutError')
  })

  it('stops the first-token watchdog after the first token', () => {
    vi.useFakeTimers()
    const timeout = new IdleTimeoutController(60_000, 1_000)
    timeout.markFirstToken()
    vi.advanceTimersByTime(1_001)
    expect(timeout.signal.aborted).toBe(false)
    timeout.cleanup()
  })
})
