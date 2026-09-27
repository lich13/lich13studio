import type { Model } from '@renderer/types'

import { AnswerCollector } from './AnswerCollector'
import { generateChallenges } from './challenge'
import bank from './data/unified_bank.json'
import { prepareDirectModelTest } from './directModelTest'
import { analyzeGlobalOutputs } from './fingerprintCore'
import { type ModelTestLimit, ModelTestOutputGuard, ModelTestOutputLimitError } from './OutputGuard'
import { type OutputIssue, validateModelTraceOutput } from './outputValidation'

export interface ModelTestChallenge {
  id: string
  expected_count: number
  prompt: string
}

export type ModelTestStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'error' | 'aborted'

export interface ModelTestOutput {
  id: string
  expected_count: number
  text: string
  status?: ModelTestStatus
  attempts?: number
  parsedCount?: number
  usableCount?: number
  excludedCount?: number
  issue?: OutputIssue
  error?: string
  failureCode?: 'output-limit' | 'request-error'
  limit?: ModelTestLimit
}

export interface ModelTestTarget {
  providerId: string
  providerName: string
  modelId: string
}

export interface ModelTestProgress {
  index: number
  total: number
  challenge: ModelTestChallenge
  output: ModelTestOutput
  target: ModelTestTarget
}

export interface ModelTraceReport {
  prediction: string
  prediction_name: string
  probability: number
  used_outputs: number
  results: Array<Record<string, unknown>>
  diagnostics: Array<Record<string, unknown>>
  family_prediction: string
  family_prediction_name: string
  family_probability: number
  family_probabilities: Array<Record<string, unknown>>
  method: string
  calibration: Record<string, unknown>
}

export interface ModelTestRunResult {
  challenges: ModelTestChallenge[]
  outputs: ModelTestOutput[]
  target: ModelTestTarget
  report?: ModelTraceReport
  error?: string
}

export interface ModelTestRunnerConfig {
  model: Model
  challenges: ModelTestChallenge[]
  onProgress?: (progress: ModelTestProgress) => void
}

export const MODELTRACE_BANK_VERSION = String((bank as { built_at?: string }).built_at || 'bundled')
export const MODELTRACE_MAX_ATTEMPTS = 3
const RETRY_DELAYS = [1000, 3000]

export const createModelTraceChallenges = (): ModelTestChallenge[] => generateChallenges(3) as ModelTestChallenge[]

export const analyzeModelTraceOutputs = (outputs: ModelTestOutput[]): ModelTraceReport | undefined =>
  analyzeGlobalOutputs(outputs, bank) as ModelTraceReport | undefined

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '模型测试请求失败'

/** Recognize temporary failures without retrying auth, missing models or invalid parameters. */
export function isRetryableModelTestError(error: unknown): boolean {
  if (error instanceof ModelTestOutputLimitError) return true
  let current = error
  const seen = new Set<unknown>()
  const messages = [errorMessage(error)]
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    messages.push(errorMessage(current))
    const value = current as { name?: string; statusCode?: number; status?: number; cause?: unknown }
    if (value.name === 'AbortError') return false
    const status = value.statusCode ?? value.status
    if (status !== undefined) return status === 408 || status === 429 || status >= 500
    current = value.cause
  }
  return /network|fetch failed|failed to fetch|load failed|connection|socket|ECONN|EPIPE|decoding response body|terminated|premature|incomplete stream|without a provider terminal event|terminal event/i.test(
    messages.join(' ')
  )
}

const waitForRetry = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })

/** One in-memory session; each attempt owns its collector and cancellation boundary. */
export class ModelTestRunner {
  private controller?: AbortController
  private generation = 0
  private model: Model
  private challenges: ModelTestChallenge[]
  private outputs: ModelTestOutput[]
  private prepared?: Awaited<ReturnType<typeof prepareDirectModelTest>>
  private target: ModelTestTarget

  constructor(private readonly config: ModelTestRunnerConfig) {
    if (config.challenges.length !== 3) throw new Error('模型测试需要三组挑战')
    this.model = structuredClone(config.model)
    this.challenges = structuredClone(config.challenges)
    this.outputs = this.challenges.map(({ id, expected_count }) => ({
      id,
      expected_count,
      text: '',
      status: 'pending',
      attempts: 0
    }))
    this.target = { providerId: this.model.provider, providerName: '', modelId: this.model.id }
  }

