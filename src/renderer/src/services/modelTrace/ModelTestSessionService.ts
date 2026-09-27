import type { Model } from '@renderer/types'

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

export interface ModelTestSessionSnapshot {
  phase: 'idle' | 'running' | 'completed' | 'stopped' | 'error'
  challenges: ModelTestChallenge[]
  outputs: ModelTestOutput[]
  target?: ModelTestTarget
  report?: ModelTraceReport
  error?: string
  canRetry: boolean
}

/** Lives outside routes. Unsubscribing a view must never cancel its network request. */
export class ModelTestSessionService {
  private runner?: ModelTestRunner
  private generation = 0
  private listeners = new Set<() => void>()
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

  private update(changes: Partial<ModelTestSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes }
    this.listeners.forEach((listener) => listener())
  }

  start(model: Model): Promise<void> {
    if (this.snapshot.phase === 'running') return Promise.resolve()
    this.runner?.cancel()
    const runner = new ModelTestRunner({
      model,
      challenges: this.snapshot.challenges,
      onProgress: ({ index, output, target }) => {
        if (this.runner !== runner) return
        const outputs = [...this.snapshot.outputs]
        outputs[index] = output
        this.update({
          outputs,
          target,
          ...(output.status === 'completed' ? { report: analyzeModelTraceOutputs(outputs) } : {})
        })
      }
    })
    this.runner = runner
    this.update({ outputs: [], target: undefined, report: undefined })
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
    try {
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
        error: error instanceof Error ? error.message : String(error),
        canRetry: true
      })
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
      canRetry: false
    })
  }

  editOutput(index: number, text: string) {
    if (this.snapshot.phase === 'running' || !this.snapshot.challenges[index]) return
    this.runner = undefined
    const outputs = [...this.snapshot.outputs]
    const { id, expected_count } = this.snapshot.challenges[index]
    outputs[index] = { id, expected_count, text }
    this.update({ outputs, target: undefined, report: undefined, error: undefined, phase: 'idle', canRetry: false })
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
        parsedCount: validation.parsedCount,
        usableCount: validation.usableCount,
        excludedCount: validation.excludedCount,
        issue: validation.issue
      }
    })
    this.update({
      outputs,
      error: undefined,
      phase: 'completed',
      canRetry: false,
      report: analyzeModelTraceOutputs(outputs)
    })
  }
}

export const modelTestSession = new ModelTestSessionService()
