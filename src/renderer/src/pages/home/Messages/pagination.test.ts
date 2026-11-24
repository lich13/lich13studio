import type { Message } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { deriveTopicDisplayWindow } from './pagination'

const makeMsg = (id: string, role: 'user' | 'assistant', askId?: string): Message =>
  ({
    id,
    role,
    askId,
    assistantId: 'a1',
    topicId: 't1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    blocks: []
  }) as Message

describe('deriveTopicDisplayWindow', () => {
  it('handles empty messages and non-positive target counts safely', () => {
    expect(deriveTopicDisplayWindow([], 20)).toEqual({
      displayMessages: [],
      hasMore: false
    })

    const messages = [makeMsg('u1', 'user'), makeMsg('a1', 'assistant', 'u1')]
    expect(deriveTopicDisplayWindow(messages, 0)).toEqual({
      displayMessages: [],
      hasMore: true
    })
  })

  it('returns tail window and accurate hasMore flag across pagination increments', () => {
    const messages = [
      makeMsg('u1', 'user'),
      makeMsg('a1', 'assistant', 'u1'),
      makeMsg('u2', 'user'),
      makeMsg('a2', 'assistant', 'u2'),
      makeMsg('u3', 'user'),
      makeMsg('a3', 'assistant', 'u3')
    ]

    const firstPage = deriveTopicDisplayWindow(messages, 2)
    expect(firstPage.displayMessages.map((m) => m.id)).toEqual(['u3', 'a3'])
    expect(firstPage.hasMore).toBe(true)

    const secondPage = deriveTopicDisplayWindow(messages, 4)
    expect(secondPage.displayMessages.map((m) => m.id)).toEqual(['u2', 'a2', 'u3', 'a3'])
    expect(secondPage.hasMore).toBe(true)

    const allPages = deriveTopicDisplayWindow(messages, 6)
    expect(allPages.displayMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
    expect(allPages.hasMore).toBe(false)
  })

  it('keeps multi-model assistant responses with the same askId grouped together', () => {
    const messages = [
      makeMsg('u1', 'user'),
      makeMsg('a1', 'assistant', 'u1'),
      makeMsg('u2', 'user'),
      makeMsg('a2-modelA', 'assistant', 'u2'),
      makeMsg('a2-modelB', 'assistant', 'u2')
    ]

    const window1 = deriveTopicDisplayWindow(messages, 1)
    expect(window1.displayMessages.map((m) => m.id)).toEqual(['a2-modelA', 'a2-modelB'])
    expect(window1.hasMore).toBe(true)

    const window2 = deriveTopicDisplayWindow(messages, 2)
    expect(window2.displayMessages.map((m) => m.id)).toEqual(['u2', 'a2-modelA', 'a2-modelB'])
    expect(window2.hasMore).toBe(true)
  })
})
