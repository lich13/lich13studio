import { ModelTestOutputLimitError } from './OutputGuard'

export type ModelTestFailureCategory =
  | 'output-limit'
  | 'transient'
  | 'unknown'
  | 'auth'
  | 'quota'
  | 'model'
  | 'invalid-request'
export type ModelTestRetryStopReason = 'exhausted' | 'cancelled' | 'auth' | 'quota' | 'model' | 'invalid-request'

export interface ModelTestFailure {
  message: string
  category: ModelTestFailureCategory
  retryable: boolean
}

/** Read only error fields, never request headers, credentials or request bodies. */
export function classifyModelTestFailure(error: unknown): ModelTestFailure {
  if (error instanceof ModelTestOutputLimitError)
    return { message: error.message, category: 'output-limit', retryable: true }

  const queue: unknown[] = [error]
  const seen = new Set<unknown>()
  const messages: string[] = []
  const codes: string[] = []
  const statuses: number[] = []
  let interrupted = false
  while (queue.length && seen.size < 32) {
    const current = queue.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'string') {
      if (current.trim()) messages.push(current)
      continue
    }
    if (typeof current !== 'object') continue
    const value = current as Record<string, unknown>
    for (const key of ['message', 'detail', 'error_description']) {
      if (typeof value[key] === 'string' && value[key].trim()) messages.push(value[key])
    }
    for (const key of ['code', 'type']) {
      if (typeof value[key] === 'string') codes.push(value[key])
    }
    for (const key of ['statusCode', 'status']) {
      const status = Number(value[key])
      if (Number.isInteger(status) && status >= 400 && status <= 599) statuses.push(status)
    }
    interrupted ||= value.name === 'AbortError'
    queue.push(value.cause, value.error, value.lastError)
    if (Array.isArray(value.errors)) queue.push(...value.errors.slice(0, 8))
    if (typeof value.responseBody === 'string' && value.responseBody.length <= 65536) {
      try {
        const body = JSON.parse(value.responseBody)
        if (body && typeof body === 'object') queue.push(body.error ?? body)
      } catch {
        // Unstructured bodies may contain HTML or unrelated content; do not display them.
      }
    }
  }

  const details = [...codes, ...messages].join(' ')
  const message = messages.join(' · ') || 'Model test request failed'
  const failure = (category: ModelTestFailureCategory, retryable: boolean): ModelTestFailure => ({
    message: [...new Set(messages)].join(' · ') || message,
    category,
    retryable
  })
  if (
    statuses.some((status) => status === 401 || status === 403) ||
    /unauthori[sz]ed|authentication[_ -](?:error|failed)|invalid[_ -]api[_ -]?key|permission[_ -]denied|鉴权失败|无效.*密钥/i.test(
      details
    )
  )
    return failure('auth', false)
  if (
    statuses.includes(402) ||
    /insufficient[_ -](?:quota|funds|credits|balance)|billing[_ -](?:hard[_ -])?limit|(?:quota|credits)[_ -]exhausted|余额不足|额度不足|配额.*用尽/i.test(
      details
    )
  )
    return failure('quota', false)
  if (
    /model[_ -](?:not[_ -]found|not[_ -]exist)|(?:invalid|unknown)[_ -]model|model[^.\n]*(?:does not exist|not found)|模型不存在/i.test(
      details
    )
  )
    return failure('model', false)
  if (
    /invalid[_ -](?:request|parameter|argument)|unsupported[_ -](?:parameter|value)|参数(?:错误|无效|不支持)/i.test(
      details
    )
  )
    return failure('invalid-request', false)
  if (statuses.some((status) => status === 408 || status === 429 || status >= 500)) return failure('transient', true)
  if (statuses.some((status) => status >= 400 && status < 500)) return failure('invalid-request', false)
  // AbortError also occurs when an upstream connection is interrupted. Only
  // the session's own signal can identify a user cancellation.
  if (
    interrupted ||
    /network|fetch|connection|socket|ECONN|EPIPE|decoding response body|terminated|incomplete|terminal event/i.test(
      details
    )
  )
    return failure('transient', true)
  return failure('unknown', true)
}
