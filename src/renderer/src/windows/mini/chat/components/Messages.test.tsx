// @vitest-environment jsdom
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messages: [] as Message[]
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: any) => createElement('div', props, children)
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
  useTopicMessages: () => mocks.messages
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)
  })
}))

vi.mock('./Message', () => ({
  default: ({ message }: { message: Message }) =>
    createElement('div', { 'data-testid': 'mini-message-item' }, message.id)
}))

import ChatWindow from '../ChatWindow'

const fixtureAssistant: Assistant = {
  id: 'default-assistant',
  name: 'Default Assistant',
  prompt: '',
  topics: [],
  type: 'assistant',
  model: {
    id: 'gpt-5.6-sol',
    name: 'gpt-5.6-sol',
    provider: 'openai',
    group: 'OpenAI'
  }
}

const fixtureTopic: Topic = {
  id: 'topic-mini',
  assistantId: 'default-assistant',
  name: 'Mini Window',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
}

describe('MiniWindow ChatWindow & Messages empty state and lazy message items', () => {
  afterEach(() => {
    mocks.messages = []
    vi.unstubAllGlobals()
  })

  it('renders EmptyState synchronously when idle with no messages and lazy-renders MessageItem when messages arrive', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ChatWindow, {
          assistant: fixtureAssistant,
          topic: fixtureTopic,
          isOutputted: false,
          isLoading: false,
          hasError: false
        })
      )
    })

    expect(container.querySelector('#messages')).not.toBeNull()
    expect(container.textContent).toContain('miniwindow.header.default_assistant')
    expect(container.textContent).toContain('gpt-5.6-sol')

    mocks.messages = [
      {
        id: 'msg-mini-1',
        role: 'assistant',
        assistantId: 'default-assistant',
        topicId: 'topic-mini',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success' as any,
        blocks: []
      }
    ]

    await act(async () => {
      root.render(
        createElement(ChatWindow, {
          assistant: fixtureAssistant,
          topic: fixtureTopic,
          isOutputted: true,
          isLoading: false,
          hasError: false
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    expect(container.querySelector('[data-testid="mini-message-item"]')?.textContent).toBe('msg-mini-1')

    await act(async () => {
      root.unmount()
    })
  })
})
