import type { ModelMessage } from 'ai'

export type TextBlockParam = {
  type: 'text'
  text: string
}

const defaultClaudeCodeSystemPrompt = `You are Claude Code, Anthropic's official CLI for Claude.`

const defaultClaudeCodeSystem: Array<TextBlockParam> = [
  {
    type: 'text',
    text: defaultClaudeCodeSystemPrompt
  }
]

export function buildClaudeCodeSystemMessage(system?: string | Array<TextBlockParam>): Array<TextBlockParam> {
  if (!system) {
    return defaultClaudeCodeSystem
  }

  if (typeof system === 'string') {
    if (system.trim() === defaultClaudeCodeSystemPrompt || system.trim() === '') {
      return defaultClaudeCodeSystem
    } else {
      return [...defaultClaudeCodeSystem, { type: 'text', text: system }]
    }
  }
  if (Array.isArray(system)) {
    const firstSystem = system[0]
    if (firstSystem.type === 'text' && firstSystem.text.trim() === defaultClaudeCodeSystemPrompt) {
      return system
    } else {
      return [...defaultClaudeCodeSystem, ...system]
    }
  }

  return defaultClaudeCodeSystem
}

export function buildClaudeCodeSystemModelMessage(system?: string | Array<TextBlockParam>): Array<ModelMessage> {
  const textBlocks = buildClaudeCodeSystemMessage(system)
  return textBlocks.map((block) => ({
    role: 'system',
    content: block.text
  }))
}
