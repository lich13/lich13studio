import { loggerService } from '@logger'

export type StreamLifecycle = 'queued' | 'connecting' | 'streaming' | 'completed' | 'paused' | 'error' | 'aborted'

export type StreamTerminalReason = 'completed' | 'paused' | 'error' | 'aborted' | 'timeout'

export interface ActiveStreamEntry {
  topicId: string
  assistantMsgId: string
  generation: number
  phase: StreamLifecycle
  hasContent: boolean
  startedAt: number
  abort?: () => void
}

const logger = loggerService.withContext('StreamRegistry')
const activeStreams = new Map<string, ActiveStreamEntry>()
let nextGeneration = 0

export const beginStream = (topicId: string, assistantMsgId: string): ActiveStreamEntry | undefined => {
  const existing = activeStreams.get(topicId)
  if (existing) {
    logger.warn('Refusing to start a second stream for the same topic', {
      topicId,
      activeAssistantMsgId: existing.assistantMsgId,
      requestedAssistantMsgId: assistantMsgId
    })
    return undefined
  }

  const entry: ActiveStreamEntry = {
    topicId,
    assistantMsgId,
    generation: ++nextGeneration,
    phase: 'queued',
    hasContent: false,
    startedAt: Date.now()
  }
  activeStreams.set(topicId, entry)
  return entry
}

export const isCurrentStream = (entry: ActiveStreamEntry): boolean => {
  const current = activeStreams.get(entry.topicId)
  return current?.generation === entry.generation
}

export const setStreamPhase = (entry: ActiveStreamEntry, phase: StreamLifecycle): void => {
  if (isCurrentStream(entry)) {
    entry.phase = phase
  }
}

export const markStreamContent = (entry: ActiveStreamEntry): void => {
  if (isCurrentStream(entry)) {
    entry.hasContent = true
    entry.phase = 'streaming'
  }
}

export const setStreamAbort = (entry: ActiveStreamEntry, abort: () => void): void => {
  if (isCurrentStream(entry)) {
    entry.abort = abort
  }
}

export const finishStream = (entry: ActiveStreamEntry, reason: StreamTerminalReason): void => {
  if (!isCurrentStream(entry)) return
  entry.phase =
    reason === 'completed' ? 'completed' : reason === 'paused' ? 'paused' : reason === 'aborted' ? 'aborted' : 'error'
  activeStreams.delete(entry.topicId)
}

export const abortStream = (entry: ActiveStreamEntry): void => {
  if (!isCurrentStream(entry)) return
  entry.phase = 'aborted'
  entry.abort?.()
}

export const abortTopicStream = (topicId: string): void => {
  const entry = activeStreams.get(topicId)
  if (entry) abortStream(entry)
}

export const getActiveStream = (topicId: string): ActiveStreamEntry | undefined => activeStreams.get(topicId)

export const clearStreamRegistry = (): void => {
  for (const entry of activeStreams.values()) entry.abort?.()
  activeStreams.clear()
}

export interface StreamTerminalGuard {
  isTerminal: () => boolean
  acceptComplete: () => boolean
  acceptError: () => boolean
}

export const createStreamTerminalGuard = (): StreamTerminalGuard => {
  let terminal = false
  return {
    isTerminal: () => terminal,
    acceptComplete: () => {
      if (terminal) return false
      terminal = true
      return true
    },
    acceptError: () => {
      if (terminal) return false
      terminal = true
      return true
    }
  }
}
