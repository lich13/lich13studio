import type { Model } from '@renderer/types'
import { type ModelTestConcurrency, normalizeModelTestConcurrency } from '@shared/modelTestOptions'

import { AnswerCollector } from './AnswerCollector'
import { generateChallenges } from './challenge'
import { prepareDirectModelTest } from './directModelTest'
import {
  bundledBankSnapshot,
  type FingerprintBankSnapshot,
  type FingerprintBankVersion,
  freezeBankSnapshot
} from './fingerprintBank'
import { analyzeGlobalOutputs } from './fingerprintCore'
import { type ModelTestLimit, ModelTestOutputGuard, ModelTestOutputLimitError } from './OutputGuard'
import { type OutputIssue, validateModelTraceOutput } from './outputValidation'
import {
  classifyModelTestFailure,
  type ModelTestFailureCategory,
  type ModelTestRetryStopReason
} from './requestFailure'
import { RequestSlots } from './RequestSlots'

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
  failureCategory?: ModelTestFailureCategory
  retryable?: boolean
  retryDelayMs?: number
  retryStopReason?: ModelTestRetryStopReason
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
  concurrency?: ModelTestConcurrency
  bankVersion: FingerprintBankVersion
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
  concurrency: ModelTestConcurrency
  bankVersion: FingerprintBankVersion
  challenges: ModelTestChallenge[]
  outputs: ModelTestOutput[]
  target: ModelTestTarget
  report?: ModelTraceReport
  error?: string
}

export interface ModelTestRunnerConfig {
  model: Model
  challenges: ModelTestChallenge[]
  concurrency?: ModelTestConcurrency
  bankSnapshot?: FingerprintBankSnapshot
  onProgress?: (progress: ModelTestProgress) => void
}

export const MODELTRACE_BANK_VERSION = bundledBankSnapshot.version.builtAt
export const MODELTRACE_MAX_ATTEMPTS = 3
const RETRY_DELAYS = [1000, 3000]

export const createModelTraceChallenges = (): ModelTestChallenge[] => generateChallenges(3) as ModelTestChallenge[]

export const analyzeModelTraceOutputs = (
  outputs: ModelTestOutput[],
  snapshot: FingerprintBankSnapshot = bundledBankSnapshot
): ModelTraceReport | undefined => {
  const report = analyzeGlobalOutputs(outputs, snapshot.bank)
  return report ? ({ ...report, bankVersion: snapshot.version } as ModelTraceReport) : undefined
}

