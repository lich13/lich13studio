import { getTopicFulfilledActiveTopicId, shouldMarkTopicFulfilled } from '@renderer/utils/topicStatus'
import { describe, expect, it } from 'vitest'

describe('message thunk topic fulfilled state', () => {
  it('does not show an unread marker when the active topic finishes', () => {
    expect(shouldMarkTopicFulfilled('topic-1', 'topic-1')).toBe(false)
  })

  it('shows an unread marker when a background topic finishes', () => {
    expect(shouldMarkTopicFulfilled('topic-2', 'topic-1')).toBe(true)
  })

  it('shows an unread marker when no active topic is known', () => {
    expect(shouldMarkTopicFulfilled('topic-2', null)).toBe(true)
  })

  it('uses the visible active topic over the internal loaded topic when deciding unread state', () => {
    expect(getTopicFulfilledActiveTopicId('visible-topic', 'loaded-background-topic')).toBe('visible-topic')
  })
})
