import { extractReasoningMiddleware, type LanguageModelMiddleware } from 'ai'

export const createReasoningExtractionMiddleware = (options: { tagName?: string } = {}): LanguageModelMiddleware =>
  extractReasoningMiddleware({
    tagName: options.tagName || 'thinking'
  })
