import type { Chunk } from '@renderer/types/chunk'

import { ModelTestTextAccumulator } from './ModelTestTextAccumulator'

export class AnswerCollector extends ModelTestTextAccumulator {
  accept(chunk: Chunk): void {
    super.accept(chunk)
  }
}
