import { loggerService } from '@logger'
import type {
  ExternalToolResult,
  GenerateImageResponse,
  MCPToolResponse,
  NormalToolResponse,
  WebSearchResponse
} from '@renderer/types'
import type { Chunk, ProviderMetadata } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { Response } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'

const logger = loggerService.withContext('StreamProcessingService')

type MaybePromise<T = void> = T | Promise<T>

// Define the structure for the callbacks that the StreamProcessor will invoke
export interface StreamProcessorCallbacks {
  // LLM response created
  onLLMResponseCreated?: () => MaybePromise
  // Text content start
  onTextStart?: () => MaybePromise
  // Text content chunk received
  onTextChunk?: (text: string, providerMetadata?: ProviderMetadata) => MaybePromise
  // Full text content received
  onTextComplete?: (text: string, providerMetadata?: ProviderMetadata) => MaybePromise
  // thinking content start
  onThinkingStart?: () => MaybePromise
  // Thinking/reasoning content chunk received (e.g., from Claude)
  onThinkingChunk?: (text: string, thinking_millsec?: number) => MaybePromise
  onThinkingComplete?: (text: string, thinking_millsec?: number) => MaybePromise
  // A tool call response chunk (from MCP)
  onToolCallPending?: (toolResponse: MCPToolResponse | NormalToolResponse) => MaybePromise
  onToolCallInProgress?: (toolResponse: MCPToolResponse | NormalToolResponse) => MaybePromise
  onToolCallComplete?: (toolResponse: MCPToolResponse | NormalToolResponse) => MaybePromise
  // Tool argument streaming (partial arguments during streaming)
  onToolArgumentStreaming?: (toolResponse: MCPToolResponse | NormalToolResponse) => MaybePromise
  // External tool call in progress
  onExternalToolInProgress?: () => MaybePromise
  // Citation data received (e.g., from Internet and  Knowledge Base)
  onExternalToolComplete?: (externalToolResult: ExternalToolResult) => MaybePromise
  // LLM Web search in progress
  onLLMWebSearchInProgress?: () => MaybePromise
  // LLM Web search complete
  onLLMWebSearchComplete?: (llmWebSearchResult: WebSearchResponse) => MaybePromise
  // Get citation block ID
  getCitationBlockId?: () => string | null
  // Set citation block ID
  setCitationBlockId?: (blockId: string) => void
  // Image generation chunk received
  onImageCreated?: () => MaybePromise
  onImageDelta?: (imageData: GenerateImageResponse) => MaybePromise
  onImageGenerated?: (imageData?: GenerateImageResponse) => MaybePromise
  onLLMResponseComplete?: (response?: Response) => MaybePromise
  // Called when an error occurs during chunk processing
  onError?: (error: any) => MaybePromise
  // Called when the entire stream processing is signaled as complete (success or failure)
  onComplete?: (status: AssistantMessageStatus, response?: Response) => MaybePromise
  onVideoSearched?: (video?: { type: 'url' | 'path'; content: string }, metadata?: Record<string, any>) => MaybePromise
  // Called when a block is created
  onBlockCreated?: () => MaybePromise
  // Called when raw data is received (e.g., session_id updates from Agent SDK)
  onRawData?: (content: unknown, metadata?: Record<string, any>) => MaybePromise
}

export type StreamProcessor = (chunk: Chunk) => Promise<void>

