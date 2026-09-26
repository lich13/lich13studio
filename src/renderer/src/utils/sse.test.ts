import { createSSEReadableStream } from '@renderer/utils/sse'
import { describe, expect, it, vi } from 'vitest'

const sourceFromChunks = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    }
  })

describe('createSSEReadableStream', () => {
  it('handles CRLF, split JSON, lifecycle events, and DONE', async () => {
    const stream = createSSEReadableStream<{ type: string; value?: string }>(
      sourceFromChunks([
        'data: {"type":"response.created"}\r\n\r\n',
        'data: {"type":"text-d',
        'elta","value":"hello"}\r\n\r\n',
        'data: [DONE]\r\n\r\n'
      ]),
      new AbortController().signal
    )
    const values: Array<{ type: string; value?: string }> = []
    const reader = stream.getReader()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      values.push(result.value)
    }
    expect(values).toEqual([{ type: 'response.created' }, { type: 'text-delta', value: 'hello' }])
  })

  it('drops malformed events without logging payload contents', async () => {
    const onParseError = vi.fn()
    const stream = createSSEReadableStream(
      sourceFromChunks(['data: {bad}\n\n', 'data: {"type":"finish"}\n\n']),
      new AbortController().signal,
      onParseError
    )
    const reader = stream.getReader()
    const first = await reader.read()
    const second = await reader.read()
    expect(first.value).toEqual({ type: 'finish' })
    expect(second.done).toBe(true)
    expect(onParseError).toHaveBeenCalledWith(expect.any(Error), 5)
    expect(JSON.stringify(onParseError.mock.calls)).not.toContain('{bad}')
  })
})
