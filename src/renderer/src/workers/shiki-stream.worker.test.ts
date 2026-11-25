import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    initWindowSource: () => ({
      withContext: () => ({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      })
    })
  }
}))

describe('shiki-stream.worker developer language highlighting', () => {
  const postedMessages: Array<Record<string, any>> = []
  let onMessageHandler: ((event: MessageEvent) => Promise<void>) | null = null

  beforeEach(async () => {
    vi.resetModules()
    postedMessages.length = 0
    onMessageHandler = null

    const workerSelf = {
      postMessage: (msg: Record<string, any>) => {
        postedMessages.push(msg)
      },
      set onmessage(fn: (event: MessageEvent) => Promise<void>) {
        onMessageHandler = fn
      },
      get onmessage() {
        return onMessageHandler as any
      }
    }
    vi.stubGlobal('self', workerSelf)
    await import('./shiki-stream.worker')
  })

  afterEach(async () => {
    if (onMessageHandler) {
      await onMessageHandler({ data: { id: 999, type: 'dispose' } } as MessageEvent)
    }
    vi.unstubAllGlobals()
  })

  it('highlights web and systems languages (rust, go, swift, kotlin, toml, dockerfile, shell) without degrading to plain text', async () => {
    expect(onMessageHandler).toBeTypeOf('function')

    await onMessageHandler!({
      data: {
        id: 1,
        type: 'init',
        languages: ['text', 'typescript', 'python'],
        themes: ['one-light']
      }
    } as MessageEvent)
    expect(postedMessages.at(-1)).toEqual({ id: 1, type: 'init-result', result: { success: true } })

    const samples: Array<[string, string]> = [
      ['rust', 'pub fn main() -> usize { 42 }'],
      ['go', 'package main\nfunc main() {}'],
      ['swift', 'let greeting: String = "hello"'],
      ['kotlin', 'fun answer(): Int = 42'],
      ['toml', '[package]\nname = "lich13studio"'],
      ['dockerfile', 'FROM rust:1.85\nRUN cargo build'],
      ['shell', 'echo "ready"']
    ]

    let nextId = 2
    for (const [language, code] of samples) {
      const reqId = nextId++
      await onMessageHandler!({
        data: {
          id: reqId,
          type: 'code-to-html',
          code,
          language,
          theme: 'one-light'
        }
      } as MessageEvent)
      const response = postedMessages.find((msg) => msg.id === reqId)
      expect(response?.type, `${language} response type`).toBe('code-to-html-result')
      expect(response?.result, `${language} html output`).toContain('<span style="color:')
    }
  }, 20000)

  it('loads and highlights all bundled Shiki languages without Oniguruma WASM or RegExp v-flag support (Chrome 91)', async () => {
    vi.resetModules()
    postedMessages.length = 0
    onMessageHandler = null

    const OriginalRegExp = globalThis.RegExp
    const LegacyRegExp = new Proxy(OriginalRegExp, {
      construct(target, args: [string | RegExp, string?], newTarget) {
        if (typeof args[1] === 'string' && args[1].includes('v')) {
          throw new SyntaxError("Invalid regular expression flags 'v'")
        }
        return Reflect.construct(target, args, newTarget)
      },
      apply(target, thisArg, args: [string | RegExp, string?]) {
        if (typeof args[1] === 'string' && args[1].includes('v')) {
          throw new SyntaxError("Invalid regular expression flags 'v'")
        }
        return Reflect.apply(target, thisArg, args)
      }
    })
    vi.stubGlobal('RegExp', LegacyRegExp)

    const workerSelf = {
      postMessage: (msg: Record<string, any>) => {
        postedMessages.push(msg)
      },
      set onmessage(fn: (event: MessageEvent) => Promise<void>) {
        onMessageHandler = fn
      },
      get onmessage() {
        return onMessageHandler as any
      }
    }
    vi.stubGlobal('self', workerSelf)
    const { BUNDLED_LANGUAGES } = await import('./shiki-stream.worker')

    // Simulate Android 12 WebView (Chromium 91) Worker lacking ES2022 Array/String.prototype.at after module evaluation
    // (deleting after Vite's test runner finishes module resolution so ViteNodeRunner itself does not crash).
    const origArrayAt = Array.prototype.at
    const origStringAt = String.prototype.at
    delete (Array.prototype as any).at
    delete (String.prototype as any).at
    try {
      await onMessageHandler!({
        data: {
          id: 1,
          type: 'init',
          languages: ['text'],
          themes: ['one-light']
        }
      } as MessageEvent)
      expect(Array.prototype.at).toBeTypeOf('function')
      expect(postedMessages.at(-1)).toEqual({ id: 1, type: 'init-result', result: { success: true } })

      const allLanguages = Object.keys(BUNDLED_LANGUAGES)
      expect(allLanguages.length).toBeGreaterThanOrEqual(38)

      let nextId = 10
      for (const language of allLanguages) {
        const reqId = nextId++
        await onMessageHandler!({
          data: {
            id: reqId,
            type: 'code-to-html',
            code: 'const x = "hello"; // comment\nSELECT 1;',
            language,
            theme: 'one-light'
          }
        } as MessageEvent)
        const response = postedMessages.find((msg) => msg.id === reqId)
        expect(response?.type, `${language} under legacy RegExp`).toBe('code-to-html-result')
        expect(response?.result, `${language} pre output`).toContain('<pre')
      }

      // Verify JS tokenization produces real syntax colors (not 1-token plain text fallback) under Chromium 91 polyfills.
      const jsCheckId = nextId++
      await onMessageHandler!({
        data: {
          id: jsCheckId,
          type: 'code-to-html',
          code: 'export const answer = 42;',
          language: 'js',
          theme: 'one-light'
        }
      } as MessageEvent)
      const jsRes = postedMessages.find((msg) => msg.id === jsCheckId)
      expect((jsRes?.result as string)?.match(/<span style="color:/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    } finally {
      if (!Array.prototype.at && origArrayAt) {
        Object.defineProperty(Array.prototype, 'at', { value: origArrayAt, configurable: true, writable: true })
      }
      if (!String.prototype.at && origStringAt) {
        Object.defineProperty(String.prototype, 'at', { value: origStringAt, configurable: true, writable: true })
      }
    }
  }, 30000)
})
