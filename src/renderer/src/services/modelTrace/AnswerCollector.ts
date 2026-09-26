import { type Chunk, ChunkType } from '@renderer/types/chunk'

import { isolateAnswer } from './outputValidation'

/** Collect delta-mode text; complete events are snapshots, never more deltas. */
export class AnswerCollector {
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
        this.current += chunk.text
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
        // A repeated text-end must not duplicate the last completed block.
        if (!this.blockOpen && this.blocks.length > 0) break
        this.blocks.push(chunk.text)
        this.current = ''
        this.blockOpen = false
        break
      case ChunkType.LLM_RESPONSE_COMPLETE:
        // The global snapshot may include commentary that we deliberately excluded.
        this.finalText = this.excludedAnyBlock ? this.rawText : (chunk.response?.text ?? this.rawText)
        this.normalCompletion = !chunk.finishReason || chunk.finishReason === 'stop'
        this.terminal = true
        break
      default:
        // Native reasoning, tools and metadata never become answer text.
        break
    }
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
}
