import type { Provider, VertexProvider } from '@types'

export function isAnthropicProvider(provider: Provider): boolean {
  return provider.type === 'anthropic'
}

export function isOllamaProvider(_provider: Provider): boolean {
  void _provider
  return false
}

export function isGeminiProvider(_provider: Provider): boolean {
  void _provider
  return false
}

export function isAzureOpenAIProvider(_provider: Provider): boolean {
  void _provider
  return false
}

// FIXME: #13194
export function isVertexProvider(_provider: Provider): _provider is VertexProvider {
  void _provider
  return false
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity'
}

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai'
}
