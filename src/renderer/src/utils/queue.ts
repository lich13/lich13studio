import { abortTopicStream } from '@renderer/services/StreamRegistry'
import PQueue from 'p-queue'

// Queue configuration - managed by topic
const requestQueues: { [topicId: string]: PQueue } = {}

const createManagedTopicQueue = (topicId: string, options = {}): PQueue => {
  const queue = new PQueue(options)
  const rawAdd = queue.add.bind(queue)
  const rawAddAll = queue.addAll.bind(queue)

  const resolveActiveQueue = (): PQueue => {
    const active = requestQueues[topicId]
    if (active && active !== queue) {
      return active
    }
    if (!active) {
      requestQueues[topicId] = queue
    }
    return queue
  }

  queue.add = ((fn: Parameters<PQueue['add']>[0], addOptions?: Parameters<PQueue['add']>[1]) => {
    const target = resolveActiveQueue()
    if (target !== queue) {
      return target.add(fn, addOptions)
    }
    return rawAdd(fn, addOptions)
  }) as PQueue['add']

  queue.addAll = ((fns: Parameters<PQueue['addAll']>[0], addOptions?: Parameters<PQueue['addAll']>[1]) => {
    if (fns.length === 0) {
      return Promise.resolve([])
    }
    const target = resolveActiveQueue()
    if (target !== queue) {
      return target.addAll(fns, addOptions)
    }
    return rawAddAll(fns, addOptions)
  }) as PQueue['addAll']

  queue.on('idle', () => {
    if (requestQueues[topicId] === queue && queue.size === 0 && queue.pending === 0) {
      delete requestQueues[topicId]
    }
  })

  return queue
}

/**
 * Get or create a queue for a specific topic
 * @param topicId The ID of the topic
 * @param options
 * @returns A PQueue instance for the topic
 */
export const getTopicQueue = (topicId: string, options = {}): PQueue => {
  if (!requestQueues[topicId]) {
    requestQueues[topicId] = createManagedTopicQueue(topicId, options)
  }
  return requestQueues[topicId]
}

/**
 * Clear the queue for a specific topic
 * @param topicId The ID of the topic
 */
export const clearTopicQueue = (topicId: string): void => {
  abortTopicStream(topicId)
  if (requestQueues[topicId]) {
    requestQueues[topicId].clear()
    delete requestQueues[topicId]
  }
}

/**
 * Clear all topic queues
 */
export const clearAllQueues = (): void => {
  Object.keys(requestQueues).forEach((topicId) => {
    abortTopicStream(topicId)
    requestQueues[topicId].clear()
    delete requestQueues[topicId]
  })
}

/**
 * Check if a topic has pending requests
 * @param topicId The ID of the topic
 * @returns True if the topic has pending requests
 */
export const hasTopicPendingRequests = (topicId: string): boolean => {
  return requestQueues[topicId]?.size > 0 || requestQueues[topicId]?.pending > 0
}

/**
 * Get the number of pending requests for a topic
 * @param topicId The ID of the topic
 * @returns The number of pending requests
 */
export const getTopicPendingRequestCount = (topicId: string): number => {
  if (!requestQueues[topicId]) {
    return 0
  }
  return requestQueues[topicId].size + requestQueues[topicId].pending
}

/**
 * Wait for all pending requests in a topic queue to complete
 * @param topicId The ID of the topic
 */
export const waitForTopicQueue = async (topicId: string): Promise<void> => {
  while (hasTopicPendingRequests(topicId)) {
    const active = requestQueues[topicId]
    if (!active) break
    await active.onIdle()
  }
  const idleQueue = requestQueues[topicId]
  if (idleQueue && idleQueue.size === 0 && idleQueue.pending === 0) {
    delete requestQueues[topicId]
  }
}
