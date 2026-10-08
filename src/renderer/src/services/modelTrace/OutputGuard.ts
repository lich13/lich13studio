import { type Chunk, ChunkType } from '@renderer/types/chunk'

import { isolateAnswer } from './outputValidation'

export const MODEL_TEST_MAX_OUTPUT_TOKENS = 4096
export const MODEL_TEST_MAX_OUTPUT_BYTES = 32 * 1024
export type ModelTestLimit = {
  kind: 'integers' | 'bytes'
  maximum: number
  actual: number
  /** Offset in the isolated answer where the first excess integer ends. */
  position?: number
}

export const getModelTestMaxOutputTokens = (expectedCount: number): number =>
  Math.min(MODEL_TEST_MAX_OUTPUT_TOKENS, Math.max(1024, expectedCount * 4))

export class ModelTestOutputLimitError extends Error {
  readonly code = 'output-limit'
  constructor(readonly limit: ModelTestLimit) {
    super(`Model test output limit exceeded (${limit.kind}: ${limit.actual}/${limit.maximum})`)
    this.name = 'ModelTestOutputLimitError'
  }
}

/** A trailing number remains pending until its delimiter or a real block end. */
export function countCompleteIntegers(raw: string, complete: boolean): number {
  const answer = isolateAnswer(raw, false, false).text
  let count = 0
  for (const match of answer.matchAll(/(?<![\p{L}\p{N}_.+-])[+-]?\d+(?![\p{L}\p{N}_.+-])/gu)) {
    if (complete || match.index + match[0].length < answer.length) count += 1
  }
  return count
}

/** Keep the visible preview at the first protected integer, never at the full chunk size. */
export function truncateAtIntegerLimit(raw: string, maximum: number): string {
  const answer = isolateAnswer(raw, false, false).text
  let count = 0
  for (const match of answer.matchAll(/(?<![\p{L}\p{N}_.+-])[+-]?\d+(?![\p{L}\p{N}_.+-])/gu)) {
    if (match.index + match[0].length >= answer.length) continue
    count += 1
    if (count > maximum) return answer.slice(0, match.index + match[0].length)
  }
  return answer
}

class TextBytes {
  private closedBytes = 0
  private current = ''
  private open = false
  private hasClosed = false
  private encoder = new TextEncoder()

  start() {
    if (this.open) this.closedBytes += this.encoder.encode(this.current).byteLength
    this.current = ''
    this.open = true
  }
  delta(text: string) {
    if (!this.open) this.start()
    this.current += text
  }
  snapshot(text: string) {
    if (!this.open) this.start()
    this.current = text
  }
  end(text: string) {
    if (!this.open && this.hasClosed) return
    this.current = text
    this.closedBytes += this.encoder.encode(this.current).byteLength
    this.current = ''
    this.open = false
    this.hasClosed = true
  }
  get bytes() {
    return this.closedBytes + this.encoder.encode(this.current).byteLength
  }
}

/** Counts generated content, including hidden thinking/commentary, never snapshots twice. */
export class ModelTestOutputGuard {
  private text = new TextBytes()
  private thinking = new TextBytes()
  private encoder = new TextEncoder()
  constructor(private readonly expected: number) {}

  accept(chunk: Chunk, answer: string): ModelTestOutputLimitError | undefined {
    switch (chunk.type) {
      case ChunkType.TEXT_START:
        this.text.start()
        break
      case ChunkType.TEXT_DELTA:
        if (chunk.textMode === 'cumulative') this.text.snapshot(chunk.text)
        else this.text.delta(chunk.text)
        break
      case ChunkType.TEXT_COMPLETE:
        this.text.end(chunk.text)
        break
      case ChunkType.THINKING_START:
        this.thinking.start()
        break
      // The adapter emits thinking snapshots even in text delta mode.
      case ChunkType.THINKING_DELTA:
        this.thinking.snapshot(chunk.text)
        break
      case ChunkType.THINKING_COMPLETE:
        this.thinking.end(chunk.text)
        break
    }
    const final = chunk.type === ChunkType.LLM_RESPONSE_COMPLETE ? chunk.response : undefined
    const bytes =
      Math.max(this.text.bytes, this.encoder.encode(final?.text || '').byteLength) +
      Math.max(this.thinking.bytes, this.encoder.encode(final?.reasoning_content || '').byteLength)
    if (bytes > MODEL_TEST_MAX_OUTPUT_BYTES)
      return new ModelTestOutputLimitError({ kind: 'bytes', maximum: MODEL_TEST_MAX_OUTPUT_BYTES, actual: bytes })
    // Count only stream increments. A normal provider terminal event may contain
    // a quantity or range mismatch, which is an analysis issue rather than a
    // transport failure and must not trigger a retry.
    if (chunk.type === ChunkType.TEXT_DELTA) {
      const maximum = this.expected * 2
      const isolated = isolateAnswer(answer, false, false).text
      let completeCount = 0
      for (const match of isolated.matchAll(/(?<![\p{L}\p{N}_.+-])[+-]?\d+(?![\p{L}\p{N}_.+-])/gu)) {
        if (match.index + match[0].length < isolated.length) {
          completeCount += 1
          if (completeCount > maximum)
            return new ModelTestOutputLimitError({
              kind: 'integers',
              maximum,
              actual: maximum + 1,
              position: match.index + match[0].length
            })
        }
      }
    }
    return undefined
  }
}
