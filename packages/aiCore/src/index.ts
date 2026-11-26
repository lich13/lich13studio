import { type AnthropicProvider, type AnthropicProviderSettings, createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import {
  generateText as _generateText,
  type LanguageModelMiddleware,
  streamText as _streamText,
  wrapLanguageModel
} from 'ai'

export type ProviderId = 'openai' | 'anthropic'

export interface ProviderSettingsMap {
  openai: OpenAIProviderSettings
  anthropic: AnthropicProviderSettings
}

export interface ExecutorOptions {
  middlewares?: LanguageModelMiddleware[]
  enableUrlContext?: boolean
  urlContextConfig?: Record<string, any>
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

export type ExecutorStreamTextParams = DistributiveOmit<Parameters<typeof _streamText>[0], 'model'> & { model: string }
export type ExecutorGenerateTextParams = DistributiveOmit<Parameters<typeof _generateText>[0], 'model'> & {
  model: string
}

export interface DirectExecutor {
  streamText: (params: ExecutorStreamTextParams) => Promise<ReturnType<typeof _streamText>>
  generateText: (params: ExecutorGenerateTextParams) => ReturnType<typeof _generateText>
}

export async function createExecutor<T extends ProviderId = ProviderId>(
  providerId: T,
  providerSettings: ProviderSettingsMap[T],
  options: ExecutorOptions = {}
): Promise<DirectExecutor> {
  const anthropicProvider: AnthropicProvider | null =
    providerId === 'anthropic' ? createAnthropic(providerSettings as AnthropicProviderSettings) : null
  const openaiProvider = providerId === 'openai' ? createOpenAI(providerSettings as OpenAIProviderSettings) : null

  if (!anthropicProvider && !openaiProvider) {
    throw new Error(`Unsupported provider "${String(providerId)}"`)
  }

  const resolveWrappedModel = (modelId: string): LanguageModelV3 => {
    const baseModel = anthropicProvider
      ? anthropicProvider.languageModel(modelId)
      : openaiProvider!.languageModel(modelId)
    const middlewares = options.middlewares ?? []
    return middlewares.length > 0 ? wrapLanguageModel({ model: baseModel, middleware: middlewares }) : baseModel
  }

  const applyUrlContext = <P extends Record<string, any>>(params: P): P => {
    if (!options.enableUrlContext || !anthropicProvider) return params
    const userConfig = options.urlContextConfig?.anthropic ?? {}
    return {
      ...params,
      tools: {
        ...params.tools,
        urlContext: anthropicProvider.tools.webFetch_20260209(userConfig)
      }
    }
  }

  return {
    async streamText(params) {
      const next = applyUrlContext(params)
      return _streamText({ ...next, model: resolveWrappedModel(next.model) } as Parameters<typeof _streamText>[0])
    },
    async generateText(params) {
      const next = applyUrlContext(params)
      return _generateText({ ...next, model: resolveWrappedModel(next.model) } as Parameters<typeof _generateText>[0])
    }
  }
}
