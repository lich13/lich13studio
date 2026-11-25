import { loggerService } from '@logger'
import type { AppDispatch, RootState } from '@renderer/store'
import { updateOneBlock, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

const logger = loggerService.withContext('BlockManager')

interface ActiveBlockInfo {
  id: string
  type: MessageBlockType
}

interface BlockManagerDependencies {
  dispatch: AppDispatch
  getState: () => RootState
  saveUpdatedBlockToDB: (
    blockId: string | null,
    messageId: string,
    topicId: string,
    getState: () => RootState
  ) => Promise<void>
  saveUpdatesToDB: (
    messageId: string,
    topicId: string,
    messageUpdates: Partial<any>,
    blocksToUpdate: MessageBlock[]
  ) => Promise<void>
  assistantMsgId: string
  topicId: string
  // 节流器管理从外部传入
  throttledBlockUpdate: (id: string, blockUpdate: any) => void
  cancelThrottledBlockUpdate: (id: string) => void
}

export class BlockManager {
  private deps: BlockManagerDependencies

  // 简化后的状态管理
  private _activeBlockInfo: ActiveBlockInfo | null = null
  private _lastBlockType: MessageBlockType | null = null // 保留用于错误处理

  constructor(dependencies: BlockManagerDependencies) {
    this.deps = dependencies
  }

  // Getters
  get activeBlockInfo() {
    return this._activeBlockInfo
  }

  get lastBlockType() {
    return this._lastBlockType
  }

  get hasInitialPlaceholder() {
    return this._activeBlockInfo?.type === MessageBlockType.UNKNOWN
  }

  get initialPlaceholderBlockId() {
    return this.hasInitialPlaceholder ? this._activeBlockInfo?.id || null : null
  }

  // Setters
  set lastBlockType(value: MessageBlockType | null) {
    this._lastBlockType = value
  }

  set activeBlockInfo(value: ActiveBlockInfo | null) {
    this._activeBlockInfo = value
  }

  /**
   * 智能更新策略：根据块类型连续性自动判断使用节流还是立即更新
   */
  smartBlockUpdate(
    blockId: string,
    changes: Partial<MessageBlock>,
    blockType: MessageBlockType,
    isComplete: boolean = false
  ) {
    const isBlockTypeChanged = this._lastBlockType !== null && this._lastBlockType !== blockType
    if (isBlockTypeChanged || isComplete) {
      // 如果块类型改变且切换到新块，先冲刷并持久化上一个活跃块的挂起更新
      if (isBlockTypeChanged && this._activeBlockInfo && this._activeBlockInfo.id !== blockId) {
        const prevBlockId = this._activeBlockInfo.id
        this.deps.cancelThrottledBlockUpdate(prevBlockId)
        void this.deps.saveUpdatedBlockToDB(
          prevBlockId,
          this.deps.assistantMsgId,
          this.deps.topicId,
          this.deps.getState
        )
      }
      // 同步冲刷当前块的挂起 Redux 增量并取消 DB 节流定时器
      this.deps.cancelThrottledBlockUpdate(blockId)
      if (isComplete) {
        this._activeBlockInfo = null // 块完成时清空activeBlockInfo
      } else {
        this._activeBlockInfo = { id: blockId, type: blockType } // 更新活跃块信息
      }
      this.deps.dispatch(updateOneBlock({ id: blockId, changes }))
      void this.deps.saveUpdatedBlockToDB(blockId, this.deps.assistantMsgId, this.deps.topicId, this.deps.getState)
      this._lastBlockType = blockType
    } else {
      this._activeBlockInfo = { id: blockId, type: blockType } // 更新活跃块信息
      this._lastBlockType = blockType
      this.deps.throttledBlockUpdate(blockId, changes)
    }
  }

  /**
   * 处理块转换
   */
  async handleBlockTransition(newBlock: MessageBlock, newBlockType: MessageBlockType) {
    logger.debug('handleBlockTransition', { newBlock, newBlockType })
    if (this._activeBlockInfo && this._activeBlockInfo.id !== newBlock.id) {
      const prevBlockId = this._activeBlockInfo.id
      this.deps.cancelThrottledBlockUpdate(prevBlockId)
      await this.deps.saveUpdatedBlockToDB(prevBlockId, this.deps.assistantMsgId, this.deps.topicId, this.deps.getState)
    }
    this._lastBlockType = newBlockType
    this._activeBlockInfo = { id: newBlock.id, type: newBlockType } // 设置新的活跃块信息

    this.deps.dispatch(
      newMessagesActions.updateMessage({
        topicId: this.deps.topicId,
        messageId: this.deps.assistantMsgId,
        updates: { blockInstruction: { id: newBlock.id } }
      })
    )
    this.deps.dispatch(upsertOneBlock(newBlock))
    this.deps.dispatch(
      newMessagesActions.upsertBlockReference({
        messageId: this.deps.assistantMsgId,
        blockId: newBlock.id,
        status: newBlock.status,
        blockType: newBlock.type
      })
    )

    const currentState = this.deps.getState()
    const updatedMessage = currentState.messages.entities[this.deps.assistantMsgId]
    if (updatedMessage) {
      await this.deps.saveUpdatesToDB(this.deps.assistantMsgId, this.deps.topicId, { blocks: updatedMessage.blocks }, [
        newBlock
      ])
    } else {
      logger.error(
        `[handleBlockTransition] Failed to get updated message ${this.deps.assistantMsgId} from state for DB save.`
      )
    }
  }
}
