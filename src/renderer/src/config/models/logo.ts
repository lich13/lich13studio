import OpenAIDark from '@renderer/assets/images/models/cherry/openai-dark.svg'
import OpenAILight from '@renderer/assets/images/models/cherry/openai-light.svg'
import ClaudeModelLogo from '@renderer/assets/images/models/claude.png'
import ClaudeModelLogoDark from '@renderer/assets/images/models/claude_dark.png'
import GrokModelLogo from '@renderer/assets/images/models/grok.png'
import GrokModelLogoDark from '@renderer/assets/images/models/grok_dark.png'
import type { Model } from '@renderer/types'

const OPENAI_MODEL_REGEX =
  /(^|[/:])(?:gpt(?:[-.\d]|s$)|codex(?:[-/:]|$)|o[134](?:[-.\d]|$)|chatgpt|dall-?e|sora[-_]|omni-|text-(?:embedding|moderation)|davinci-|babbage-|tts-1|whisper-)/
const ANTHROPIC_MODEL_REGEX = /(?:^|[/:.-])(?:claude(?:[-.\d/:]|$)|anthropic-)/
const GROK_MODEL_REGEX = /(?:^|[/:.-])grok(?:[-.\d/:]|$)/

export function normalizeModelLogoKey(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/_/g, '-')
}

export function getModelLogoById(modelId: string, theme: 'light' | 'dark' | 'system' = 'light'): string | undefined {
  if (!modelId) {
    return undefined
  }

  const isLight = theme !== 'dark'
  const normalizedModelId = normalizeModelLogoKey(modelId)

  if (OPENAI_MODEL_REGEX.test(normalizedModelId)) {
    return isLight ? OpenAILight : OpenAIDark
  }

  if (ANTHROPIC_MODEL_REGEX.test(normalizedModelId)) {
    return isLight ? ClaudeModelLogo : ClaudeModelLogoDark
  }

  if (GROK_MODEL_REGEX.test(normalizedModelId)) {
    return isLight ? GrokModelLogo : GrokModelLogoDark
  }

  return undefined
}

export function getModelLogo(
  model: Model | undefined | null,
  theme: 'light' | 'dark' | 'system' = 'light'
): string | undefined {
  return model ? (getModelLogoById(model.id, theme) ?? getModelLogoById(model.name, theme)) : undefined
}
