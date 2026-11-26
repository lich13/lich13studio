import { loggerService } from '@logger'
import { DEFAULT_LANGUAGES, DEFAULT_THEMES } from '@renderer/utils/shiki'
import { LRUCache } from 'lru-cache'
import type { ThemedToken } from 'shiki/core'

const logger = loggerService.withContext('ShikiStreamService')

const SERVICE_CONFIG = {
  CACHE: {
    MAX_SIZE: 100,
    TTL: 1000 * 60 * 30
  },
  DEGRADATION_CACHE: {
    MAX_SIZE: 500,
    TTL: 1000 * 60 * 60 * 12
  },
  WORKER: {
    MAX_INIT_RETRY: 2,
    REQUEST_TIMEOUT: {
      INIT: 8000,
      HIGHLIGHT: 30000,
      DEFAULT: 10000
    }
  }
}

export type ShikiPreProperties = {
  class: string
  style: string
  tabindex: number
}

export interface HighlightChunkResult {
  lines: ThemedToken[][]
  recall: number
}

function createPlainTextLines(chunk: string): ThemedToken[][] {
  return (chunk || '').split('\n').map((line) => [{ content: line, offset: 0 }])
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Single-Worker Shiki highlighting service (`shiki/bundle/web`).
 * Keeps Oniguruma WASM and grammar chunks strictly off the main thread.
 */
class ShikiStreamService {
  private codeCache = new LRUCache<string, string>({
    max: SERVICE_CONFIG.CACHE.MAX_SIZE,
    ttl: SERVICE_CONFIG.CACHE.TTL,
    updateAgeOnGet: true
  })

  private prePropsCache = new LRUCache<string, ShikiPreProperties>({
    max: SERVICE_CONFIG.CACHE.MAX_SIZE,
    ttl: SERVICE_CONFIG.CACHE.TTL,
    updateAgeOnGet: true
  })

  private worker: Worker | null = null
  private workerInitPromise: Promise<void> | null = null
  private workerInitRetryCount = 0
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void
      reject: (reason?: any) => void
    }
  >()
  private requestId = 0

  private workerDegradationCache = new LRUCache<string, boolean>({
    max: SERVICE_CONFIG.DEGRADATION_CACHE.MAX_SIZE,
    ttl: SERVICE_CONFIG.DEGRADATION_CACHE.TTL
  })

  public hasWorkerHighlighter(): boolean {
    return !!this.worker && !this.workerInitPromise
  }

  private async ensureWorker(): Promise<boolean> {
    if (this.hasWorkerHighlighter()) return true
    if (typeof Worker === 'undefined') return false
    try {
      await this.initWorker()
      return this.hasWorkerHighlighter()
    } catch (error) {
      logger.warn('Failed to initialize Shiki worker, falling back to plain text:', error as Error)
      return false
    }
  }

  private async initWorker(): Promise<void> {
    if (typeof Worker === 'undefined') return
    if (this.workerInitPromise) return this.workerInitPromise
    if (this.worker) return

    if (this.workerInitRetryCount >= SERVICE_CONFIG.WORKER.MAX_INIT_RETRY) {
      return
    }

    this.workerInitPromise = (async () => {
      try {
        const WorkerModule = await import('../workers/shiki-stream.worker?worker')
        this.worker = new WorkerModule.default()

        this.worker.onmessage = (event) => {
          const { id, type, result, error } = event.data
          const pendingRequest = this.pendingRequests.get(id)
          if (!pendingRequest) return

          this.pendingRequests.delete(id)

          if (type === 'error') {
            pendingRequest.reject(new Error(error))
          } else if (type === 'init-result') {
            pendingRequest.resolve({ success: true })
            this.workerInitRetryCount = 0
          } else {
            pendingRequest.resolve(result)
          }
        }

        await this.sendWorkerMessage({
          type: 'init',
          languages: DEFAULT_LANGUAGES,
          themes: DEFAULT_THEMES
        })
        this.workerInitRetryCount = 0
      } catch (error) {
        this.worker?.terminate()
        this.worker = null
        this.workerInitRetryCount++
        throw error
      } finally {
        this.workerInitPromise = null
      }
    })()

    return this.workerInitPromise
  }

  private sendWorkerMessage(message: Record<string, unknown>): Promise<any> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not available'))
    }

    const id = this.requestId++
    let timerId: ReturnType<typeof setTimeout>
    let settled = false

    const promise = new Promise((resolve, reject) => {
      const safeResolve = (value: any) => {
        if (!settled) {
          settled = true
          clearTimeout(timerId)
          this.pendingRequests.delete(id)
          resolve(value)
        }
      }

      const safeReject = (reason?: any) => {
        if (!settled) {
          settled = true
          clearTimeout(timerId)
          this.pendingRequests.delete(id)
          reject(reason)
        }
      }

      this.pendingRequests.set(id, { resolve: safeResolve, reject: safeReject })

      const timeout =
        message.type === 'init'
          ? SERVICE_CONFIG.WORKER.REQUEST_TIMEOUT.INIT
          : message.type === 'highlight' || message.type === 'code-to-html'
            ? SERVICE_CONFIG.WORKER.REQUEST_TIMEOUT.HIGHLIGHT
            : SERVICE_CONFIG.WORKER.REQUEST_TIMEOUT.DEFAULT

      timerId = setTimeout(() => {
        if (message.type === 'highlight' && typeof message.callerId === 'string') {
          this.workerDegradationCache.set(message.callerId, true)
          safeReject(new Error(`Worker highlight request timeout for callerId ${message.callerId}`))
        } else {
          safeReject(new Error(`Worker ${String(message.type)} request timeout`))
        }
      }, timeout)
    })

    try {
      this.worker.postMessage({ id, ...message })
    } catch (error) {
      const pendingRequest = this.pendingRequests.get(id)
      if (pendingRequest) {
        pendingRequest.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    return promise
  }

  async getShikiPreProperties(language: string, theme: string): Promise<ShikiPreProperties> {
    const cacheKey = `${language}:${theme}`
    const cached = this.prePropsCache.get(cacheKey)
    if (cached) {
      return cached
    }

    if (await this.ensureWorker()) {
      try {
        const props = (await this.sendWorkerMessage({
          type: 'pre-properties',
          language,
          theme
        })) as ShikiPreProperties
        this.prePropsCache.set(cacheKey, props)
        return props
      } catch (error) {
        logger.debug('Failed to fetch Shiki pre properties from worker:', error as Error)
      }
    }

    return { class: 'shiki', style: '', tabindex: 0 }
  }

  async highlightCode(code: string, language: string, theme: string): Promise<string> {
    if (await this.ensureWorker()) {
      try {
        return (await this.sendWorkerMessage({
          type: 'code-to-html',
          code,
          language,
          theme
        })) as string
      } catch (error) {
        logger.debug('Failed to render code HTML via Shiki worker:', error as Error)
      }
    }

    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`
  }

  async highlightStreamingCode(
    code: string,
    language: string,
    theme: string,
    callerId: string
  ): Promise<HighlightChunkResult> {
    const cacheKey = `${callerId}-${language}-${theme}`
    const lastContent = this.codeCache.get(cacheKey)

    if (lastContent !== undefined && code.length === lastContent.length && code === lastContent) {
      return { lines: [], recall: 0 }
    }

    const isAppend =
      lastContent !== undefined &&
      lastContent.length > 0 &&
      code.length > lastContent.length &&
      code.startsWith(lastContent)

    try {
      let result: HighlightChunkResult

      if (isAppend) {
        const chunk = code.slice(lastContent.length)
        result = await this.highlightCodeChunk(chunk, language, theme, callerId)
      } else {
        this.cleanupTokenizers(callerId)
        this.codeCache.delete(cacheKey)

        result = await this.highlightCodeChunk(code, language, theme, callerId)
        result = {
          ...result,
          recall: -1
        }
      }

      this.codeCache.set(cacheKey, code)
      return result
    } catch (error) {
      logger.error('Failed to highlight streaming code:', error as Error)
      throw error
    }
  }

  async highlightCodeChunk(
    chunk: string,
    language: string,
    theme: string,
    callerId: string
  ): Promise<HighlightChunkResult> {
    if (!this.workerDegradationCache.has(callerId) && (await this.ensureWorker())) {
      try {
        return (await this.sendWorkerMessage({
          type: 'highlight',
          callerId,
          chunk,
          language,
          theme
        })) as HighlightChunkResult
      } catch (error) {
        this.workerDegradationCache.set(callerId, true)
        logger.error(
          `Worker highlight failed for callerId ${callerId}, falling back to plain text lines:`,
          error as Error
        )
      }
    }

    return {
      lines: createPlainTextLines(chunk),
      recall: 0
    }
  }

  cleanupTokenizers(callerId: string): void {
    if (this.hasWorkerHighlighter()) {
      this.sendWorkerMessage({
        type: 'cleanup',
        callerId
      }).catch((error) => {
        logger.error('Failed to cleanup worker tokenizer:', error as Error)
      })
    }

    for (const key of this.codeCache.keys()) {
      if (key.startsWith(`${callerId}-`)) {
        this.codeCache.delete(key)
      }
    }
  }

  dispose() {
    if (this.worker) {
      this.sendWorkerMessage({ type: 'dispose' }).catch((error) => {
        logger.warn('Failed to dispose worker:', error as Error)
      })
      this.worker.terminate()
      this.worker = null
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Worker disposed'))
      }
      this.pendingRequests.clear()
      this.requestId = 0
    }

    this.workerDegradationCache.clear()
    this.codeCache.clear()
    this.prePropsCache.clear()
    this.workerInitPromise = null
    this.workerInitRetryCount = 0
  }
}

export const shikiStreamService = new ShikiStreamService()
