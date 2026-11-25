import type { Assistant } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./AssistantService', () => ({
  getAssistantSettings: () => ({ contextCount: 10 })
}))

vi.mock('./MessagesService', () => ({
  filterAfterContextClearMessages: (msgs: Message[]) => msgs,
  filterMessages: (msgs: Message[]) => msgs
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  findFileBlocks: () => [],
  getMainTextContent: (msg: Message) => (msg as Message & { mockText?: string }).mockText ?? '',
  getThinkingContent: () => ''
}))

import { estimateMessagesUsage } from './TokenService'

const createMockMessage = (id: string, role: 'user' | 'assistant', text: string): Message =>
  ({
    id,
    role,
    assistantId: 'asst-1',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    blocks: [],
    mockText: text
  }) as unknown as Message

const mockAssistant = {
  id: 'asst-1',
  name: 'Test Assistant',
  prompt: 'System prompt',
  topics: [],
  type: 'chat'
} as unknown as Assistant

describe('TokenService.estimateMessagesUsage', () => {
  it('returns zero usage on empty messages without throwing', async () => {
    const empty: Message[] = []
    const usage = await estimateMessagesUsage({ assistant: mockAssistant, messages: empty })
    expect(usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    })
    expect(empty).toHaveLength(0)
  })

  it('does not mutate caller messages array when estimating usage', async () => {
    const userMsg = createMockMessage('m-1', 'user', 'Explain cursor-based queues')
    const assistantMsg = createMockMessage('m-2', 'assistant', 'A cursor avoids repeated array slicing.')
    const callerMessages = [userMsg, assistantMsg]

    const usage = await estimateMessagesUsage({
      assistant: mockAssistant,
      messages: callerMessages
    })

    expect(callerMessages).toHaveLength(2)
    expect(callerMessages[0]).toBe(userMsg)
    expect(callerMessages[1]).toBe(assistantMsg)
    expect(usage.prompt_tokens).toBeGreaterThan(0)
    expect(usage.completion_tokens).toBeGreaterThan(0)
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens)
  })

  it('invalidates cached history tokens when message content changes to another string of identical length', async () => {
    const asciiSameLen = 'aaaaaaaaaaaa' // 12 ASCII chars
    const cjkSameLen = '中文测试词元计数验证内容' // 12 CJK chars (different token estimate, identical .length === 12)
    expect(asciiSameLen.length).toBe(cjkSameLen.length)

    const tailMsg = createMockMessage('m-tail', 'assistant', 'ok')
    const beforeHistory = createMockMessage('m-same-len', 'user', asciiSameLen)
    const afterHistory = createMockMessage('m-same-len', 'user', cjkSameLen)

    const first = await estimateMessagesUsage({
      assistant: mockAssistant,
      messages: [beforeHistory, tailMsg]
    })
    const second = await estimateMessagesUsage({
      assistant: mockAssistant,
      messages: [afterHistory, tailMsg]
    })

    expect(second.prompt_tokens).not.toBe(first.prompt_tokens)
  })
})
