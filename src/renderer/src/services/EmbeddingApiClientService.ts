import { AiProvider } from '@renderer/aiCore'
import type { ApiClient, Model } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { routeToEndpoint } from '@renderer/utils'
import { isAzureOpenAIProvider, isGeminiProvider } from '@renderer/utils/provider'

export const getEmbeddingApiClient = (model: Model | null | undefined): ApiClient => {
  if (!model) {
    throw new Error('Embedding model is required')
  }

  const aiProvider = new AiProvider(model)
  const actualProvider = aiProvider.getActualProvider()
  let { baseURL } = routeToEndpoint(actualProvider.apiHost)

  if (isGeminiProvider(actualProvider)) {
    baseURL += '/openai'
  } else if (isAzureOpenAIProvider(actualProvider)) {
    baseURL += '/v1'
  } else if (actualProvider.id === SystemProviderIds.ollama) {
    baseURL = baseURL.replace(/\/api$/, '')
  }

  return {
    model: model.id,
    provider: model.provider,
    apiKey: aiProvider.getApiKey() || 'secret',
    baseURL
  }
}
