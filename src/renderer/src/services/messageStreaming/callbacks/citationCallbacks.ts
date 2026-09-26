import { loggerService } from '@logger'
import type { ExternalToolResult } from '@renderer/types'
import type { CitationMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCitationBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('CitationCallbacks')

interface CitationCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createCitationCallbacks = (deps: CitationCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let citationBlockId: string | null = null

  return {
    onExternalToolInProgress: async () => {
      // 避免创建重复的引用块
      if (citationBlockId) {
        logger.warn(`[onExternalToolInProgress] Citation block already exists: ${citationBlockId}`)
        return
      }
      const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
      citationBlockId = citationBlock.id
      await blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
    },

    onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
      if (citationBlockId) {
        const changes: Partial<CitationMessageBlock> = {
          knowledge: externalToolResult.knowledge,
          status: MessageBlockStatus.SUCCESS
        }
        blockManager.smartBlockUpdate(citationBlockId, changes, MessageBlockType.CITATION, true)
      } else {
        logger.error('[onExternalToolComplete] citationBlockId is null. Cannot update.')
      }
    },

    // 暴露给外部的方法，用于textCallbacks中获取citationBlockId
    getCitationBlockId: () => citationBlockId,

    // 暴露给外部的方法，用于额外引用块流程设置 citationBlockId
    setCitationBlockId: (blockId: string) => {
      citationBlockId = blockId
    }
  }
}
