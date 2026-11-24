import type { Message } from '@renderer/types/newMessage'

export interface TopicDisplayWindow {
  displayMessages: Message[]
  hasMore: boolean
}

export function deriveTopicDisplayWindow(messages: readonly Message[], targetCount: number): TopicDisplayWindow {
  if (messages.length === 0) {
    return { displayMessages: [], hasMore: false }
  }

  if (targetCount <= 0) {
    return { displayMessages: [], hasMore: true }
  }

  const userIdSet = new Set<string>()
  const assistantIdSet = new Set<string>()
  const reversedSelection: Message[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) {
      continue
    }

    const isUser = message.role === 'user'
    const idSet = isUser ? userIdSet : assistantIdSet
    const groupKey = isUser ? message.id : (message.askId ?? message.id)

    if (!idSet.has(groupKey)) {
      if (userIdSet.size + assistantIdSet.size >= targetCount) {
        break
      }
      idSet.add(groupKey)
    }

    reversedSelection.push(message)
  }

  const displayMessages = reversedSelection.toReversed()
  return {
    displayMessages,
    hasMore: displayMessages.length < messages.length
  }
}
