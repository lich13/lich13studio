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
  it.each([false, true])('keeps text-end complete while accumulate=%s', async (accumulate) => {
    const chunks: any[] = []
    const adapter = new AiSdkToChunkAdapter((chunk) => {
      chunks.push(chunk)
    }, accumulate)
    await adapter.processStream({
      fullStream: streamFrom([
        { type: 'text-start', providerMetadata: { openai: { phase: 'final_answer' } } },
        { type: 'text-delta', text: '247 ' },
        { type: 'text-delta', text: '18' },
        { type: 'text-end' }
      ]),
      text: Promise.resolve('247 18')
    })
    expect(chunks.filter((chunk) => chunk.type === ChunkType.TEXT_DELTA).map((chunk) => chunk.text)).toEqual(
      accumulate ? ['247 ', '247 18'] : ['247 ', '18']
    )
    expect(chunks.find((chunk) => chunk.type === ChunkType.TEXT_COMPLETE).text).toBe('247 18')
    expect(chunks[0].providerMetadata.openai.phase).toBe('final_answer')
  })
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
    let finishCallback!: () => void
    const callbackGate = new Promise<void>((resolve) => {
      finishCallback = resolve
    })
    let signalCallbackStarted!: () => void
    const callbackStarted = new Promise<void>((resolve) => {
      signalCallbackStarted = resolve
    })
    let callbackCompleted = false
    const adapter = new AiSdkToChunkAdapter((chunk) => {
      if (chunk.type === ChunkType.BLOCK_COMPLETE) {
        signalCallbackStarted()
        return callbackGate.then(() => {
          callbackCompleted = true
        })
      }
    })

    const processing = adapter.processStream({
      fullStream: streamFrom([{ type: 'text-delta', text: 'ok' }]),
      text: Promise.resolve('ok')
    })
    let settled = false
    void processing.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await callbackStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(callbackCompleted).toBe(false)
    expect(settled).toBe(false)

    finishCallback()
    await processing

    expect(callbackCompleted).toBe(true)
    expect(settled).toBe(true)
  })
})
