/**
 * AI SDK 到 Cherry Studio Chunk 适配器
 * 用于将 AI SDK 的 fullStream 转换为 Cherry Studio 的 chunk 格式
 */

import { loggerService } from '@logger'
import type { Chunk, ProviderMetadata } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { ProviderSpecificError } from '@renderer/types/provider-specific-error'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import type { ClaudeCodeRawValue } from '@shared/agents/claudecode/types'
import { AISDKError, type TextStreamPart, type ToolSet } from 'ai'

import { ToolCallChunkHandler } from './handleToolCallChunk'

const logger = loggerService.withContext('AiSdkToChunkAdapter')

/**
 * AI SDK 到 Cherry Studio Chunk 适配器类
 * 处理 fullStream 到 Cherry Studio chunk 的转换
 */
export class AiSdkToChunkAdapter {
  toolCallHandler: ToolCallChunkHandler
  private accumulate: boolean | undefined
  private pendingChunkCallbacks: Promise<unknown>[] = []
  private onSessionUpdate?: (sessionId: string) => void
  private responseStartTimestamp: number | null = null
  private firstTokenTimestamp: number | null = null
  private hasTextContent = false
  private emittedTerminalEvent = false
  private getSessionWasCleared?: () => boolean

  constructor(
    private onChunk: (chunk: Chunk) => void | Promise<void>,
    accumulate?: boolean,
    onSessionUpdate?: (sessionId: string) => void,
    getSessionWasCleared?: () => boolean
  ) {
    this.toolCallHandler = new ToolCallChunkHandler((chunk) => this.emitChunk(chunk))
    this.accumulate = accumulate
    this.onSessionUpdate = onSessionUpdate
    this.getSessionWasCleared = getSessionWasCleared
  }

  private emitChunk(chunk: Chunk) {
    const result = this.onChunk(chunk)
    if (result && typeof (result as Promise<void>).then === 'function') {
      this.pendingChunkCallbacks.push(result)
    }
  }

  private async flushChunkCallbacks() {
    while (this.pendingChunkCallbacks.length > 0) {
      const pending = this.pendingChunkCallbacks
      this.pendingChunkCallbacks = []
      await Promise.all(pending)
    }
  }

  private markFirstTokenIfNeeded() {
    if (this.firstTokenTimestamp === null && this.responseStartTimestamp !== null) {
      this.firstTokenTimestamp = Date.now()
    }
  }

  private resetTimingState() {
    this.responseStartTimestamp = null
    this.firstTokenTimestamp = null
  }

  /**
   * 处理 AI SDK 流结果
   * @param aiSdkResult AI SDK 的流结果对象
   * @returns 最终的文本内容
   */
  async processStream(aiSdkResult: any): Promise<string> {
    // The stream is the single source of truth for abort handling.
    // Both AI SDK (resilient stream) and the agent pipeline (withAbortStreamPart)
    // guarantee: abort → enqueue { type: 'abort' } → close gracefully.
    // convertAndEmitChunk processes the abort part and emits ChunkType.ERROR → onError.
    if (aiSdkResult.fullStream) {
      await this.readFullStream(aiSdkResult.fullStream)
    }

    try {
      return await aiSdkResult.text
    } catch (error: any) {
      // The text promise rejects when no steps completed (e.g. abort during thinking).
      // The abort was already handled via the 'abort' stream part above.
      if (isAbortError(error)) {
        return ''
      }
      throw error
    }
  }

