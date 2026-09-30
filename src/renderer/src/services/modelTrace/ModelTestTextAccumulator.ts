import { type Chunk, ChunkType } from '@renderer/types/chunk'

import { isolateAnswer } from './outputValidation'

/**
 * Normalizes provider text events before validation. AI SDK normally emits
 * deltas, while a few gateways expose cumulative snapshots through the same
 * callback. Keeping this boundary explicit prevents a snapshot from being
 * appended as a second answer.
 */
export class ModelTestTextAccumulator {
  private blocks: string[] = []
  private current = ''
  private blockOpen = false
  private finalText?: string
  private terminal = false
  private normalCompletion = false
  private excludedBlock = false
  private excludedAnyBlock = false
  error?: unknown

  accept(chunk: Chunk): void {
    if (chunk.type === ChunkType.ERROR) {
      this.error = chunk.error
      this.terminal = true
      return
    }
    if (this.terminal) return

    switch (chunk.type) {
      case ChunkType.TEXT_START:
        if (this.blockOpen) this.blocks.push(this.current)
        this.current = ''
        this.blockOpen = true
        this.excludedBlock = Object.values(chunk.providerMetadata || {}).some(
          (metadata) => (metadata as { phase?: string })?.phase === 'commentary'
        )
        this.excludedAnyBlock ||= this.excludedBlock
        break
      case ChunkType.TEXT_DELTA:
        if (this.excludedBlock) break
        this.blockOpen = true
        this.current = chunk.textMode === 'cumulative' ? this.replaceSnapshot(chunk.text) : this.current + chunk.text
        break
      case ChunkType.TEXT_COMPLETE:
        if (
          Object.values(chunk.providerMetadata || {}).some(
            (metadata) => (metadata as { phase?: string })?.phase === 'commentary'
          )
        )
          this.excludedBlock = true
        if (this.excludedBlock) {
          this.excludedAnyBlock = true
          this.current = ''
          this.blockOpen = false
          break
        }
        // A repeated text-end is a duplicate snapshot, not a new block.
        if (!this.blockOpen && this.blocks.length > 0) break
        this.blocks.push(chunk.text)
        this.current = ''
        this.blockOpen = false
        break
      case ChunkType.LLM_RESPONSE_COMPLETE:
        this.finalText = this.excludedAnyBlock ? this.rawText : (chunk.response?.text ?? this.rawText)
        this.normalCompletion = !chunk.finishReason || ['stop', 'length', 'content-filter'].includes(chunk.finishReason)
        this.terminal = true
        break
      default:
        break
    }
  }

  private replaceSnapshot(next: string): string {
    // A cumulative event is authoritative for the current text block. It is
    // replaced in place rather than appended, even when a gateway emits a
    // shorter correction snapshot.
    return next
  }

  get completed(): boolean {
    return this.terminal && this.normalCompletion && this.error === undefined
  }

  get rawText(): string {
    return this.finalText ?? [...this.blocks, this.current].join('')
  }

  get preview(): string {
    return isolateAnswer(this.rawText, false).text
  }

  previewUpTo(maxBytes: number): string {
    const text = this.preview
    if (new TextEncoder().encode(text).byteLength <= maxBytes) return text
    let end = Math.min(text.length, maxBytes)
    while (end > 0 && new TextEncoder().encode(text.slice(0, end)).byteLength > maxBytes) end -= 1
    return `${text.slice(0, end)}\n...`
  }
}
