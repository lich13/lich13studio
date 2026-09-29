import type { Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { anthropicEffort, normalizeReasoningEffort, REASONING_EFFORTS, type ReasoningEffort } from '@shared/reasoning'

export const REASONING_CACHE_TTL = 60 * 60 * 1000
const cache = new Map<string, { credential: string; effort: ReasoningEffort; expires: number }>()
export const clearReasoningCapabilityCache = () => cache.clear()
const rank = (value: ReasoningEffort) => REASONING_EFFORTS.indexOf(value)

/** Only explicit effort rejections can change a request. HTTP/auth/network errors cannot. */
export function effortRejection(error: unknown): { supported?: ReasoningEffort[] } | undefined {
  const values: string[] = []
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const entry = current as Record<string, any>
    const status = entry.statusCode ?? entry.status
    if (typeof status === 'number' && status !== 400 && status !== 422) return undefined
    if (entry.name === 'AbortError') return undefined
    for (const field of ['message', 'param', 'code', 'responseBody'])
      if (typeof entry[field] === 'string') values.push(entry[field])
    if (entry.error && typeof entry.error === 'object') values.push(JSON.stringify(entry.error))
    current = entry.cause
  }
  if (typeof error === 'string') values.push(error)
  const text = values.join(' ')
  if (
    !/(?:reasoning[._\s]+effort|output_config[._\s]+effort|["']effort["']|(?:thinking|reasoning) (?:effort|level))/i.test(
      text
    ) ||
    !/unsupported|not supported|invalid|must be|allowed|supported.{0,20}values/i.test(text)
  )
    return undefined
  const list =
    /(?:\b(?:supported|allowed|valid)[_\s]+(?:values|levels|efforts)|\bone of)(?:\s+(?:are|include))?["']?\s*[:=]?\s*(\[[^\]]*\]|[^.\n}]+)/i.exec(
      text
    )
  if (!list) return {}
  const supported = [...list[1].matchAll(/\b(low|medium|high|xhigh|max)\b/gi)].map(
    (match) => match[1].toLowerCase() as ReasoningEffort
  )
  return supported.length ? { supported: [...new Set(supported)] } : {}
}

const contentTypes = new Set([
  ChunkType.TEXT_DELTA,
  ChunkType.TEXT_COMPLETE,
  ChunkType.THINKING_DELTA,
  ChunkType.THINKING_COMPLETE,
  ChunkType.TOOL_CREATED,
  ChunkType.TOOL_PENDING,
  ChunkType.TOOL_IN_PROGRESS,
  ChunkType.TOOL_STREAMING,
  ChunkType.TOOL_COMPLETE,
  ChunkType.EXTERNEL_TOOL_COMPLETE,
  ChunkType.IMAGE_COMPLETE,
  ChunkType.AUDIO_DELTA
])
export function chunkHasContent(chunk: Chunk): boolean {
  return contentTypes.has(chunk.type) && (!('text' in chunk) || Boolean(chunk.text))
}

/** Runs before error chunks reach consumers, so rejected attempts cannot finalize a chat. */
export async function withReasoningFallback<T>({
  provider,
  modelId,
  params,
  requested,
  disabled,
  execute,
  onChunk,
  onEffective
}: {
  provider: Provider
  modelId: string
  params: StreamTextParams
  requested: ReasoningEffort
  disabled: boolean
  execute: (params: StreamTextParams, onChunk: (chunk: Chunk) => void) => Promise<T>
  onChunk?: (chunk: Chunk) => void
  onEffective?: (effort: ReasoningEffort) => void
}): Promise<T> {
  const namespace = provider.type === 'anthropic' ? 'anthropic' : 'openai'
  const field = namespace === 'anthropic' ? 'effort' : 'reasoningEffort'
  const options = params.providerOptions?.[namespace]
  const original = options?.[field]
  if (disabled || !REASONING_EFFORTS.includes(original as ReasoningEffort))
    return execute({ ...params, maxRetries: 0 }, onChunk ?? (() => {}))

  const route = JSON.stringify([provider.id, provider.type, provider.apiHost, modelId])
  // A one-way digest invalidates cached capabilities after key/header changes.
  const bytes = new TextEncoder().encode(JSON.stringify([provider.apiKey, provider.extra_headers]))
  const credential = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  const cached = cache.get(route)
  let effort = normalizeReasoningEffort(original)
  if (cached && cached.expires > Date.now() && cached.credential === credential && rank(cached.effort) < rank(effort))
    effort = cached.effort
  else if (cached && (cached.expires <= Date.now() || cached.credential !== credential)) cache.delete(route)
  const tried = new Set<ReasoningEffort>()
  const mappedEfforts = new Map(
    REASONING_EFFORTS.map((candidate) => [
      candidate,
      namespace === 'anthropic' ? anthropicEffort(modelId, candidate) : candidate
    ])
  )

  while (!tried.has(effort)) {
    params.abortSignal?.throwIfAborted()
    tried.add(effort)
    let emittedContent = false
    let pendingError: unknown
    let announced = false
    const announce = () => {
      if (!announced) {
        onEffective?.(effort)
        announced = true
      }
    }
    const accept = (chunk: Chunk) => {
      if (chunk.type === ChunkType.ERROR) {
        pendingError = chunk.error
        return
      }
      if (pendingError && (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE || chunk.type === ChunkType.BLOCK_COMPLETE))
        return
      if (chunkHasContent(chunk)) {
        emittedContent = true
        announce()
      }
      return onChunk?.(chunk)
    }
    try {
      const result = await execute(
        {
          ...params,
          maxRetries: 0,
          providerOptions: { ...params.providerOptions, [namespace]: { ...options, [field]: effort } }
        },
        accept
      )
      if (pendingError) throw pendingError
      params.abortSignal?.throwIfAborted()
      announce()
      if (tried.size > 1 && requested === 'max')
        cache.set(route, { credential, effort, expires: Date.now() + REASONING_CACHE_TTL })
      return result
    } catch (error) {
      const failure = pendingError ?? error
      const rejection = !emittedContent && !params.abortSignal?.aborted ? effortRejection(failure) : undefined
      const next =
        rejection &&
        [...(rejection.supported ?? REASONING_EFFORTS)]
          .reverse()
          .map((candidate) => mappedEfforts.get(candidate)!)
          .filter((candidate) => rank(candidate) <= rank(requested) && !tried.has(candidate))
          .sort((a, b) => rank(b) - rank(a))[0]
      if (!next) {
        await onChunk?.({ type: ChunkType.ERROR, error: failure as Error })
        throw failure
      }
      effort = next
    }
  }
  throw new Error('Reasoning effort negotiation exhausted')
}
