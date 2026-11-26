import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortTopicStream: vi.fn()
}))

vi.mock('@renderer/services/StreamRegistry', () => ({
  abortTopicStream: mocks.abortTopicStream
}))

import {
  clearAllQueues,
  clearTopicQueue,
  getTopicPendingRequestCount,
  getTopicQueue,
  hasTopicPendingRequests,
  waitForTopicQueue
} from './queue'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('topic request queue lifecycle & orphan prevention', () => {
  it('re-registers a queue reference if a previous request went idle during an async gap before .add()', async () => {
    const topicId = 'topic-idle-gap'
    const firstGate = createDeferred()
    const secondGate = createDeferred()

    const queueRef = getTopicQueue(topicId)
    const firstRun = queueRef.add(() => firstGate.promise)
    expect(hasTopicPendingRequests(topicId)).toBe(true)
    expect(getTopicPendingRequestCount(topicId)).toBe(1)

    // Simulate an async gap (e.g. awaiting DB write) during which the previous request finishes and emits 'idle'
    firstGate.resolve()
    await firstRun
    await waitForTopicQueue(topicId)
    expect(hasTopicPendingRequests(topicId)).toBe(false)

    // Adding onto the pre-captured queueRef must NOT become orphaned from topic tracking
    const secondRun = queueRef.add(() => secondGate.promise)
    expect(hasTopicPendingRequests(topicId)).toBe(true)
    expect(getTopicPendingRequestCount(topicId)).toBe(1)

    let waitSettled = false
    const waitPromise = waitForTopicQueue(topicId).then(() => {
      waitSettled = true
    })
    await Promise.resolve()
    expect(waitSettled).toBe(false)

    secondGate.resolve()
    await secondRun
    await waitPromise
    expect(waitSettled).toBe(true)
    expect(hasTopicPendingRequests(topicId)).toBe(false)
    expect(getTopicPendingRequestCount(topicId)).toBe(0)
  })

  it('forwards .add() and .addAll() from a superseded queue reference onto the active replacement queue in serial order', async () => {
    const topicId = 'topic-replaced-queue'
    const order: string[] = []
    const gateA = createDeferred()
    const gateB = createDeferred()

    const staleRef = getTopicQueue(topicId, { concurrency: 1 })
    const initialDone = staleRef.add(() => Promise.resolve())
    await initialDone
    await waitForTopicQueue(topicId)

    // Another caller creates a fresh active queue while staleRef is still held
    const activeQueue = getTopicQueue(topicId, { concurrency: 1 })
    expect(activeQueue).not.toBe(staleRef)

    const taskA = activeQueue.add(async () => {
      order.push('start-A')
      await gateA.promise
      order.push('end-A')
    })

    // Scheduling via staleRef must serialize behind taskA on activeQueue rather than running concurrently
    const taskB = staleRef.add(async () => {
      order.push('start-B')
      await gateB.promise
      order.push('end-B')
    })
    const taskC = staleRef.addAll([
      async () => {
        order.push('run-C')
      }
    ])

    await Promise.resolve()
    expect(order).toEqual(['start-A'])
    expect(getTopicPendingRequestCount(topicId)).toBe(3)

    gateA.resolve()
    await taskA
    await Promise.resolve()
    expect(order).toEqual(['start-A', 'end-A', 'start-B'])

    gateB.resolve()
    await Promise.all([taskB, taskC, waitForTopicQueue(topicId)])
    expect(order).toEqual(['start-A', 'end-A', 'start-B', 'end-B', 'run-C'])
    expect(hasTopicPendingRequests(topicId)).toBe(false)

    clearTopicQueue(topicId)
    clearAllQueues()
  })

  it('does not re-register or leak an evicted idle queue when .addAll([]) is called with an empty array', async () => {
    const topicId = 'topic-empty-addall'
    const evictedRef = getTopicQueue(topicId)
    await evictedRef.add(() => Promise.resolve())
    await waitForTopicQueue(topicId)

    await expect(evictedRef.addAll([])).resolves.toEqual([])
    expect(hasTopicPendingRequests(topicId)).toBe(false)

    // Since evictedRef was not resurrected, getTopicQueue creates a fresh queue honoring new options
    const nextQueue = getTopicQueue(topicId, { concurrency: 1 })
    expect(nextQueue).not.toBe(evictedRef)
    clearTopicQueue(topicId)
  })
})
