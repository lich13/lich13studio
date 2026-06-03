import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { getBatchTopicDeleteResult } from './TopicManageMode.helpers'

const topic = (id: string, name = id): Topic =>
  ({
    id,
    name,
    assistantId: 'assistant-1',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z'
  }) as Topic

describe('TopicManageMode batch delete helpers', () => {
  it('blocks deleting every topic', () => {
    const result = getBatchTopicDeleteResult([topic('a')], new Set(['a']), 'a')

    expect(result.canDelete).toBe(false)
    expect(result.remainingTopics).toEqual([])
    expect(result.nextActiveTopic).toBeUndefined()
  })

  it('blocks updating topics when actual successful deletes would remove every topic', () => {
    const result = getBatchTopicDeleteResult([topic('a'), topic('b')], new Set(['a', 'b']), 'a')

    expect(result.canDelete).toBe(false)
    expect(result.remainingTopics).toEqual([])
    expect(result.nextActiveTopic).toBeUndefined()
  })

  it('returns remaining topics and switches active topic when the active topic is deleted', () => {
    const remaining = topic('b')
    const result = getBatchTopicDeleteResult([topic('a'), remaining, topic('c')], new Set(['a', 'c']), 'a')

    expect(result.canDelete).toBe(true)
    expect(result.remainingTopics).toEqual([remaining])
    expect(result.nextActiveTopic).toBe(remaining)
  })

  it('keeps the active topic when it is not deleted', () => {
    const active = topic('b')
    const result = getBatchTopicDeleteResult([topic('a'), active, topic('c')], new Set(['a']), 'b')

    expect(result.canDelete).toBe(true)
    expect(result.remainingTopics).toEqual([active, topic('c')])
    expect(result.nextActiveTopic).toBeUndefined()
  })
})
