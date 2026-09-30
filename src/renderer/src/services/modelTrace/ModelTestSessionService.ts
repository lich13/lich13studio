import { loggerService } from '@logger'
import { backgroundTasks } from '@renderer/services/mobile/BackgroundTaskService'
import type { Model } from '@renderer/types'
import { type ModelTestConcurrency, normalizeModelTestConcurrency } from '@shared/modelTestOptions'

import type { FingerprintBankVersion } from './fingerprintBank'
import { FingerprintBankService, fingerprintBankService } from './FingerprintBankService'
import {
  analyzeModelTraceOutputs,
  createModelTraceChallenges,
  type ModelTestChallenge,
  type ModelTestOutput,
  ModelTestRunner,
  type ModelTestTarget,
  type ModelTraceReport
} from './ModelTraceService'
import { validateModelTraceOutput } from './outputValidation'
import { classifyModelTestFailure } from './requestFailure'

const logger = loggerService.withContext('ModelTestSessionService')
export const MODEL_TEST_PREVIEW_INTERVAL_MS = 50

export interface ModelTestSessionSnapshot {
  phase: 'idle' | 'running' | 'completed' | 'stopped' | 'error'
  challenges: ModelTestChallenge[]
  outputs: ModelTestOutput[]
  target?: ModelTestTarget
  report?: ModelTraceReport
  error?: string
  canRetry: boolean
  concurrency?: ModelTestConcurrency
  bankVersion?: FingerprintBankVersion
}

/** Lives outside routes. Unsubscribing a view must never cancel its network request. */
export class ModelTestSessionService {
  constructor(private readonly banks: FingerprintBankService = fingerprintBankService) {}
  private runner?: ModelTestRunner
  private generation = 0
  private listeners = new Set<() => void>()
  private notificationTimer?: ReturnType<typeof setTimeout>
  private notifying = false
  private publishedSnapshot?: ModelTestSessionSnapshot
  private snapshot: ModelTestSessionSnapshot = {
    phase: 'idle',
    challenges: createModelTraceChallenges(),
    outputs: [],
    canRetry: false
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(changes: Partial<ModelTestSessionSnapshot>, deferred = false) {
    this.snapshot = { ...this.snapshot, ...changes }
    if (deferred || this.notifying) this.scheduleNotification()
    else this.publish()
  }

  private scheduleNotification() {
    if (this.notificationTimer !== undefined) return
    const generation = this.generation
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = undefined
      if (generation === this.generation) this.publish()
    }, MODEL_TEST_PREVIEW_INTERVAL_MS)
  }

  private publish() {
    if (this.notificationTimer !== undefined) clearTimeout(this.notificationTimer)
    this.notificationTimer = undefined
    if (this.publishedSnapshot === this.snapshot) return
    this.publishedSnapshot = this.snapshot
    this.notifying = true
    try {
      // React may unsubscribe/resubscribe while rendering. Iterate a fixed
      // list so those changes cannot recursively extend this notification.
      for (const listener of [...this.listeners]) {
        if (!this.listeners.has(listener)) continue
        try {
          listener()
        } catch {
          // Presentation failures must never reject a provider request or
          // expose a provider's credentials through error serialization.
          logger.warn('Model test view subscriber failed; session retained')
        }
      }
    } finally {
      this.notifying = false
    }
  }

  start(model: Model, concurrency: ModelTestConcurrency = 1): Promise<void> {
    if (this.snapshot.phase === 'running') return Promise.resolve()
    this.runner?.cancel()
    const runner = new ModelTestRunner({
      model,
      concurrency: normalizeModelTestConcurrency(concurrency),
      bankSnapshot: this.banks.capture(),
      challenges: this.snapshot.challenges,
      onProgress: ({ index, output, target }) => {
        if (this.runner !== runner) return
        const outputs = [...this.snapshot.outputs]
        const previous = outputs[index]
        outputs[index] = output
        this.update(
          {
            outputs,
            target,
            ...(output.status === 'completed' ? { report: runner.analyze(outputs) } : {})
          },
          output.status === 'running' && previous?.status === 'running' && previous.attempts === output.attempts
        )
      }
    })
    this.runner = runner
    this.update({
      outputs: [],
      target: undefined,
      report: undefined,
      concurrency: runner.concurrency,
      bankVersion: runner.bankSnapshot.version
    })
    return this.execute(false)
  }

  retryFailed(): Promise<void> {
    if (!this.snapshot.canRetry || this.snapshot.phase === 'running') return Promise.resolve()
    return this.execute(true)
  }

  private async execute(retryFailedOnly: boolean): Promise<void> {
    const runner = this.runner
    if (!runner) return
    const generation = ++this.generation
    this.update({ phase: 'running', error: undefined, canRetry: false })
    let release: (() => void) | undefined
    try {
      release = await backgroundTasks.acquire(() => this.stop())
      if (generation !== this.generation) return
      const result = await runner.run({ retryFailedOnly })
      if (generation !== this.generation || runner !== this.runner) return
      this.update({
        ...result,
        phase: result.error || result.outputs.some((output) => output.status === 'error') ? 'error' : 'completed',
        canRetry: result.outputs.some((output) => output.status !== 'completed')
      })
    } catch (error) {
      if (generation !== this.generation || runner !== this.runner) return
      this.update({
        phase: 'error',
        error: classifyModelTestFailure(error).message,
        canRetry: true
      })
    } finally {
      release?.()
    }
  }

  stop() {
    if (this.snapshot.phase !== 'running') return
    this.generation += 1
    this.runner?.cancel()
    this.update({ phase: 'stopped', error: undefined, canRetry: true })
  }

  regenerate() {
    if (this.snapshot.phase === 'running') return
    this.runner = undefined
    this.update({
      phase: 'idle',
      challenges: createModelTraceChallenges(),
      outputs: [],
      target: undefined,
      report: undefined,
      error: undefined,
      canRetry: false,
      concurrency: undefined,
      bankVersion: undefined
    })
  }

  editOutput(index: number, text: string) {
    if (this.snapshot.phase === 'running' || !this.snapshot.challenges[index]) return
    this.runner = undefined
    const outputs = [...this.snapshot.outputs]
    const { id, expected_count } = this.snapshot.challenges[index]
    outputs[index] = { id, expected_count, text }
    this.update({
      outputs,
      target: undefined,
      report: undefined,
      error: undefined,
      phase: 'idle',
      canRetry: false,
      bankVersion: undefined,
      concurrency: undefined
    })
  }

  analyze() {
    if (this.snapshot.phase === 'running') return
    const outputs = this.snapshot.challenges.map(({ id, expected_count }, index): ModelTestOutput => {
      const validation = validateModelTraceOutput(this.snapshot.outputs[index]?.text || '', expected_count)
      return {
        ...this.snapshot.outputs[index],
        id,
        expected_count,
        text: validation.text,
        status: 'completed',
        error: undefined,
        failureCode: undefined,
        failureCategory: undefined,
        limit: undefined,
        retryable: undefined,
        retryDelayMs: undefined,
        retryStopReason: undefined,
        parsedCount: validation.parsedCount,
        usableCount: validation.usableCount,
        excludedCount: validation.excludedCount,
        issue: validation.issue
      }
    })
    const bankSnapshot = this.banks.capture()
    this.update({
      outputs,
      error: undefined,
      phase: 'completed',
      canRetry: false,
      bankVersion: bankSnapshot.version,
      concurrency: undefined,
      report: analyzeModelTraceOutputs(outputs, bankSnapshot)
    })
  }
}

export const modelTestSession = new ModelTestSessionService()
