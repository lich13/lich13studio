import type { NotUndefined } from '@types'
import type { generateText, ModelMessage, streamText } from 'ai'
import * as z from 'zod'

/**
 * 渲染器侧参数类型（不包含 model 和 messages，因为它们会单独处理）
 * 注意：这与 @cherrystudio/ai-core 导出的完整参数类型不同
 * - @cherrystudio/ai-core 的 StreamTextParams: 完整的 AI SDK 参数（用于插件系统）
 * - 此处的 StreamTextParams: 去除 model/messages 的参数（用于渲染器参数构建）
 */
export type StreamTextParams = Omit<Parameters<typeof streamText>[0], 'model' | 'messages'> &
  (
    | {
        prompt: string | Array<ModelMessage>
        messages?: never
      }
    | {
        messages: Array<ModelMessage>
        prompt?: never
      }
  )

/**
 * 渲染器侧参数类型（不包含 model 和 messages）
 * 注意：这与 @cherrystudio/ai-core 导出的完整参数类型不同
 */
export type GenerateTextParams = Omit<Parameters<typeof generateText>[0], 'model' | 'messages'> &
  (
    | {
        prompt: string | Array<ModelMessage>
        messages?: never
      }
    | {
        messages: Array<ModelMessage>
        prompt?: never
      }
  )

export type OpenAIVerbosity = 'low' | 'medium' | 'high' | null | undefined
export type ValidOpenAIVerbosity = NotUndefined<OpenAIVerbosity>

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto' | 'max'

export type OpenAIReasoningSummary = 'auto' | 'concise' | 'detailed' | null | undefined

export type OpenAICompletionsStreamOptions = {
  include_usage?: boolean
  include_obfuscation?: boolean
}

const AiSdkParamsSchema = z.enum([
  'maxOutputTokens',
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'seed'
])

export type AiSdkParam = z.infer<typeof AiSdkParamsSchema>

export const isAiSdkParam = (param: string): param is AiSdkParam => {
  return AiSdkParamsSchema.safeParse(param).success
}
