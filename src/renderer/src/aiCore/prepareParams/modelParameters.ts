/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */
import { loggerService } from '@logger'
import {
  isClaudeReasoningModel,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@renderer/config/models'
import {
  DEFAULT_ASSISTANT_SETTINGS,
  getAssistantSettings,
  getProviderByModel
} from '@renderer/services/AssistantService'
import { type Assistant, type Model } from '@renderer/types'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'
import { anthropicThinkingMode } from '@shared/reasoning'

import { getThinkingBudget } from '../utils/reasoning'

const logger = loggerService.withContext('modelParameters')

/**
 * Retrieves the temperature parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTemperature is off.
 * - Disabled for Claude reasoning models when thinking is enabled.
 * - Disabled for models that do not support temperature.
 * - Clamped to 1 for models with max temperature of 1.
 * Otherwise, returns the temperature value.
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  const enableTemperature = assistant.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  if (!enableTemperature) {
    return undefined
  }

  // Thinking isn't compatible with temperature or top_k modifications as well as forced tool use.
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  if (isClaudeReasoningModel(model)) {
    logger.info(`Model ${model.id} does not support reasoning with temperature, disabling temperature`)
    return undefined
  }

  if (!isSupportTemperatureModel(model)) {
    logger.info(`Model ${model.id} does not support temperature, disabling temperature`)
    return undefined
  }

  let temperature = assistant.settings?.temperature ?? DEFAULT_ASSISTANT_SETTINGS.temperature

  if (isMaxTemperatureOneModel(model) && temperature > 1) {
    logger.info(`Model ${model.id} has max temperature of 1, clamping temperature from ${temperature} to 1`)
    temperature = 1
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTopP) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, both enabled; keeping temperature`)
  }

  return temperature
}

/**
 * Retrieves the TopP parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTopP is off.
 * - Disabled for models that do not support TopP.
 * - Disabled for mutually exclusive models when temperature is enabled.
 * - Clamped to [0.95, 1] for Claude reasoning models with thinking enabled.
 * Otherwise, returns the TopP value.
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  const enableTopP = assistant.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  if (!enableTopP) {
    return undefined
  }

  if (!isSupportTopPModel(model)) {
    logger.info(`Model ${model.id} does not support topP, disabling topP.`)
    return undefined
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, disabling topP.`)
    return undefined
  }

  let topP = assistant.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP

  // When thinking is enabled, the topP should be between 0.95 and 1
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  if (isClaudeReasoningModel(model)) {
    const clampedTopP = Math.max(0.95, Math.min(topP, 1))
    if (clampedTopP !== topP) {
      logger.info(`Claude Model ${model.id} has reasoning enabled, clamping topP from ${topP} to ${clampedTopP}`)
    }
    topP = clampedTopP
  }

  return topP
}

/**
 * 获取超时设置
 */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) {
    return 15 * 1000 * 60
  }
  return DEFAULT_TIMEOUT
}

export function getMaxTokens(assistant: Assistant, model: Model): number | undefined {
  const settings = getAssistantSettings(assistant)
  const provider = getProviderByModel(model)
  if (provider.type !== 'anthropic') return settings.enableMaxTokens ? settings.maxTokens : undefined
  const total = settings.enableMaxTokens ? (settings.maxTokens ?? 4096) : 4096
  const mode = anthropicThinkingMode(model.id)
  if (mode === 'five' || mode === 'four') return total
  return total - getThinkingBudget(total, settings.reasoning_effort, model.id)
}
