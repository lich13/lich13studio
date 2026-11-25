import type { AiPlugin } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { isGemini3Model } from '@renderer/config/models'
import type { Assistant, Model, Provider } from '@renderer/types'

import type { AiSdkMiddlewareConfig } from '../types/middlewareConfig'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCachePlugin } from './anthropicCachePlugin'
import { createPdfCompatibilityPlugin } from './pdfCompatibilityPlugin'
import { createReasoningExtractionPlugin } from './reasoningExtractionPlugin'
import { createSkipGeminiThoughtSignaturePlugin } from './skipGeminiThoughtSignaturePlugin'

const logger = loggerService.withContext('PluginBuilder')

export interface BuildPluginsContext {
  provider: Provider
  model: Model
  config: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
}

export function buildPlugins({ provider, model, config }: BuildPluginsContext): AiPlugin[] {
  const plugins: AiPlugin<any, any>[] = []

  // === PDF Compatibility ===
  // Must run before other plugins (e.g., Anthropic cache token estimation)
  // so that PDF FileParts are converted to TextParts for unsupported providers.
  plugins.push(createPdfCompatibilityPlugin(provider, model))

  const providerType = provider.type
  if (providerType === 'openai-response' && config.reasoningMode !== 'disabled') {
    const tagName = getReasoningTagName(model.id.toLowerCase())
    plugins.push(createReasoningExtractionPlugin({ tagName }))
  }

  if (provider.anthropicCacheControl?.tokenThreshold) {
    plugins.push(createAnthropicCachePlugin(provider))
  }

  if (isGemini3Model(model)) {
    plugins.push(createSkipGeminiThoughtSignaturePlugin())
  }

  if (config.enableUrlContext) {
    plugins.push(providerToolPlugin('urlContext', config.urlContextConfig))
  }

  logger.debug(
    'Final plugin list:',
    plugins.map((p) => p.name)
  )
  return plugins
}
