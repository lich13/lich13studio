import type { AiPlugin } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { isGemini3Model, isQwen35to39Model, isSupportedThinkingTokenQwenModel } from '@renderer/config/models'
import type { Assistant, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { isOllamaProvider, isSupportEnableThinkingProvider } from '@renderer/utils/provider'

import type { AiSdkMiddlewareConfig } from '../types/middlewareConfig'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCachePlugin } from './anthropicCachePlugin'
import { createOpenrouterReasoningPlugin } from './openrouterReasoningPlugin'
import { createPdfCompatibilityPlugin } from './pdfCompatibilityPlugin'
import { createQwenThinkingPlugin } from './qwenThinkingPlugin'
import { createReasoningExtractionPlugin } from './reasoningExtractionPlugin'
import { createSkipGeminiThoughtSignaturePlugin } from './skipGeminiThoughtSignaturePlugin'

const logger = loggerService.withContext('PluginBuilder')

/**
 * 构建插件的上下文参数
 *
 * provider 和 model 是必选的 — 由 AiProvider 内部注入，
 * 不再依赖调用方手动传入，从根本上避免遗漏。
 */
export interface BuildPluginsContext {
  provider: Provider
  model: Model
  config: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
}

/**
 * 根据条件构建插件数组
 */
export function buildPlugins({ provider, model, config }: BuildPluginsContext): AiPlugin[] {
  const plugins: AiPlugin<any, any>[] = []

  // === PDF Compatibility ===
  // Must run before other plugins (e.g., Anthropic cache token estimation)
  // so that PDF FileParts are converted to TextParts for unsupported providers.
  plugins.push(createPdfCompatibilityPlugin(provider, model))

  // === AI SDK Middleware Plugins ===
  // 注意：wrapLanguageModel 会 .reverse() middleware 数组，
  // 数组中靠前的 middleware 反转后变成最外层包装。
  // extractReasoning 在流式路径中负责隔离 provider 返回的思考标签。

  // 0.1 Reasoning extraction for OpenAI/Azure providers
  const providerType = provider.type
  if (providerType === 'openai-response' && config.reasoningMode !== 'disabled') {
    const tagName = getReasoningTagName(model.id.toLowerCase())
    plugins.push(createReasoningExtractionPlugin({ tagName }))
  }

  if (provider.anthropicCacheControl?.tokenThreshold) {
    plugins.push(createAnthropicCachePlugin(provider))
  }

  // 0.3 OpenRouter reasoning redaction
  if (provider.id === SystemProviderIds.openrouter && config.reasoningMode !== 'disabled') {
    plugins.push(createOpenrouterReasoningPlugin())
  }

  // 0.5 Qwen thinking control for providers without enable_thinking support
  if (
    config.reasoningMode !== 'disabled' &&
    config.enableReasoning &&
    !isOllamaProvider(provider) &&
    isSupportedThinkingTokenQwenModel(model) &&
    !isQwen35to39Model(model) &&
    !isSupportEnableThinkingProvider(provider)
  ) {
    const enableThinking = config.assistant?.settings?.reasoning_effort !== undefined
    plugins.push(createQwenThinkingPlugin(enableThinking))
  }

  // 0.6 Skip Gemini3 thought signature for OpenAI-compatible API
  if (isGemini3Model(model)) {
    plugins.push(createSkipGeminiThoughtSignaturePlugin())
  }

  // 网络搜索已移除；仅保留显式 URL context 能力。
  if (config.enableUrlContext) {
    plugins.push(providerToolPlugin('urlContext', config.urlContextConfig))
  }
  // 3. 推理模型时添加推理插件
  // if (config.enableReasoning) {
  //   plugins.push(reasoningTimePlugin)
  // }

  logger.debug(
    'Final plugin list:',
    plugins.map((p) => p.name)
  )
  return plugins
}
