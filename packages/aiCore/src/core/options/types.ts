import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { type SharedV3ProviderMetadata } from '@ai-sdk/provider'

type ProviderOptionsMap = {
  openai: OpenAIResponsesProviderOptions
  anthropic: AnthropicProviderOptions
}

export type TypedProviderOptions = {
  [K in keyof ProviderOptionsMap]?: ProviderOptionsMap[K]
} & {
  [K in string]?: Record<string, any>
} & SharedV3ProviderMetadata
