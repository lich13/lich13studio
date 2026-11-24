// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSmoothStream } from './useSmoothStream'

describe('useSmoothStream', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not run an idle requestAnimationFrame loop and restarts cleanly when chunks arrive', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    let nextFrameId = 1
    const rafQueue = new Map<number, FrameRequestCallback>()

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrameId++
      rafQueue.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue.delete(id)
    })

    const runNextFrame = async (timestamp: number) => {
      const first = rafQueue.entries().next().value
      if (!first) {
        return false
      }
      const [id, cb] = first
      rafQueue.delete(id)
      await act(async () => {
        cb(timestamp)
      })
      return true
    }

    const updates: string[] = []
    let controls: ReturnType<typeof useSmoothStream> | null = null

    function Harness({ streamDone, minDelay = 10 }: { streamDone: boolean; minDelay?: number }) {
      controls = useSmoothStream({
        onUpdate: (text) => updates.push(text),
        streamDone,
        minDelay,
        initialText: ''
      })
      return null
    }

    const rootElement = document.createElement('div')
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(createElement(Harness, { streamDone: false, minDelay: 10 }))
    })

    // Zero idle RAF scheduled before any chunk arrives
    expect(rafQueue.size).toBe(0)

    await act(async () => {
      controls!.addChunk('Hello ')
    })
    expect(rafQueue.size).toBe(1)

    let now = 20
    while (rafQueue.size > 0) {
      await runNextFrame(now)
      now += 20
    }

    expect(updates.at(-1)).toBe('Hello ')
    // Once drained, RAF stops completely instead of spinning at 60Hz while waiting for network tokens
    expect(rafQueue.size).toBe(0)

    // Subsequent chunk wakes RAF back up
    await act(async () => {
      controls!.addChunk('世界!')
    })
    expect(rafQueue.size).toBe(1)

    // Transitioning streamDone -> true flushes remaining segments immediately and cancels pending RAF
    await act(async () => {
      root.render(createElement(Harness, { streamDone: true, minDelay: 10 }))
    })
    expect(rafQueue.size).toBe(0)
    expect(updates.at(-1)).toBe('Hello 世界!')

    // Reset clears state and cancels any pending animation frame
    await act(async () => {
      root.render(createElement(Harness, { streamDone: false, minDelay: 10 }))
    })
    await act(async () => {
      controls!.addChunk('discarded')
    })
    expect(rafQueue.size).toBe(1)

    await act(async () => {
      controls!.reset('fresh')
    })
    expect(rafQueue.size).toBe(0)
    expect(updates.at(-1)).toBe('fresh')

    await act(async () => {
      root.unmount()
    })
  })
})
