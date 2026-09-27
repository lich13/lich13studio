import type { Model } from '@renderer/types'

import { resolveModelCapabilities } from './capabilities'

// Embedding models
export const EMBEDDING_REGEX = /(?:embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

// Rerank models
export const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i
export function isEmbeddingModel(model?: Model): boolean {
  return resolveModelCapabilities(model).embedding
}

export function isRerankModel(model?: Model): boolean {
  return resolveModelCapabilities(model).rerank
}