// Function to create a stream processor instance
export function createStreamProcessor(callbacks: StreamProcessorCallbacks = {}): StreamProcessor {
  const handleError = async (error: any) => {
    logger.error('Error processing stream chunk:', error as Error)
    try {
      await callbacks.onError?.(error)
    } catch (callbackError) {
      logger.error('Error in stream error callback:', callbackError as Error)
    }
  }

  const processChunk = async (chunk: Chunk) => {
    try {
      const data = chunk
      // logger.debug('data: ', data)
      switch (data.type) {
        case ChunkType.BLOCK_COMPLETE:
          await callbacks.onComplete?.(AssistantMessageStatus.SUCCESS, data?.response)
          break
        case ChunkType.LLM_RESPONSE_CREATED:
          await callbacks.onLLMResponseCreated?.()
          break
        case ChunkType.TEXT_START:
          await callbacks.onTextStart?.()
          break
        case ChunkType.TEXT_DELTA:
          await callbacks.onTextChunk?.(data.text, data.providerMetadata)
          break
        case ChunkType.TEXT_COMPLETE:
          await callbacks.onTextComplete?.(data.text, data.providerMetadata)
          break
        case ChunkType.THINKING_START:
          await callbacks.onThinkingStart?.()
          break
        case ChunkType.THINKING_DELTA:
          await callbacks.onThinkingChunk?.(data.text, data.thinking_millsec)
          break
        case ChunkType.THINKING_COMPLETE:
          await callbacks.onThinkingComplete?.(data.text, data.thinking_millsec)
          break
        case ChunkType.MCP_TOOL_PENDING:
          if (callbacks.onToolCallPending) {
            await Promise.all(data.responses.map((toolResp) => callbacks.onToolCallPending!(toolResp)))
          }
          break
        case ChunkType.MCP_TOOL_IN_PROGRESS:
          if (callbacks.onToolCallInProgress) {
            await Promise.all(data.responses.map((toolResp) => callbacks.onToolCallInProgress!(toolResp)))
          }
          break
        case ChunkType.MCP_TOOL_COMPLETE:
          if (callbacks.onToolCallComplete && data.responses.length > 0) {
            await Promise.all(data.responses.map((toolResp) => callbacks.onToolCallComplete!(toolResp)))
          }
          break
        case ChunkType.MCP_TOOL_STREAMING:
          if (callbacks.onToolArgumentStreaming) {
            await Promise.all(data.responses.map((toolResp) => callbacks.onToolArgumentStreaming!(toolResp)))
          }
          break
        case ChunkType.EXTERNEL_TOOL_IN_PROGRESS:
          await callbacks.onExternalToolInProgress?.()
          break
        case ChunkType.EXTERNEL_TOOL_COMPLETE:
          await callbacks.onExternalToolComplete?.(data.external_tool)
          break
        case ChunkType.LLM_WEB_SEARCH_IN_PROGRESS:
          await callbacks.onLLMWebSearchInProgress?.()
          break
        case ChunkType.LLM_WEB_SEARCH_COMPLETE:
          await callbacks.onLLMWebSearchComplete?.(data.llm_web_search)
          break
        case ChunkType.IMAGE_CREATED:
          await callbacks.onImageCreated?.()
          break
        case ChunkType.IMAGE_DELTA:
          await callbacks.onImageDelta?.(data.image)
          break
        case ChunkType.IMAGE_COMPLETE:
          await callbacks.onImageGenerated?.(data.image)
          break
        case ChunkType.LLM_RESPONSE_COMPLETE:
          await callbacks.onLLMResponseComplete?.(data.response)
          break
        case ChunkType.ERROR:
          try {
            await callbacks.onError?.(data.error)
          } catch (callbackError) {
            logger.error('Error in stream error callback:', callbackError as Error)
          }
          break
        case ChunkType.VIDEO_SEARCHED:
          await callbacks.onVideoSearched?.(data.video, data.metadata)
          break
        case ChunkType.BLOCK_CREATED:
          await callbacks.onBlockCreated?.()
          break
        case ChunkType.RAW:
          await callbacks.onRawData?.(data.content, data.metadata)
          break
        default:
          // Handle unknown chunk types or log an error
          logger.warn(`Unknown chunk type: ${data.type}`)
      }
    } catch (error) {
      await handleError(error)
    }
  }

  let processingQueue = Promise.resolve()

  return (chunk: Chunk) => {
    processingQueue = processingQueue.then(
      () => processChunk(chunk),
      () => processChunk(chunk)
    )
    return processingQueue
  }
}
