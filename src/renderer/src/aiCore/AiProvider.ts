import { createExecutor } from '@cherrystudio/ai-core'
import { requireCurrentModel } from '@renderer/services/AssistantService'
import { backgroundTasks } from '@renderer/services/mobile/BackgroundTaskService'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { reasoningUsage } from '@renderer/services/ReasoningUsageService'
import type { Assistant, Model, Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { buildClaudeCodeSystemModelMessage } from '@shared/anthropic'
import { normalizeReasoningEffort } from '@shared/reasoning'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, getActualProvider, providerToAiSdkConfig } from './provider/providerConfig'
import type { AppProviderSettingsMap, CompletionsResult, ProviderConfig } from './types'
import type { AiSdkMiddlewareConfig } from './types/middlewareConfig'
import { withReasoningFallback } from './utils/reasoningFallback'

export type AiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
  // topicId for tracing
  topicId?: string
  callType: string
}

export default class AiProvider {
  private config?: ProviderConfig
  private actualProvider: Provider
  private model?: Model

  /**
   * Constructor for AiProvider
   *
   * @param modelOrProvider - Model or Provider object
   * @param provider - Optional Provider object (only used when first param is Model)
   *
   * @remarks
   * **Important behavior notes**:
   *
   * 1. When called with `(model)`:
   *    - Calls `getActualProvider(model)` to retrieve and format the provider
   *    - URL will be automatically formatted via `formatProviderApiHost`, adding version suffixes like `/v1`
   *
   * 2. When called with `(model, provider)`:
   *    - The provided provider will be adapted via `adaptProvider`
   *    - URL formatting behavior depends on the adapted result
   *
   * 3. When called with `(provider)`:
   *    - The provider will be adapted via `adaptProvider`
   *    - Used for operations that don't need a model (e.g., fetchModels)
   *
   * @example
   * ```typescript
   * // Recommended: Auto-format URL
   * const ai = new AiProvider(model)
   *
   * // Provider will be adapted
   * const ai = new AiProvider(model, customProvider)
   *
   * // For operations that don't need a model
   * const ai = new AiProvider(provider)
   * ```
   */
  constructor(model: Model, provider?: Provider)
  constructor(provider: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider) {
    if (this.isModel(modelOrProvider)) {
      // 传入的是 Model
      this.model = requireCurrentModel(modelOrProvider)
      this.actualProvider = provider
        ? adaptProvider({ provider, model: modelOrProvider })
        : getActualProvider(modelOrProvider)
      // 注意：config 可能是同步值或 Promise，在 completions() 中会统一处理
      const configOrPromise = providerToAiSdkConfig(this.actualProvider, modelOrProvider)
      this.config = configOrPromise instanceof Promise ? undefined : configOrPromise
    } else {
      // 传入的是 Provider
      this.actualProvider = adaptProvider({ provider: modelOrProvider })
      // model为可选，某些操作（如fetchModels）不需要model
    }
  }

  /**
   * 类型守卫函数：通过 provider 属性区分 Model 和 Provider
   */
  private isModel(obj: Model | Provider): obj is Model {
    return 'provider' in obj && typeof obj.provider === 'string'
  }

  public getActualProvider() {
    return this.actualProvider
  }

  public async completions(modelId: string, params: StreamTextParams, middlewareConfig: AiProviderConfig) {
    if (!runtimeCapabilities.android) return this.completionsWithLease(modelId, params, middlewareConfig)
    const controller = new AbortController()
    const release = await backgroundTasks.acquire(() => controller.abort())
    try {
      params.abortSignal?.throwIfAborted()
      controller.signal.throwIfAborted()
      return await this.completionsWithLease(
        modelId,
        {
          ...params,
          abortSignal: params.abortSignal ? AbortSignal.any([params.abortSignal, controller.signal]) : controller.signal
        },
        middlewareConfig
      )
    } finally {
      release()
    }
  }

  private async completionsWithLease(modelId: string, params: StreamTextParams, middlewareConfig: AiProviderConfig) {
    // 检查model是否存在
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }

    // Config is now set in constructor, ApiService handles key rotation before passing provider
    if (!this.config) {
      // If config wasn't set in constructor (when provider only), generate it now
      this.config = await Promise.resolve(providerToAiSdkConfig(this.actualProvider, this.model))
    }

    // 注意：模型对象将由 createExecutor 内部处理，不再需要预先创建

    if (this.actualProvider.id === 'anthropic' && this.actualProvider.authType === 'oauth') {
      // 类型守卫：确保 system 是 string、Array 或 undefined
      const system = params.system
      let systemParam: string | Array<any> | undefined
      if (typeof system === 'string' || Array.isArray(system) || system === undefined) {
        systemParam = system
      } else {
        // SystemModelMessage 类型，转换为 string
        systemParam = undefined
      }

      const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(systemParam)
      params.system = undefined // 清除原有system，避免重复
      params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
    }

