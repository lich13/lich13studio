import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'

export type ClaudeCodeRawValue =
  | {
      type: string
      session_id: string
      slash_commands: string[]
      tools: string[]
      raw: Record<string, unknown>
    }
  | ContentBlockParam
