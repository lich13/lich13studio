import { loggerService } from '@logger'
import db from '@renderer/databases'
import store from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import type { MessageDataSource } from './types'

const logger = loggerService.withContext('DexieMessageDataSource')

export interface FileCountDeltaSpec {
  delta: number
  deleteIfZero: boolean
}

export function collectBlockFileDecrements(blocks: readonly MessageBlock[]): Map<string, FileCountDeltaSpec> {
  const deltas = new Map<string, FileCountDeltaSpec>()
  for (const block of blocks) {
    if (block.type !== 'file' && block.type !== 'image') {
      continue
    }
    const file = (block as { file?: { id?: string } }).file
    if (!file?.id) {
      continue
    }
    const existing = deltas.get(file.id)
    deltas.set(file.id, {
      delta: (existing?.delta ?? 0) - 1,
      deleteIfZero: true
    })
  }
  return deltas
}

export interface ApplyFileCountDeltasOptions {
  messageBlocksTable?: Pick<typeof db.message_blocks, 'where'>
  excludingBlockIds?: Iterable<string>
}

export async function applyFileCountDeltasInTx(
  filesTable: typeof db.files,
  deltas: ReadonlyMap<string, FileCountDeltaSpec>,
  options?: ApplyFileCountDeltasOptions
): Promise<string[]> {
  if (deltas.size === 0) {
    return []
  }

  const fileIds = Array.from(deltas.keys())
  const records = await filesTable.bulkGet(fileIds)
  const idsToDelete: string[] = []
  const attachmentsToDelete: string[] = []
  const zeroCandidates: Array<{ fileId: string; record: NonNullable<(typeof records)[number]>; nextCount: number }> = []

  for (let index = 0; index < fileIds.length; index += 1) {
    const fileId = fileIds[index]
    const spec = deltas.get(fileId)!
    const record = records[index]
    if (!record) {
      logger.warn(`File ${fileId} not found for count update`)
      continue
    }

    const nextCount = (record.count || 0) + spec.delta
    if (nextCount <= 0 && spec.deleteIfZero) {
      zeroCandidates.push({ fileId, record, nextCount })
    } else {
      const clampedCount = Math.max(0, nextCount)
      await filesTable.update(fileId, { count: clampedCount })
      logger.debug(`Updated file ${fileId} count to ${clampedCount}`)
    }
  }

  if (zeroCandidates.length > 0) {
    const messageBlocksTable = options?.messageBlocksTable ?? (filesTable === db.files ? db.message_blocks : undefined)
    const survivingCounts = new Map<string, number>()

    if (messageBlocksTable) {
      const excludedIds = options?.excludingBlockIds ? new Set(options.excludingBlockIds) : undefined
      const referencingBlocks = await messageBlocksTable
        .where('file.id')
        .anyOf(zeroCandidates.map((item) => item.fileId))
        .toArray()
      for (const block of referencingBlocks) {
        if (excludedIds?.has(block.id)) {
          continue
        }
        const refFileId = (block as { file?: { id?: string } }).file?.id
        if (refFileId) {
          survivingCounts.set(refFileId, (survivingCounts.get(refFileId) ?? 0) + 1)
        }
      }
    }

    for (const { fileId, record, nextCount } of zeroCandidates) {
      const survivingCount = survivingCounts.get(fileId) ?? 0
      if (survivingCount > 0) {
        await filesTable.update(fileId, { count: survivingCount })
        logger.info(`Self-healed file ${fileId} reference count to ${survivingCount} surviving block(s)`)
      } else {
        idsToDelete.push(fileId)
        attachmentsToDelete.push(`${record.id}${record.ext}`)
        logger.info(`Deleted file ${fileId} as reference count reached ${nextCount}`)
      }
    }
  }

  if (idsToDelete.length > 0) {
    await filesTable.bulkDelete(idsToDelete)
  }

  return attachmentsToDelete
}

export async function purgeDetachedAttachments(attachmentNames: readonly string[]): Promise<void> {
  if (attachmentNames.length === 0 || typeof window === 'undefined' || !window.api?.file?.delete) {
    return
  }
  const results = await Promise.allSettled(attachmentNames.map((name) => window.api.file.delete(name)))
  const failed = results.filter((item) => item.status === 'rejected')
  if (failed.length > 0) {
    logger.warn(`Attachment cleanup completed with ${failed.length} errors`, failed)
  }
}

