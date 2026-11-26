import { isClaude45ReasoningModel } from '@renderer/config/models'
import type { Assistant, Model } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'

// https://docs.claude.com/en/docs/build-with-claude/extended-thinking#interleaved-thinking
const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'

export function addAnthropicHeaders(assistant: Assistant, model: Model): string[] {
  const anthropicHeaders: string[] = []
  if (isClaude45ReasoningModel(model) && isToolUseModeFunction(assistant)) {
    anthropicHeaders.push(INTERLEAVED_THINKING_HEADER)
  }
  return anthropicHeaders
}
