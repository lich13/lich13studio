import type { Message, MessageBlock } from '@renderer/types/newMessage'

export interface MessageDataSource {
  fetchMessages(
    topicId: string,
    forceReload?: boolean
  ): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }>
  getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined>
  appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void>
  updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void>
  updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void>
  deleteMessage(topicId: string, messageId: string): Promise<void>
  deleteMessages(topicId: string, messageIds: string[]): Promise<void>
  updateBlocks(blocks: MessageBlock[]): Promise<void>
  updateSingleBlock?(blockId: string, updates: Partial<MessageBlock>): Promise<void>
  bulkAddBlocks?(blocks: MessageBlock[]): Promise<void>
  deleteBlocks(blockIds: string[]): Promise<void>
  clearMessages(topicId: string): Promise<void>
  topicExists(topicId: string): Promise<boolean>
  ensureTopic(topicId: string): Promise<void>
  updateFileCount?(fileId: string, delta: number, deleteIfZero?: boolean): Promise<void>
  updateFileCounts?(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void>
}
