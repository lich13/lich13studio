// Android 12 system images ship Chromium 91 (Safari 15 baseline). Load only ES2022–ES2024 + structuredClone polyfills.
import 'core-js/modules/es.aggregate-error.cause.js'
import 'core-js/modules/es.array.at.js'
import 'core-js/modules/es.array.find-last.js'
import 'core-js/modules/es.array.find-last-index.js'
import 'core-js/modules/es.array.to-reversed.js'
import 'core-js/modules/es.array.to-sorted.js'
import 'core-js/modules/es.array.to-spliced.js'
import 'core-js/modules/es.array.with.js'
import 'core-js/modules/es.error.cause.js'
import 'core-js/modules/es.map.group-by.js'
import 'core-js/modules/es.object.group-by.js'
import 'core-js/modules/es.object.has-own.js'
import 'core-js/modules/es.promise.with-resolvers.js'
import 'core-js/modules/es.set.difference.v2.js'
import 'core-js/modules/es.set.intersection.v2.js'
import 'core-js/modules/es.set.is-disjoint-from.v2.js'
import 'core-js/modules/es.set.is-subset-of.v2.js'
import 'core-js/modules/es.set.is-superset-of.v2.js'
import 'core-js/modules/es.set.symmetric-difference.v2.js'
import 'core-js/modules/es.set.union.v2.js'
import 'core-js/modules/es.string.at-alternative.js'
import 'core-js/modules/es.typed-array.at.js'
import 'core-js/modules/es.typed-array.find-last.js'
import 'core-js/modules/es.typed-array.find-last-index.js'
import 'core-js/modules/es.typed-array.to-reversed.js'
import 'core-js/modules/es.typed-array.to-sorted.js'
import 'core-js/modules/es.typed-array.with.js'
import 'core-js/modules/web.structured-clone.js'

export function installWebviewCompatibility() {
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value<T>(this: T[], index: number): T | undefined {
        const len = this.length >>> 0
        const k = Math.trunc(index) || 0
        const pos = k < 0 ? len + k : k
        return pos >= 0 && pos < len ? this[pos] : undefined
      }
    })
  }
  if (!String.prototype.at) {
    Object.defineProperty(String.prototype, 'at', {
      configurable: true,
      writable: true,
      value(this: string, index: number): string | undefined {
        const str = String(this)
        const len = str.length
        const k = Math.trunc(index) || 0
        const pos = k < 0 ? len + k : k
        return pos >= 0 && pos < len ? str.charAt(pos) : undefined
      }
    })
  }
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
