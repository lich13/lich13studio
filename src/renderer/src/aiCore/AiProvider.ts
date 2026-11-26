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
import { buildMiddlewares } from './plugins/PluginBuilder'
import { formatProviderApiHost, getActualProvider, providerToAiSdkConfig } from './provider/providerConfig'
import type { AppProviderSettingsMap, CompletionsResult, ProviderConfig } from './types'
import type { AiSdkMiddlewareConfig } from './types/middlewareConfig'
import { withReasoningFallback } from './utils/reasoningFallback'

export type AiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
}

export default class AiProvider {
  private config?: ProviderConfig
  private actualProvider: Provider
  private model?: Model

  constructor(model: Model, provider?: Provider)
  constructor(provider: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider) {
    if (this.isModel(modelOrProvider)) {
      this.model = requireCurrentModel(modelOrProvider)
      this.actualProvider = provider ? formatProviderApiHost(provider) : getActualProvider(modelOrProvider)
      this.config = providerToAiSdkConfig(this.actualProvider, modelOrProvider)
    } else {
      this.actualProvider = formatProviderApiHost(modelOrProvider)
    }
  }

  private isModel(obj: Model | Provider): obj is Model {
    return 'provider' in obj && typeof obj.provider === 'string'
  }

  public getActualProvider() {
    return this.actualProvider
  }

  public async completions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig
  ): Promise<CompletionsResult> {
    if (!runtimeCapabilities.android) {
      return this.runCompletions(modelId, params, middlewareConfig)
    }
    const controller = new AbortController()
    const release = await backgroundTasks.acquire(() => controller.abort())
    try {
      params.abortSignal?.throwIfAborted()
      controller.signal.throwIfAborted()
      return await this.runCompletions(
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

  private async runCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig
  ): Promise<CompletionsResult> {
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }
    if (!this.config) {
      this.config = providerToAiSdkConfig(this.actualProvider, this.model)
    }

    if (this.actualProvider.id === 'anthropic' && this.actualProvider.authType === 'oauth') {
      const system = params.system
      const systemParam: string | Array<any> | undefined =
        typeof system === 'string' || Array.isArray(system) || system === undefined ? system : undefined
      const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(systemParam)
      params.system = undefined
      params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
    }

    const providerConfig = this.config
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
    const middlewares = buildMiddlewares({
      provider: this.actualProvider,
      model: this.model!,
      config: middlewareConfig
    })

    const executor = await createExecutor<keyof AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      {
        middlewares,
        enableUrlContext: middlewareConfig.enableUrlContext,
        urlContextConfig: middlewareConfig.urlContextConfig
      }
    )

    const nonStream = middlewareConfig.chatRequestMode === 'non-stream'
    const hasTools = Boolean(params.tools && Object.keys(params.tools).length > 0)

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
        accumulate
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
    }

    let streamError: unknown
    const streamResult = await executor.streamText({
      ...params,
      model: modelId,
      onError({ error }) {
        streamError = error
      }
    })

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
      if (streamError) {
        throw streamError
      }
      throw error
    }
  }
}