/**
 * Dexie-based implementation of MessageDataSource
 * Handles local IndexedDB storage for regular chat messages
 */
export class DexieMessageDataSource implements MessageDataSource {
  // ============ Read Operations ============

  async fetchMessages(topicId: string): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }> {
    try {
      const topic = await db.topics.get(topicId)
      if (!topic) {
        await db.topics.add({ id: topicId, messages: [] })
      }
      const messages = topic?.messages || []

      if (messages.length === 0) {
        return { messages: [], blocks: [] }
      }

      const messageIds = messages.map((m) => m.id)
      const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()

      const messagesWithBlockIds = messages.map((m) => ({
        ...m,
        blocks: m.blocks?.map(String) || []
      }))

      return { messages: messagesWithBlockIds, blocks: blocks || [] }
    } catch (error) {
      logger.error(`Failed to fetch messages for topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined> {
    try {
      return await db.topics.get(topicId)
    } catch (error) {
      logger.error(`Failed to get raw topic ${topicId}:`, error as Error)
      throw error
    }
  }

  // ============ Write Operations ============
  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        if (blocks.length > 0) {
          await db.message_blocks.bulkPut(blocks)
        }

        let topic = await db.topics.get(topicId)
        if (!topic) {
          await db.topics.add({ id: topicId, messages: [] })
          topic = await db.topics.get(topicId)
        }

        if (!topic) {
          throw new Error(`Failed to create topic ${topicId}`)
        }

        const updatedMessages = [...(topic.messages || [])]

        const existingIndex = updatedMessages.findIndex((m) => m.id === message.id)
        if (existingIndex !== -1) {
          updatedMessages[existingIndex] = message
        } else if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= updatedMessages.length) {
          updatedMessages.splice(insertIndex, 0, message)
        } else {
          updatedMessages.push(message)
        }

        await db.topics.update(topicId, { messages: updatedMessages })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to append message to topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    try {
      await db.transaction('rw', db.topics, async () => {
        await db.topics
          .where('id')
          .equals(topicId)
          .modify((topic) => {
            if (!topic || !topic.messages) return

            const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
            if (messageIndex !== -1) {
              Object.assign(topic.messages[messageIndex], updates)
            }
          })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to update message ${messageId} in topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        if (blocksToUpdate.length > 0) {
          await db.message_blocks.bulkPut(blocksToUpdate)
        }

        const keysToUpdate = Object.keys(messageUpdates).filter((key) => key !== 'id' && key !== 'topicId')
        if (keysToUpdate.length > 0) {
          await db.topics
            .where('id')
            .equals(topicId)
            .modify((topic) => {
              if (!topic || !topic.messages) return

              const messageIndex = topic.messages.findIndex((m) => m.id === messageUpdates.id)
              if (messageIndex !== -1) {
                keysToUpdate.forEach((key) => {
                  ;(topic.messages[messageIndex] as any)[key] = (messageUpdates as any)[key]
                })
              }
            })
        }
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to update message and blocks for ${messageUpdates.id}:`, error as Error)
      throw error
    }
  }

  async deleteMessage(topicId: string, messageId: string): Promise<void> {
    try {
      let attachmentsToDelete: string[] = []
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
        if (messageIndex === -1) return

        const message = topic.messages[messageIndex]
        const blockIds = message.blocks || []

        if (blockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
          const deltas = collectBlockFileDecrements(blocks)
          attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
            messageBlocksTable: db.message_blocks,
            excludingBlockIds: blockIds
          })
          await db.message_blocks.bulkDelete(blockIds)
        }

        topic.messages.splice(messageIndex, 1)
        await db.topics.update(topicId, { messages: topic.messages })
      })

      await purgeDetachedAttachments(attachmentsToDelete)
      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to delete message ${messageId} from topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async deleteMessages(topicId: string, messageIds: string[]): Promise<void> {
    try {
      let attachmentsToDelete: string[] = []
      const messageIdSet = new Set(messageIds)
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        const allBlockIds: string[] = []
        for (const message of topic.messages) {
          if (messageIdSet.has(message.id) && message.blocks?.length) {
            allBlockIds.push(...message.blocks)
          }
        }

        if (allBlockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(allBlockIds).toArray()
          const deltas = collectBlockFileDecrements(blocks)
          attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
            messageBlocksTable: db.message_blocks,
            excludingBlockIds: allBlockIds
          })
          await db.message_blocks.bulkDelete(allBlockIds)
        }

        const remainingMessages = topic.messages.filter((m) => !messageIdSet.has(m.id))
        await db.topics.update(topicId, { messages: remainingMessages })
      })

      await purgeDetachedAttachments(attachmentsToDelete)
      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to delete messages from topic ${topicId}:`, error as Error)
      throw error
    }
  }

  // ============ Block Operations ============

  async updateBlocks(blocks: MessageBlock[]): Promise<void> {
    try {
      if (blocks.length === 0) return
      await db.message_blocks.bulkPut(blocks)
    } catch (error) {
      logger.error('Failed to update blocks:', error as Error)
      throw error
    }
  }

  async updateSingleBlock(blockId: string, updates: Partial<MessageBlock>): Promise<void> {
    try {
      await db.message_blocks.update(blockId, updates)
    } catch (error) {
      logger.error(`Failed to update block ${blockId}:`, error as Error)
      throw error
    }
  }

  async bulkAddBlocks(blocks: MessageBlock[]): Promise<void> {
    try {
      if (blocks.length === 0) return
      await db.message_blocks.bulkAdd(blocks)
    } catch (error) {
      logger.error('Failed to bulk add blocks:', error as Error)
      throw error
    }
  }

  async deleteBlocks(blockIds: string[]): Promise<void> {
    try {
      if (blockIds.length === 0) return

      let attachmentsToDelete: string[] = []
      await db.transaction('rw', db.message_blocks, db.files, async () => {
        const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
        const deltas = collectBlockFileDecrements(blocks)
        attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
          messageBlocksTable: db.message_blocks,
          excludingBlockIds: blockIds
        })
        await db.message_blocks.bulkDelete(blockIds)
      })

      await purgeDetachedAttachments(attachmentsToDelete)
    } catch (error) {
      logger.error('Failed to delete blocks:', error as Error)
      throw error
    }
  }

  // ============ Batch Operations ============

  async clearMessages(topicId: string): Promise<void> {
    try {
      let attachmentsToDelete: string[] = []

      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        const blockIds = topic.messages.flatMap((m) => m.blocks || [])
        if (blockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
          const deltas = collectBlockFileDecrements(blocks)
          attachmentsToDelete = await applyFileCountDeltasInTx(db.files, deltas, {
            messageBlocksTable: db.message_blocks,
            excludingBlockIds: blockIds
          })
          await db.message_blocks.bulkDelete(blockIds)
        }

        await db.topics.update(topicId, { messages: [] })
      })

      await purgeDetachedAttachments(attachmentsToDelete)
      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to clear messages for topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async topicExists(topicId: string): Promise<boolean> {
    try {
      const topic = await db.topics.get(topicId)
      return !!topic
    } catch (error) {
      logger.error(`Failed to check if topic ${topicId} exists:`, error as Error)
      return false
    }
  }

  async ensureTopic(topicId: string): Promise<void> {
    try {
      const exists = await this.topicExists(topicId)
      if (!exists) {
        await db.topics.add({ id: topicId, messages: [] })
      }
    } catch (error) {
      logger.error(`Failed to ensure topic ${topicId} exists:`, error as Error)
      throw error
    }
  }

  // ============ File Operations ============

  async updateFileCount(fileId: string, delta: number, deleteIfZero: boolean = false): Promise<void> {
    await this.updateFileCounts([{ id: fileId, delta, deleteIfZero }])
  }

  async updateFileCounts(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void> {
    if (files.length === 0) return
    try {
      const aggregated = new Map<string, FileCountDeltaSpec>()
      for (const item of files) {
        if (!item.id) continue
        const prev = aggregated.get(item.id)
        aggregated.set(item.id, {
          delta: (prev?.delta ?? 0) + item.delta,
          deleteIfZero: Boolean(prev?.deleteIfZero || item.deleteIfZero)
        })
      }

      let attachmentsToDelete: string[] = []
      await db.transaction('rw', db.message_blocks, db.files, async () => {
        attachmentsToDelete = await applyFileCountDeltasInTx(db.files, aggregated, {
          messageBlocksTable: db.message_blocks
        })
      })
      await purgeDetachedAttachments(attachmentsToDelete)
    } catch (error) {
      logger.error('Failed to update file counts:', error as Error)
      throw error
    }
  }
}