  private update(index: number, changes: Partial<ModelTestOutput>) {
    this.outputs[index] = { ...this.outputs[index], ...changes }
    this.config.onProgress?.({
      index,
      total: this.challenges.length,
      challenge: { ...this.challenges[index] },
      output: { ...this.outputs[index] },
      target: { ...this.target }
    })
  }

  async run({ retryFailedOnly = false }: { retryFailedOnly?: boolean } = {}): Promise<ModelTestRunResult> {
    this.cancel()
    const generation = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    const { signal } = controller
    const current = () => generation === this.generation && !signal.aborted
    let fatalError: string | undefined
    try {
      this.prepared ??= await prepareDirectModelTest(this.model)
      signal.throwIfAborted()
      this.target = { ...this.prepared.target }
      for (let index = 0; index < this.challenges.length; index += 1) {
        const challenge = this.challenges[index]
        if (retryFailedOnly && this.outputs[index].status === 'completed') continue
        for (let attempt = 1; attempt <= MODELTRACE_MAX_ATTEMPTS; attempt += 1) {
          signal.throwIfAborted()
          const collector = new AnswerCollector()
          const guard = new ModelTestOutputGuard(challenge.expected_count)
          let limitError: ModelTestOutputLimitError | undefined
          const attemptController = new AbortController()
          const abortAttempt = () => attemptController.abort(signal.reason)
          signal.addEventListener('abort', abortAttempt, { once: true })
          let accepting = true
          this.update(index, {
            text: '',
            status: 'running',
            attempts: attempt,
            parsedCount: 0,
            usableCount: 0,
            excludedCount: 0,
            issue: undefined,
            failureCode: undefined,
            limit: undefined,
            error: undefined
          })
          let retryable = true
          try {
            await this.prepared.execute(challenge.prompt, attemptController.signal, (chunk) => {
              if (!accepting || !current()) return
              collector.accept(chunk)
              limitError = guard.accept(chunk, collector.rawText)
              if (limitError) {
                accepting = false
                attemptController.abort(limitError)
              }
              const validation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
              this.update(index, {
                text: collector.preview,
                parsedCount: validation.parsedCount,
                usableCount: validation.usableCount,
                excludedCount: validation.excludedCount
              })
            })
            signal.throwIfAborted()
            if (limitError) throw limitError
            if (collector.error) throw collector.error
            if (!collector.completed)
              throw new Error('Incomplete stream: response ended without a provider terminal event')
            const validation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
            this.update(index, {
              text: validation.text,
              status: 'completed',
              parsedCount: validation.parsedCount,
              usableCount: validation.usableCount,
              excludedCount: validation.excludedCount,
              issue: validation.issue
            })
            break
          } catch (error) {
            if (!current()) throw signal.reason ?? error
            const failure = limitError ?? collector.error ?? error
            retryable = isRetryableModelTestError(failure)
            this.update(index, {
              status: 'error',
              error: errorMessage(failure),
              failureCode: limitError ? 'output-limit' : 'request-error',
              limit: limitError?.limit
            })
            if (!retryable) fatalError = errorMessage(failure)
          } finally {
            accepting = false
            signal.removeEventListener('abort', abortAttempt)
          }
          if (!retryable || attempt === MODELTRACE_MAX_ATTEMPTS) break
          this.update(index, { status: 'retrying' })
          await waitForRetry(RETRY_DELAYS[attempt - 1], signal)
        }
        if (fatalError) break
      }
      signal.throwIfAborted()
      const outputs = structuredClone(this.outputs)
      return {
        target: { ...this.target },
        challenges: structuredClone(this.challenges),
        outputs,
        error: fatalError,
        report: this.analyze(outputs)
      }
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  cancel(): void {
    if (!this.controller) return
    this.controller.abort(new DOMException('Model test aborted', 'AbortError'))
    this.controller = undefined
    this.generation += 1
    this.outputs.forEach((output, index) => {
      if (output.status === 'running' || output.status === 'retrying') this.update(index, { status: 'aborted' })
    })
  }

  analyze(outputs: ModelTestOutput[]): ModelTraceReport | undefined {
    return analyzeModelTraceOutputs(outputs)
  }
}
