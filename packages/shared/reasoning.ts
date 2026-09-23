export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'max'

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort) ? (value as ReasoningEffort) : DEFAULT_REASONING_EFFORT
}

export const EFFORT_RATIOS: Record<ReasoningEffort, number> = {
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.9,
  max: 1
}

export function anthropicThinkingMode(modelId: string): 'five' | 'four' | 'three' | 'budget' {
  const id = modelId.toLowerCase().replaceAll('.', '-')
  if (
    /claude[-/](?:fable|mythos)[-/]/.test(id) ||
    /claude[-/](?:opus|sonnet)-[5-9]/.test(id) ||
    /claude[-/]opus-4-[7-9]/.test(id)
  )
    return 'five'
  if (/claude[-/](?:opus|sonnet)-4-6/.test(id)) return 'four'
  if (/claude[-/]opus-4-5/.test(id)) return 'three'
  return 'budget'
}

export function anthropicEffort(modelId: string, effort: ReasoningEffort): ReasoningEffort {
  const mode = anthropicThinkingMode(modelId)
  if (mode === 'four' && effort === 'xhigh') return 'high'
  if (mode === 'three' && (effort === 'xhigh' || effort === 'max')) return 'high'
  return effort
}

export function thinkingBudget(effort: ReasoningEffort, maxTokens = 4096, limit = 16384, minimum = 1024): number {
  if (maxTokens <= 1024) throw new Error('Thinking requires max_tokens greater than 1024')
  return Math.min(maxTokens - 1, Math.max(1024, Math.floor((limit - minimum) * EFFORT_RATIOS[effort] + minimum)))
}
