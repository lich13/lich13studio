import { loggerService } from '@logger'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createThinkingBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ThinkingCallbacks')
interface ThinkingCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createThinkingCallbacks = (deps: ThinkingCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let thinkingBlockId: string | null = null
  let thinkingSegmentStartedAt: number = 0
  let accumulatedThinkingMillis: number = 0
  let completedThinkingContent = ''

  const joinThinkingContent = (existingContent: string, nextContent: string) => {
    if (!existingContent) {
      return nextContent
    }

    if (!nextContent) {
      return existingContent
    }

    if (existingContent.endsWith('\n') || nextContent.startsWith('\n')) {
      return `${existingContent}${nextContent}`
    }

    return `${existingContent}\n\n${nextContent}`
  }

  const getCurrentThinkingMillis = () =>
    accumulatedThinkingMillis + (thinkingSegmentStartedAt > 0 ? performance.now() - thinkingSegmentStartedAt : 0)

  return {
    // 获取当前思考时间（用于停止回复时保留思考时间）
    getCurrentThinkingInfo: () => ({
      blockId: thinkingBlockId,
      millsec: getCurrentThinkingMillis()
    }),

    onThinkingStart: async () => {
      // Set the start time immediately before any async operations to prevent a race condition
      // where onThinkingChunk fires while handleBlockTransition is still awaiting, causing
      // thinking_millsec to be computed as `performance.now() - 0` (a huge value).
      thinkingSegmentStartedAt = performance.now()

      if (blockManager.hasInitialPlaceholder) {
        const changes: Partial<MessageBlock> = {
          type: MessageBlockType.THINKING,
          content: completedThinkingContent,
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: accumulatedThinkingMillis
        }
        thinkingBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
      } else if (!thinkingBlockId) {
        const newBlock = createThinkingBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: 0
        })
        thinkingBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.THINKING)
      } else {
        blockManager.smartBlockUpdate(
          thinkingBlockId,
          {
            content: completedThinkingContent,
            status: MessageBlockStatus.STREAMING,
            thinking_millsec: accumulatedThinkingMillis
          },
          MessageBlockType.THINKING,
          true
        )
      }
    },

    onThinkingChunk: async (text: string) => {
      if (thinkingBlockId) {
        const combinedContent = joinThinkingContent(completedThinkingContent, text)
        const blockChanges: Partial<MessageBlock> = {
          content: combinedContent,
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: getCurrentThinkingMillis()
        }
        blockManager.smartBlockUpdate(thinkingBlockId, blockChanges, MessageBlockType.THINKING)
      }
    },

    onThinkingComplete: (finalText: string) => {
      if (thinkingBlockId) {
        const now = performance.now()
        const elapsed = thinkingSegmentStartedAt > 0 ? now - thinkingSegmentStartedAt : 0
        completedThinkingContent = joinThinkingContent(completedThinkingContent, finalText)
        accumulatedThinkingMillis += elapsed

        const changes: Partial<MessageBlock> = {
          content: completedThinkingContent,
          status: MessageBlockStatus.SUCCESS,
          thinking_millsec: accumulatedThinkingMillis
        }
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
        thinkingSegmentStartedAt = 0
      } else {
        logger.warn(
          `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
