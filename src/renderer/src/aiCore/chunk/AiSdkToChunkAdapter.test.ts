import { ChunkType } from '@renderer/types/chunk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiSdkToChunkAdapter } from './AiSdkToChunkAdapter'

const streamFrom = (parts: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })

describe('AiSdkToChunkAdapter', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { __LICH13_TAURI_SHIM__: true })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('completes a text response when the provider closes without a finish part', async () => {
    const chunks: any[] = []
    const adapter = new AiSdkToChunkAdapter(async (chunk) => {
      chunks.push(chunk)
    }, false)

    await adapter.processStream({
      fullStream: streamFrom([{ type: 'text-start' }, { type: 'text-delta', text: '好的。' }, { type: 'text-end' }]),
      text: Promise.resolve('好的。')
    })

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      ChunkType.TEXT_START,
      ChunkType.TEXT_DELTA,
      ChunkType.TEXT_COMPLETE,
      ChunkType.BLOCK_COMPLETE,
      ChunkType.LLM_RESPONSE_COMPLETE
    ])
    expect(chunks.filter((chunk) => chunk.type === ChunkType.ERROR)).toHaveLength(0)
  })

  it('waits for asynchronous chunk callbacks before returning', async () => {
    let completed = false
    const adapter = new AiSdkToChunkAdapter(async (chunk) => {
      if (chunk.type === ChunkType.BLOCK_COMPLETE) {
        await Promise.resolve()
        completed = true
      }
    })

    await adapter.processStream({
      fullStream: streamFrom([{ type: 'text-delta', text: 'ok' }]),
      text: Promise.resolve('ok')
    })

    expect(completed).toBe(true)
  })
})
