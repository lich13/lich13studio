import type { Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'

import { resolveModelCapabilities } from './capabilities'
import { isOpenAIReasoningModel } from './openai'
import { withModelIdAndNameAsId } from './utils'

const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

function isSupportedReasoningEffortGrokModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = model?.provider?.toLowerCase()
  if (modelId.includes('grok-3-mini')) {
    return true
  }

  if (providerId === 'openrouter' && modelId.includes('grok-4-fast')) {
    return true
  }

  return false
}

function isGrokReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  if (
    isSupportedReasoningEffortGrokModel(model) ||
    (modelId.includes('grok-4') && !modelId.includes('non-reasoning'))
  ) {
    return true
  }

  return false
}

function isGeminiReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  if (modelId.startsWith('gemini') && modelId.includes('thinking')) {
    return true
  }

  if (isSupportedThinkingTokenGeminiModel(model)) {
    return true
  }

  return false
}

const GEMINI_THINKING_MODEL_REGEX =
  /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i

const isSupportedThinkingTokenGeminiModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  if (GEMINI_THINKING_MODEL_REGEX.test(modelId)) {
    if (modelId.includes('gemini-3-pro-image')) {
      return true
    }
    if (modelId.includes('image') || modelId.includes('tts')) {
      return false
    }
    return true
  } else {
    return false
  }
}

function isQwenReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (modelId.startsWith('qwen3')) {
    if (modelId.includes('thinking')) {
      return true
    }
  }

  if (isSupportedThinkingTokenQwenModel(model)) {
    return true
  }

  if (modelId.includes('qwq') || modelId.includes('qvq')) {
    return true
  }

  return false
}

function isSupportedThinkingTokenQwenModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (
    ['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((field) => modelId.includes(field))
  ) {
    return false
  }

  if (/^qwen3\.[5-9]/.test(modelId)) {
    return true
  }

  const MAX_REGEX = /^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/i
  const PLUS_REGEX = /^qwen(?:3\.[5-9])?-plus(?:-|$)/i
  const FLASH_REGEX = /^qwen(?:3\.[5-9])?-flash(?:-|$)/i
  const TURBO_REGEX = /^qwen(?:3\.[5-9])?-turbo(?:-|$)/i
  const QWEN3_OPEN_REGEX = /^qwen3-\d/i

  return (
    MAX_REGEX.test(modelId) ||
    PLUS_REGEX.test(modelId) ||
    FLASH_REGEX.test(modelId) ||
    TURBO_REGEX.test(modelId) ||
    QWEN3_OPEN_REGEX.test(modelId)
  )
}

const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-(?:thinking)(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i

function isSupportedThinkingTokenDoubaoModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  return DOUBAO_THINKING_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_MODEL_REGEX.test(model.name)
}

export function isClaude45ReasoningModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  const regex = /claude-(sonnet|opus|haiku)-4(-|.)5(?:-[\w-]+)?$/i
  return regex.test(modelId)
}

export function isClaudeReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    modelId.includes('claude-3-7-sonnet') ||
    modelId.includes('claude-3.7-sonnet') ||
    modelId.includes('claude-sonnet-4') ||
    modelId.includes('claude-opus-4') ||
    modelId.includes('claude-haiku-4')
  )
}

const isSupportedThinkingTokenHunyuanModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('hunyuan-a13b')
}

const isHunyuanReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')

  return isSupportedThinkingTokenHunyuanModel(model) || modelId.includes('hunyuan-t1')
}

const isPerplexityReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    isSupportedReasoningEffortPerplexityModel(model) ||
    (modelId.includes('reasoning') && !modelId.includes('non-reasoning'))
  )
}

const isSupportedReasoningEffortPerplexityModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('sonar-deep-research')
}

const isSupportedThinkingTokenZhipuModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return /glm-?5|glm-4\.[567]/.test(modelId)
}

const isSupportedThinkingTokenMiMoModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((id) => modelId.includes(id))
}

export const isDeepSeekHybridInferenceModel = (model: Model) => {
  const { idResult, nameResult } = withModelIdAndNameAsId(model, (model) => {
    const modelId = getLowerBaseModelName(model.id)
    return (
      /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(modelId) ||
      modelId.includes('deepseek-chat-v3.1') ||
      modelId.includes('deepseek-chat')
    )
  })
  return idResult || nameResult
}

const isLingReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return ['ring-1t', 'ring-mini', 'ring-flash'].some((id) => modelId.includes(id))
}

const isZhipuReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedThinkingTokenZhipuModel(model) || modelId.includes('glm-z1')
}

const isMiMoReasoningModel = isSupportedThinkingTokenMiMoModel

const isStepReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('step-3') || modelId.includes('step-r1-v-mini')
}

const isMiniMaxReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return (['minimax-m1', 'minimax-m2', 'minimax-m2.1'] as const).some((id) => modelId.includes(id))
}

const isBaichuanReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId === 'baichuan-m2' || modelId === 'baichuan-m3'
}

const _isKimiReasoningModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return /^kimi-k2-thinking(?:-turbo)?$|^kimi-k2\.5(?:-\w)*$/.test(modelId)
}

function isKimiReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _isKimiReasoningModel)
  return idResult || nameResult
}

export function isReasoningModel(model?: Model): boolean {
  return resolveModelCapabilities(model).reasoning
}

// Called only by the resolver, with the display name replaced by the real ID.
export function hasLegacyReasoningCapability(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)

  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return (
      REASONING_REGEX.test(modelId) ||
      REASONING_REGEX.test(model.name) ||
      isSupportedThinkingTokenDoubaoModel(model) ||
      isDeepSeekHybridInferenceModel(model) ||
      false
    )
  }

  if (
    isClaudeReasoningModel(model) ||
    isOpenAIReasoningModel(model) ||
    isGeminiReasoningModel(model) ||
    isQwenReasoningModel(model) ||
    isGrokReasoningModel(model) ||
    isHunyuanReasoningModel(model) ||
    isPerplexityReasoningModel(model) ||
    isZhipuReasoningModel(model) ||
    isStepReasoningModel(model) ||
    isDeepSeekHybridInferenceModel(model) ||
    isLingReasoningModel(model) ||
    isMiniMaxReasoningModel(model) ||
    isMiMoReasoningModel(model) ||
    isBaichuanReasoningModel(model) ||
    isKimiReasoningModel(model) ||
    modelId.includes('magistral') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss') ||
    modelId.includes('deepseek-v3.2-speciale') ||
    modelId.includes('gemma-4') ||
    modelId.includes('gemma4')
  ) {
    return true
  }

  return REASONING_REGEX.test(modelId) || false
}

const THINKING_TOKEN_MAP: Record<string, { min: number; max: number }> = {
  // Gemini models
  'gemini-2\\.5-flash-lite.*$': { min: 512, max: 24576 },
  'gemini-.*-flash.*$': { min: 0, max: 24576 },
  'gemini-.*-pro.*$': { min: 128, max: 32768 },

  // Qwen models
  // qwen-plus-x 系列自 qwen-plus-2025-07-28 后模型最长思维链变为 81_920, qwen-plus 模型于 2025.9.16 同步变更
  'qwen3-235b-a22b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-30b-a3b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-vl-235b-a22b-thinking$': { min: 0, max: 81_920 },
  'qwen3-vl-30b-a3b-thinking$': { min: 0, max: 81_920 },
  'qwen-plus-2025-07-14$': { min: 0, max: 38_912 },
  'qwen-plus-2025-04-28$': { min: 0, max: 38_912 },
  'qwen3-1\\.7b$': { min: 0, max: 30_720 },
  'qwen3-0\\.6b$': { min: 0, max: 30_720 },
  'qwen-plus.*$': { min: 0, max: 81_920 },
  'qwen-turbo.*$': { min: 0, max: 38_912 },
  'qwen-flash.*$': { min: 0, max: 81_920 },
  // qwen3-max series (reasoning models, equivalent to qwen-plus for thinking budget)
  'qwen3-max(-.*)?$': { min: 0, max: 81_920 },
  // Qwen3.5+ series (max thinking budget: 81920)
  '^qwen3\\.[5-9]': { min: 0, max: 81_920 },
  'qwen3-(?!max).*$': { min: 1024, max: 38_912 },

  // Claude models (supports AWS Bedrock 'anthropic.' prefix, GCP Vertex AI '@' separator, and '-v1:0' suffix)
  // Opus 4.6 supports 128K output tokens
  '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$': { min: 1024, max: 128_000 },
  // Sonnet 4.6, and Haiku is assumed to be also 64k
  '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  // 4.5 series
  '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  // Opus 4.1
  '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 32_000 },
  // 4.0 series
  '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$': {
    min: 1024,
    max: 64_000
  },
  '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$': {
    min: 1024,
    max: 32_000
  },
  // 3.7
  '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },

  // Baichuan models
  'baichuan-m2$': { min: 0, max: 30_000 },
  'baichuan-m3$': { min: 0, max: 30_000 },

  // Gemma 4 models (GenAI: gemma-4-*, Ollama: gemma4:*)
  'gemma-?4[:-]?e[24]b': { min: 1024, max: 8192 },
  'gemma-?4[:-]?26b': { min: 1024, max: 30720 },
  'gemma-?4[:-]?31b': { min: 1024, max: 30720 }
}

export const findTokenLimit = (modelId: string): { min: number; max: number } | undefined => {
  for (const [pattern, limits] of Object.entries(THINKING_TOKEN_MAP)) {
    if (new RegExp(pattern, 'i').test(modelId)) {
      return limits
    }
  }
  return undefined
}
