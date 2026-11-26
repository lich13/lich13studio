import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('skipGeminiThoughtSignaturePlugin')

export function createSkipGeminiThoughtSignatureMiddleware(): LanguageModelMiddleware {
  const MAGIC_STRING = 'skip_thought_signature_validator'
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      logger.debug('transformedParams', transformedParams)
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          if (typeof message.content !== 'string') {
            for (const part of message.content) {
              if (part.type === 'tool-call') {
                if (!part.providerOptions) {
                  part.providerOptions = {}
                }
                if (!part.providerOptions.openaiCompatible) {
                  part.providerOptions.openaiCompatible = {}
                }
                part.providerOptions.openaiCompatible.extra_content = {
                  google: {
                    thought_signature: MAGIC_STRING
                  }
                }
              }
            }
          }
          return message
        })
      }
      return transformedParams
    }
  }
}
