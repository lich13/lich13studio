import type { Model } from '@renderer/types'

import { AnswerCollector } from './AnswerCollector'
import { generateChallenges } from './challenge'
import bank from './data/unified_bank.json'
import { prepareDirectModelTest } from './directModelTest'
import { analyzeGlobalOutputs } from './fingerprintCore'
import { type OutputIssue, validateModelTraceOutput } from './outputValidation'

export interface ModelTestChallenge {
  id: string
  expected_count: number
  prompt: string
}

export type ModelTestStatus = 'pending' | 'running' | 'retrying' | 'valid' | 'invalid' | 'error' | 'aborted'

export interface ModelTestOutput {
  id: string
  expected_count: number
  text: string
  status?: ModelTestStatus
  attempts?: number
  parsedCount?: number
  issue?: OutputIssue
  error?: string
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

export const analyzeModelTraceOutputs = (outputs: ModelTestOutput[]): ModelTraceReport =>
  analyzeGlobalOutputs(outputs, bank) as ModelTraceReport

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '模型测试请求失败'

/** Recognize temporary failures without retrying auth, missing models or invalid parameters. */
export function isRetryableModelTestError(error: unknown): boolean {
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
  return /network|fetch failed|failed to fetch|load failed|connection|socket|ECONN|EPIPE|decoding response body|terminated|premature|incomplete stream/i.test(
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
        if (retryFailedOnly && this.outputs[index].status === 'valid') continue
        for (let attempt = 1; attempt <= MODELTRACE_MAX_ATTEMPTS; attempt += 1) {
          signal.throwIfAborted()
          const collector = new AnswerCollector()
          const attemptController = new AbortController()
          const abortAttempt = () => attemptController.abort(signal.reason)
          signal.addEventListener('abort', abortAttempt, { once: true })
          let accepting = true
          let overlong = false
          this.update(index, {
            text: '',
            status: 'running',
            attempts: attempt,
            parsedCount: 0,
            issue: undefined,
            error: undefined
          })
          let retryable = true
          try {
            await this.prepared.execute(challenge.prompt, attemptController.signal, (chunk) => {
              if (!accepting || !current()) return
              collector.accept(chunk)
              const liveValidation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
              this.update(index, {
                text: collector.preview,
                parsedCount: liveValidation.parsedCount
              })
              if (liveValidation.parsedCount > challenge.expected_count && !collector.completed) {
                overlong = true
                attemptController.abort(new DOMException('Model test answer exceeded target count', 'AbortError'))
              }
            })
            signal.throwIfAborted()
            if (overlong) {
              const validation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
              this.update(index, {
                text: validation.text,
                status: 'invalid',
                parsedCount: validation.parsedCount,
                issue: 'count'
              })
            } else {
              if (collector.error) throw collector.error
              const validation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
              const accepted = collector.completed && validation.accepted
              this.update(index, {
                text: validation.text,
                status: accepted ? 'valid' : 'invalid',
                parsedCount: validation.parsedCount,
                issue: collector.completed ? validation.issue : 'incomplete'
              })
              if (accepted) break
            }
          } catch (error) {
            if (!current()) throw signal.reason ?? error
            if (overlong) {
              const validation = validateModelTraceOutput(collector.rawText, challenge.expected_count)
              this.update(index, {
                text: validation.text,
                status: 'invalid',
                parsedCount: validation.parsedCount,
                issue: 'count'
              })
            } else {
              retryable = isRetryableModelTestError(error)
              this.update(index, { status: 'error', error: errorMessage(error) })
              if (!retryable) fatalError = errorMessage(error)
            }
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
        report: outputs.every((output) => output.status === 'valid') ? this.analyze(outputs) : undefined
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

  analyze(outputs: ModelTestOutput[]): ModelTraceReport {
    return analyzeModelTraceOutputs(outputs)
  }
}
