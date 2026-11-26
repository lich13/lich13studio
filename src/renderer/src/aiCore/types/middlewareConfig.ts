import type { Assistant, ChatRequestMode } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import type { ReasoningMode } from '@shared/reasoning'

export interface AiSdkMiddlewareConfig {
  chatRequestMode?: ChatRequestMode
  onChunk?: (chunk: Chunk) => void | Promise<void>
  assistant?: Assistant
  enableReasoning: boolean
  enableUrlContext: boolean
  reasoningMode?: ReasoningMode
  textDeltaMode?: 'delta' | 'cumulative'
  urlContextConfig?: Record<string, any>
}