  /**
   * 读取 fullStream 并转换为 Cherry Studio chunks
   * @param fullStream AI SDK 的 fullStream (ReadableStream)
   */
  private async readFullStream(fullStream: ReadableStream<TextStreamPart<ToolSet>>) {
    const reader = fullStream.getReader()
    const final = {
      text: '',
      responseText: '',
      reasoningContent: '',
      responseReasoningContent: '',
      reasoningId: '',
      providerMetadata: undefined as ProviderMetadata | undefined
    }
    this.resetTimingState()
    this.responseStartTimestamp = Date.now()
    // Reset state at the start of stream
    this.hasTextContent = false
    this.emittedTerminalEvent = false

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          // Some OpenAI-compatible gateways close the SSE stream after the
          // final text event without emitting the AI SDK `finish` part. The
          // content is still complete, so close the application stream here
          // instead of turning a successful response into a synthetic
          // "Stream ended without a terminal event" error.
          if (!this.emittedTerminalEvent && (this.hasTextContent || final.reasoningContent || final.responseText)) {
            this.emitThinkingCompleteIfNeeded(final)
            this.emittedTerminalEvent = true
            const response = {
              text: final.responseText || final.text || '',
              reasoning_content: final.responseReasoningContent || final.reasoningContent || ''
            }
            this.emitChunk({ type: ChunkType.BLOCK_COMPLETE, response })
            this.emitChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response })
          }
          break
        }

        // 转换并发送 chunk
        this.convertAndEmitChunk(value, final)
      }
    } finally {
      reader.releaseLock()
      await this.flushChunkCallbacks()
      this.resetTimingState()
    }
  }

  /**
   * 如果有累积的思考内容，发送 THINKING_COMPLETE chunk 并清空
   * @param final 包含 reasoningContent 的状态对象
   * @returns 是否发送了 THINKING_COMPLETE chunk
   */
  private emitThinkingCompleteIfNeeded(final: { reasoningContent: string; [key: string]: any }) {
    if (final.reasoningContent) {
      this.emitChunk({
        type: ChunkType.THINKING_COMPLETE,
        text: final.reasoningContent
      })
      final.reasoningContent = ''
    }
  }

  /**
   * 转换 AI SDK chunk 为 Cherry Studio chunk 并调用回调
   * @param chunk AI SDK 的 chunk 数据
   */
  private convertAndEmitChunk(
    chunk: TextStreamPart<any>,
    final: {
      text: string
      responseText: string
      reasoningContent: string
      responseReasoningContent: string
      reasoningId: string
      providerMetadata: ProviderMetadata | undefined
    }
  ) {
    logger.silly(`AI SDK chunk type: ${chunk.type}`, chunk)
    switch (chunk.type) {
      case 'raw': {
        const agentRawMessage = chunk.rawValue as ClaudeCodeRawValue
        if (agentRawMessage.type === 'init' && agentRawMessage.session_id) {
          this.onSessionUpdate?.(agentRawMessage.session_id)
        } else if (agentRawMessage.type === 'compact' && agentRawMessage.session_id) {
          this.onSessionUpdate?.(agentRawMessage.session_id)
        }
        this.emitChunk({
          type: ChunkType.RAW,
          content: agentRawMessage
        })
        break
      }
      // === 文本相关事件 ===
      case 'text-start':
        // 如果有未完成的思考内容，先生成 THINKING_COMPLETE
        // 这处理了某些提供商不发送 reasoning-end 事件的情况
        this.emitThinkingCompleteIfNeeded(final)
        this.emitChunk({
          type: ChunkType.TEXT_START
        })
        break
      case 'text-delta': {
        this.hasTextContent = true
        const processedText = chunk.text || ''
        const finalText = processedText

        final.responseText += finalText

        if (this.accumulate) {
          final.text += finalText
        } else {
          final.text = finalText
        }

        // Extract thoughtSignature from providerMetadata.google and preserve it
        const newSignature = chunk.providerMetadata?.google?.thoughtSignature as string | undefined
        if (newSignature) {
          final.providerMetadata = {
            ...final.providerMetadata,
            google: {
              ...final.providerMetadata?.google,
              thoughtSignature: newSignature
            }
          }
        }

        // Only emit chunk if there's text to send
        if (finalText) {
          this.markFirstTokenIfNeeded()
          this.emitChunk({
            type: ChunkType.TEXT_DELTA,
            text: this.accumulate ? final.text : finalText,
            providerMetadata: final.providerMetadata
          })
        }
        break
      }
      case 'text-end':
        if (chunk.providerMetadata?.text?.value) {
          final.responseText = chunk.providerMetadata.text.value as string
        }
        this.emitChunk({
          type: ChunkType.TEXT_COMPLETE,
          text: (chunk.providerMetadata?.text?.value as string) ?? final.text ?? '',
          providerMetadata: final.providerMetadata
        })
        final.text = ''
        // Clear providerMetadata for next text block
        final.providerMetadata = undefined
        break
      case 'reasoning-start':
        // if (final.reasoningId !== chunk.id) {
        final.reasoningId = chunk.id
        this.emitChunk({
          type: ChunkType.THINKING_START
        })
        // }
        break
      case 'reasoning-delta':
        final.reasoningContent += chunk.text || ''
        final.responseReasoningContent += chunk.text || ''
        if (chunk.text) {
          this.markFirstTokenIfNeeded()
        }
        this.emitChunk({
          type: ChunkType.THINKING_DELTA,
          text: final.reasoningContent || ''
        })
        break
      case 'reasoning-end':
        this.emitThinkingCompleteIfNeeded(final)
        break

      // === 工具调用相关事件（原始 AI SDK 事件，如果没有被中间件处理） ===

      case 'tool-input-start':
        this.toolCallHandler.handleToolInputStart(chunk)
        break
      case 'tool-input-delta':
        this.toolCallHandler.handleToolInputDelta(chunk)
        break
      case 'tool-input-end':
        this.toolCallHandler.handleToolInputEnd(chunk)
        break

      case 'tool-call':
        this.toolCallHandler.handleToolCall(chunk)
        break

      case 'tool-error':
        this.toolCallHandler.handleToolError(chunk)
        break

      case 'tool-result':
        this.toolCallHandler.handleToolResult(chunk)
        break

      case 'finish-step': {
        const { finishReason } = chunk
        if (finishReason === 'tool-calls') {
          this.emitChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
        }

        // final.reasoningId = ''
        break
      }

      case 'finish': {
        this.emittedTerminalEvent = true
        // Check if session was cleared (e.g., /clear command) and no text was output
        const sessionCleared = this.getSessionWasCleared?.() ?? false
        if (sessionCleared && !this.hasTextContent) {
          // Inject a "context cleared" message for the user
          const clearMessage = '✨ Context cleared. Starting fresh conversation.'
          this.emitChunk({
            type: ChunkType.TEXT_START
          })
          this.emitChunk({
            type: ChunkType.TEXT_DELTA,
            text: clearMessage
          })
          this.emitChunk({
            type: ChunkType.TEXT_COMPLETE,
            text: clearMessage
          })
          final.text = clearMessage
        }

        const usage = {
          completion_tokens: chunk.totalUsage?.outputTokens || 0,
          prompt_tokens: chunk.totalUsage?.inputTokens || 0,
          total_tokens: chunk.totalUsage?.totalTokens || 0
        }
        const metrics = this.buildMetrics(chunk.totalUsage)
        const baseResponse = {
          text: final.responseText || final.text || '',
          reasoning_content: final.responseReasoningContent || final.reasoningContent || ''
        }

        this.emitChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            ...baseResponse,
            usage: { ...usage },
            metrics: metrics ? { ...metrics } : undefined
          }
        })
        this.emitChunk({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: {
            ...baseResponse,
            usage: { ...usage },
            metrics: metrics ? { ...metrics } : undefined
          }
        })
        this.resetTimingState()
        break
      }

      // === 文件相关事件 ===
      case 'file':
        // 文件相关事件，可能是图片生成
        this.emitChunk({
          type: ChunkType.IMAGE_COMPLETE,
          image: {
            type: 'base64',
            images: [`data:${chunk.file.mediaType};base64,${chunk.file.base64}`]
          }
        })
        break
      case 'abort':
        this.emittedTerminalEvent = true
        this.emitChunk({
          type: ChunkType.ERROR,
          error: new DOMException('Request was aborted', 'AbortError')
        })
        break
      case 'error':
        this.emittedTerminalEvent = true
        this.emitChunk({
          type: ChunkType.ERROR,
          error: AISDKError.isInstance(chunk.error)
            ? chunk.error
            : new ProviderSpecificError({
                message: formatErrorMessage(chunk.error),
                provider: 'unknown',
                cause: chunk.error
              })
        })
        break

      default:
    }
  }

  private buildMetrics(totalUsage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
  }) {
    if (!totalUsage) {
      return undefined
    }

    const completionTokens = totalUsage.outputTokens ?? 0
    const now = Date.now()
    const start = this.responseStartTimestamp ?? now
    const firstToken = this.firstTokenTimestamp
    const timeFirstToken = Math.max(firstToken != null ? firstToken - start : 0, 0)
    const baseForCompletion = firstToken ?? start
    let timeCompletion = Math.max(now - baseForCompletion, 0)

    if (timeCompletion === 0 && completionTokens > 0) {
      timeCompletion = 1
    }

    return {
      completion_tokens: completionTokens,
      time_first_token_millsec: timeFirstToken,
      time_completion_millsec: timeCompletion
    }
  }
}

export default AiSdkToChunkAdapter
