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
})
