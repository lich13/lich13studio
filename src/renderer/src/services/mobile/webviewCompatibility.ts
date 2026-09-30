// Android 12 system images ship Chromium 91. Load before store/SDK modules.
import 'core-js/stable'

export function installWebviewCompatibility() {
  if (typeof AbortSignal !== 'undefined') {
    if (!('reason' in AbortSignal.prototype)) {
      const reasons = new WeakMap<AbortSignal, unknown>()
      const abort = AbortController.prototype.abort
      AbortController.prototype.abort = function (reason?: unknown) {
        if (!this.signal.aborted)
          reasons.set(
            this.signal,
            reason === undefined ? new DOMException('Request was aborted', 'AbortError') : reason
          )
        abort.call(this)
      }
      Object.defineProperty(AbortSignal.prototype, 'reason', {
        configurable: true,
        get() {
          if (this.aborted && !reasons.has(this))
            reasons.set(this, new DOMException('Request was aborted', 'AbortError'))
          return reasons.get(this)
        }
      })
    }
    if (!AbortSignal.prototype.throwIfAborted) {
      AbortSignal.prototype.throwIfAborted = function () {
        if (this.aborted) throw this.reason
      }
    }
    if (!AbortSignal.any) {
      AbortSignal.any = (sources: AbortSignal[]) => {
        const controller = new AbortController()
        const listeners: Array<() => void> = []
        const stop = (source: AbortSignal) => {
          controller.abort(source.reason)
          for (const remove of listeners) remove()
        }
        for (const source of sources) {
          if (source.aborted) {
            stop(source)
            break
          }
          const callback = () => stop(source)
          source.addEventListener('abort', callback, { once: true })
          listeners.push(() => source.removeEventListener('abort', callback))
        }
        return controller.signal
      }
    }
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = (milliseconds: number) => {
        if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError('Invalid abort delay')
        const controller = new AbortController()
        setTimeout(() => controller.abort(new DOMException('Operation timed out', 'TimeoutError')), milliseconds)
        return controller.signal
      }
    }
  }
  if (globalThis.crypto && !crypto.randomUUID) {
    crypto.randomUUID = (): ReturnType<Crypto['randomUUID']> => {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 15) | 64
      bytes[8] = (bytes[8] & 63) | 128
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  }
}
installWebviewCompatibility()