    return await this.modernCompletions(modelId, params, middlewareConfig, this.config)
  }

  /**
   * 使用现代化AI SDK的completions实现
   */
  private async modernCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig,
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    const requested = normalizeReasoningEffort(middlewareConfig.assistant.settings?.reasoning_effort)
    return withReasoningFallback({
      provider: this.actualProvider,
      modelId,
      params,
      requested,
      disabled: middlewareConfig.reasoningMode === 'disabled',
      onChunk: middlewareConfig.onChunk,
      onEffective: (effective) => reasoningUsage.set(this.actualProvider.id, modelId, { requested, effective }),
      execute: (attemptParams, onChunk) =>
        this.executeCompletions(modelId, attemptParams, { ...middlewareConfig, onChunk }, providerConfig)
    })
  }

  private async executeCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig,
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    const plugins = buildPlugins({
      provider: this.actualProvider,
      model: this.model!,
      config: middlewareConfig
    })

    // 用构建好的插件数组创建executor
    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      plugins
    )

    const nonStream = middlewareConfig.chatRequestMode === 'non-stream'
    const hasTools = Boolean(params.tools && Object.keys(params.tools).length > 0)

    // A non-stream request must not expose partial provider output to the UI.
    // Use generateText for ordinary replies. Tool-capable requests still use
    // the full stream internally so tool lifecycle events are preserved, but
    // buffer every event and publish it only after the stream is complete.
    if (nonStream && (!hasTools || !middlewareConfig.onChunk)) {
      const generateParams = { ...params, model: modelId }
      delete generateParams.experimental_transform
      const result = await executor.generateText(generateParams as Parameters<typeof executor.generateText>[0])
      const finalText = result.text || ''
      const usage = result.usage

      if (middlewareConfig.onChunk) {
        const response = { text: finalText, usage } as any
        await Promise.resolve(middlewareConfig.onChunk({ type: ChunkType.TEXT_START }))
        if (finalText) {
          await Promise.resolve(
            middlewareConfig.onChunk({ type: ChunkType.TEXT_DELTA, text: finalText, textMode: 'delta' })
          )
        }
        await Promise.resolve(middlewareConfig.onChunk({ type: ChunkType.TEXT_COMPLETE, text: finalText }))
        await Promise.resolve(middlewareConfig.onChunk({ type: ChunkType.BLOCK_COMPLETE, response }))
        await Promise.resolve(
          middlewareConfig.onChunk({
            type: ChunkType.LLM_RESPONSE_COMPLETE,
            response,
            finishReason: result.finishReason
          })
        )
      }

      return { getText: () => finalText, usage }
    }

    // 创建带有中间件的执行器
    if (middlewareConfig.onChunk) {
      const bufferedChunks: Chunk[] = []
      const accumulate = middlewareConfig.textDeltaMode
        ? middlewareConfig.textDeltaMode === 'cumulative'
        : this.model!.supported_text_delta !== false
      const adapter = new AiSdkToChunkAdapter(
        nonStream
          ? (chunk) => {
              bufferedChunks.push(chunk)
            }
          : middlewareConfig.onChunk,
        accumulate,
        undefined,
        undefined
      )

      let streamError: unknown
      const streamResult = await executor.streamText({
        ...params,
        model: modelId,
        experimental_context: { onChunk: middlewareConfig.onChunk },
        onError({ error }) {
          streamError = error
        }
      })

      let finalText: string
      try {
        finalText = await adapter.processStream(streamResult)
      } catch (error) {
        throw streamError ?? error
      }

      if (streamError) {
        throw streamError
      }

      if (nonStream) {
        for (const chunk of bufferedChunks) await Promise.resolve(middlewareConfig.onChunk(chunk))
      }

      return {
        getText: () => finalText,
        usage: await streamResult.totalUsage
      }
    } else {
      // Since no onChunk is provided, the external consumer would not handle error chunk.
      // So we need to capture the actual stream error so we can throw it instead of the
      // generic NoTextGeneratedError ("No output generated. Check the stream
      // for errors.") that AI SDK raises when streamResult.text is accessed
      // after a failed stream.
      let streamError: unknown = undefined

      const streamResult = await executor.streamText({
        ...params,
        model: modelId,
        onError({ error }) {
          streamError = error
        }
      })

      // 强制消费流,不然await streamResult.text会阻塞
      await streamResult?.consumeStream({
        onError(error) {
          if (!streamError) {
            streamError = error
          }
        }
      })

      try {
        const finalText = await streamResult.text
        const usage = await streamResult.totalUsage

        return {
          getText: () => finalText,
          usage
        }
      } catch (error) {
        // If we captured the real stream error, throw that instead of the
        // generic NoTextGeneratedError so callers get actionable diagnostics.
        if (streamError) {
          throw streamError
        }
        throw error
      }
    }
  }

  public getBaseURL(): string {
    return this.actualProvider.apiHost || ''
  }

  public getApiKey(): string {
    const apiKey = this.actualProvider.apiKey
    if (!apiKey || apiKey.trim() === '') {
      return ''
    }

    const keys = apiKey
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)

    if (keys.length === 0) {
      return ''
    }

    if (keys.length === 1) {
      return keys[0]
    }

    // Multi-key rotation
    const keyName = `provider:${this.actualProvider.id}:last_used_key`
    const lastUsedKey = window.keyv.get(keyName)

    if (!lastUsedKey) {
      window.keyv.set(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    window.keyv.set(keyName, nextKey)

    return nextKey
  }
}
