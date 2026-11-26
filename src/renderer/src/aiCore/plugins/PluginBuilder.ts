import { isGemini3Model } from '@renderer/config/models'
import type { Assistant, Model, Provider } from '@renderer/types'
import type { LanguageModelMiddleware } from 'ai'

import type { AiSdkMiddlewareConfig } from '../types/middlewareConfig'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCacheMiddleware } from './anthropicCachePlugin'
import { createPdfCompatibilityMiddleware } from './pdfCompatibilityPlugin'
import { createReasoningExtractionMiddleware } from './reasoningExtractionPlugin'
import { createSkipGeminiThoughtSignatureMiddleware } from './skipGeminiThoughtSignaturePlugin'

export interface BuildMiddlewaresContext {
  provider: Provider
  model: Model
  config: AiSdkMiddlewareConfig & { assistant: Assistant }
}

export function buildMiddlewares({ provider, model, config }: BuildMiddlewaresContext): LanguageModelMiddleware[] {
  const middlewares: LanguageModelMiddleware[] = [createPdfCompatibilityMiddleware(provider, model)]

  if (provider.type === 'openai-response' && config.reasoningMode !== 'disabled') {
    const tagName = getReasoningTagName(model.id.toLowerCase())
    middlewares.push(createReasoningExtractionMiddleware({ tagName }))
  }

  if (provider.anthropicCacheControl?.tokenThreshold) {
    middlewares.push(createAnthropicCacheMiddleware(provider))
  }

  if (isGemini3Model(model)) {
    middlewares.push(createSkipGeminiThoughtSignatureMiddleware())
  }

  return middlewares
}
