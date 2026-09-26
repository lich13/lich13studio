/** Lightweight handle exposing the stream timeout controls. */
export interface IdleTimeoutHandle {
  reset: () => void
  markFirstToken: () => void
  cleanup: () => void
}

/**
 * A resettable idle timeout that aborts via an AbortController.
 * Each call to `reset()` restarts the countdown.
 * When the timeout fires without being reset, the internal AbortController is aborted.
 */
export class IdleTimeoutController {
  private controller: AbortController
  private timerId: ReturnType<typeof setTimeout> | null = null
  private firstTokenTimerId: ReturnType<typeof setTimeout> | null = null
  private firstTokenReceived = false
  private readonly timeoutMs: number
  private readonly firstTokenTimeoutMs: number

  constructor(timeoutMs: number, firstTokenTimeoutMs = 30_000) {
    this.timeoutMs = timeoutMs
    this.firstTokenTimeoutMs = Math.min(timeoutMs, firstTokenTimeoutMs)
    this.controller = new AbortController()
    this.startTimer()
    this.startFirstTokenTimer()
  }

  /** The AbortSignal that will be aborted on idle timeout. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Reset the idle timer. Call this every time new data arrives. */
  reset = (): void => {
    if (this.controller.signal.aborted) return
    this.clearTimer()
    this.startTimer()
  }

  /** Stop the first-token watchdog once a provider emits content or reasoning. */
  markFirstToken = (): void => {
    if (this.firstTokenReceived) return
    this.firstTokenReceived = true
    this.clearFirstTokenTimer()
  }

  /** Clean up the timer (e.g. when the stream finishes normally). */
  cleanup = (): void => {
    this.clearTimer()
    this.clearFirstTokenTimer()
  }

  private startTimer(): void {
    this.timerId = setTimeout(() => {
      this.controller.abort(new DOMException('Idle timeout exceeded', 'TimeoutError'))
    }, this.timeoutMs)
  }

  private startFirstTokenTimer(): void {
    this.firstTokenTimerId = setTimeout(() => {
      if (!this.firstTokenReceived && !this.controller.signal.aborted) {
        this.controller.abort(new DOMException('First token timeout exceeded', 'TimeoutError'))
      }
    }, this.firstTokenTimeoutMs)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  private clearFirstTokenTimer(): void {
    if (this.firstTokenTimerId !== null) {
      clearTimeout(this.firstTokenTimerId)
      this.firstTokenTimerId = null
    }
  }
}