/** User cancellation is checked against the session signal by the runner. */
export function isRetryableModelTestError(error: unknown): boolean {
  return classifyModelTestFailure(error).retryable
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
  readonly concurrency: ModelTestConcurrency
  readonly bankSnapshot: FingerprintBankSnapshot

  constructor(private readonly config: ModelTestRunnerConfig) {
    if (config.challenges.length !== 3) throw new Error('模型测试需要三组挑战')
    this.model = structuredClone(config.model)
    this.concurrency = normalizeModelTestConcurrency(config.concurrency)
    this.bankSnapshot = config.bankSnapshot
      ? freezeBankSnapshot(structuredClone(config.bankSnapshot))
      : bundledBankSnapshot
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
    const slots = new RequestSlots(this.concurrency)
    let fatalError: string | undefined
    try {
      this.prepared ??= await prepareDirectModelTest(this.model)
      signal.throwIfAborted()
      this.target = { ...this.prepared.target }
      const indices = this.challenges
        .map((_, index) => index)
        .filter((index) => !retryFailedOnly || this.outputs[index].status !== 'completed')
      for (const index of indices) {
        this.update(index, {
          text: '',
          status: 'pending',
          attempts: 0,
          error: undefined,
          retryDelayMs: undefined,
          retryStopReason: undefined,
          failureCode: undefined,
          failureCategory: undefined,
          retryable: undefined,
          limit: undefined,
          parsedCount: 0,
          usableCount: 0,
          excludedCount: 0,
          issue: undefined
        })
      }
      const executeGroup = async (index: number) => {
        const challenge = this.challenges[index]
        for (let attempt = 1; attempt <= MODELTRACE_MAX_ATTEMPTS; attempt += 1) {
          const release = await slots.acquire(signal)
          if (signal.aborted) {
            release()
            signal.throwIfAborted()
          }
          const collector = new AnswerCollector()
          const guard = new ModelTestOutputGuard(challenge.expected_count)
          let limitError: ModelTestOutputLimitError | undefined
          const attemptController = new AbortController()
          const abortAttempt = () => attemptController.abort(signal.reason)
          signal.addEventListener('abort', abortAttempt, { once: true })
          let accepting = true
          let retryable = true
          this.update(index, {
            text: '',
            status: 'running',
            attempts: attempt,
            parsedCount: 0,
            usableCount: 0,
            excludedCount: 0,
            issue: undefined,
            failureCode: undefined,
            failureCategory: undefined,
            retryable: undefined,
            retryDelayMs: undefined,
            retryStopReason: undefined,
            limit: undefined,
            error: undefined
          })
          try {
            await this.prepared!.execute(challenge.prompt, attemptController.signal, (chunk) => {
              if (!accepting || !current()) return
              collector.accept(chunk)
              limitError = guard.accept(chunk, collector.rawText)
              if (limitError || collector.error !== undefined) {
                accepting = false
                attemptController.abort(limitError ?? collector.error)
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
            return
          } catch (error) {
            if (!current()) throw signal.reason ?? error
            const failure = limitError ?? collector.error ?? error
            accepting = false
            attemptController.abort(failure)
            const classified = classifyModelTestFailure(failure)
            retryable = classified.retryable
            this.update(index, {
              status: 'error',
              error: classified.message,
              failureCode: limitError ? 'output-limit' : 'request-error',
              failureCategory: classified.category,
              retryable,
              retryStopReason: retryable
                ? attempt === MODELTRACE_MAX_ATTEMPTS
                  ? 'exhausted'
                  : undefined
                : (classified.category as ModelTestRetryStopReason),
              limit: limitError?.limit
            })
            if (!retryable) {
              fatalError = classified.message
              controller.abort(failure)
              this.outputs.forEach((output, other) => {
                if (['pending', 'running', 'retrying'].includes(output.status || 'pending')) {
                  this.update(other, {
                    status: 'aborted',
                    retryDelayMs: undefined,
                    retryStopReason: classified.category as ModelTestRetryStopReason
                  })
                }
              })
            }
          } finally {
            accepting = false
            signal.removeEventListener('abort', abortAttempt)
            release()
          }
          if (!retryable || attempt === MODELTRACE_MAX_ATTEMPTS) return
          this.update(index, { status: 'retrying', retryDelayMs: RETRY_DELAYS[attempt - 1] })
          await waitForRetry(RETRY_DELAYS[attempt - 1], signal)
        }
      }
      // Wait for cancelled peers to release their connections before resolving the run.
      const settled = await Promise.allSettled(indices.map(executeGroup))
      if (!fatalError) {
        signal.throwIfAborted()
        const rejected = settled.find((result) => result.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
      }
      const outputs = structuredClone(this.outputs)
      return {
        target: { ...this.target },
        challenges: structuredClone(this.challenges),
        outputs,
        concurrency: this.concurrency,
        bankVersion: this.bankSnapshot.version,
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
      if (output.status === 'running' || output.status === 'retrying' || output.status === 'pending')
        this.update(index, { status: 'aborted', retryDelayMs: undefined, retryStopReason: 'cancelled' })
    })
  }

  analyze(outputs: ModelTestOutput[]): ModelTraceReport | undefined {
    const report = analyzeModelTraceOutputs(outputs, this.bankSnapshot)
    return report ? { ...report, concurrency: this.concurrency } : undefined
  }
}
