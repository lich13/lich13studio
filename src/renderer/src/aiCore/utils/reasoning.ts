import { findTokenLimit } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import type { Assistant, Model } from '@renderer/types'
import { findOfficialModel } from '@shared/modelCatalog/runtime'
import { anthropicEffort, anthropicThinkingMode, normalizeReasoningEffort, thinkingBudget } from '@shared/reasoning'

export function getOpenAIReasoningParams(assistant: Assistant, _model: Model) {
  const levels = findOfficialModel(_model.id)?.efforts
  const requested = normalizeReasoningEffort(assistant.settings?.reasoning_effort)
  return {
    reasoningEffort: levels?.length
      ? levels.includes(requested)
        ? requested
        : ([...levels]
            .reverse()
            .find(
              (level) =>
                ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(level) <=
                ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(requested)
            ) ?? levels[0])
      : requested,
    reasoningSummary: getStoreSetting('openAI')?.summaryText
  }
}

export function getThinkingBudget(maxTokens: number | undefined, effort: string | undefined, modelId: string): number {
  const limit = findTokenLimit(modelId)
  return thinkingBudget(normalizeReasoningEffort(effort), maxTokens, limit?.max, limit?.min)
}

export function getAnthropicReasoningParams(assistant: Assistant, model: Model) {
  const effort = normalizeReasoningEffort(assistant.settings?.reasoning_effort)
  const official = findOfficialModel(model.id, 'anthropic')
  const mode = anthropicThinkingMode(model.id)
  if (official?.thinking === 'adaptive' || (!official?.thinking && (mode === 'five' || mode === 'four')))
    return { thinking: { type: 'adaptive' as const }, effort: anthropicEffort(model.id, effort) }
  const maxTokens = assistant.settings?.enableMaxTokens ? assistant.settings.maxTokens : undefined
  return {
    thinking: { type: 'enabled' as const, budgetTokens: getThinkingBudget(maxTokens, effort, model.id) },
    ...(official?.efforts?.length || (!official && mode === 'three')
      ? { effort: anthropicEffort(model.id, effort) }
      : {})
  }
}

export function getCustomParameters(assistant: Assistant): Record<string, any> {
  return (
    assistant?.settings?.customParameters?.reduce((acc, param) => {
      if (!param.name?.trim()) {
        return acc
      }
      // Parse JSON type parameters
      // Related: src/renderer/src/pages/settings/AssistantSettings/AssistantModelSettings.tsx:133-148
      // The UI stores JSON type params as strings (e.g., '{"key":"value"}')
      // This function parses them into objects before sending to the API
      if (param.type === 'json') {
        const value = param.value as string
        if (value === 'undefined') {
          return { ...acc, [param.name]: undefined }
        }
        try {
          return { ...acc, [param.name]: JSON.parse(value) }
        } catch {
          return { ...acc, [param.name]: value }
        }
      }
      return {
        ...acc,
        [param.name]: param.value
      }
    }, {}) || {}
  )
}

/**
 * Get reasoning tag name based on model ID
 * Used for extractReasoningMiddleware configuration
 */
export function getReasoningTagName(modelId: string | undefined): string {
  const tagName = {
    reasoning: 'reasoning',
    think: 'think',
    thought: 'thought',
    seedThink: 'seed:think'
  }

  if (modelId?.includes('gpt-oss')) return tagName.reasoning
  if (modelId?.includes('gemini')) return tagName.thought
  if (modelId?.includes('seed-oss-36b')) return tagName.seedThink
  return tagName.think
}
