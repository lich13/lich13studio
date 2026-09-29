/** A permit covers one live request, not the backoff between attempts. */
export class RequestSlots {
  private active = 0
  private waiting: Array<() => void> = []
  constructor(private readonly limit: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter((entry) => entry !== enter)
        reject(signal.reason)
      }
      const enter = () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        this.active += 1
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active -= 1
          this.waiting.shift()?.()
        })
      }
      if (this.active < this.limit) enter()
      else {
        this.waiting.push(enter)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }
}
