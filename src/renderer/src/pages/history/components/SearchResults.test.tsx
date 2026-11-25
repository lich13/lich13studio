// @vitest-environment jsdom
import type { Topic } from '@renderer/types'
import { type Message, type MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: null as any,
  storeTopicsMap: new Map<string, Topic>()
}))

vi.mock('@renderer/databases', () => ({
  get default() {
    return mocks.db
  }
}))
vi.mock('@renderer/hooks/useScrollPosition', () => ({
  default: () => ({ handleScroll: vi.fn(), containerRef: { current: { scrollTo: vi.fn() } } })
}))
vi.mock('@renderer/components/Icons', () => ({ LoadingIcon: () => null }))
vi.mock('@renderer/store/assistants', () => ({ selectTopicsMap: () => mocks.storeTopicsMap }))
vi.mock('react-redux', () => ({ useSelector: (selector: () => unknown) => selector() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)
  })
}))
vi.mock('antd', () => ({
  Spin: ({ children }: { children: unknown }) => createElement('div', null, children as any),
  Segmented: ({
    options,
    onChange,
    value
  }: {
    options: Array<{ label: string; value: string }>
    onChange: (val: string) => void
    value: string
  }) =>
    createElement(
      'div',
      null,
      options.map((opt) =>
        createElement(
          'button',
          {
            key: opt.value,
            type: 'button',
            'data-value': opt.value,
            'data-active': String(opt.value === value),
            onClick: () => onChange(opt.value)
          },
          opt.label
        )
      )
    ),
  List: Object.assign(
    ({ dataSource, renderItem }: { dataSource: any[]; renderItem: (item: any) => any }) =>
      createElement(
        'div',
        { 'data-count': dataSource.length },
        dataSource.slice(0, 3).map((item, idx) => createElement('div', { key: idx }, renderItem(item)))
      ),
    {
      Item: ({ children }: { children: unknown }) => createElement('div', null, children as any)
    }
  ),
  Typography: {
    Text: ({ children }: { children: unknown }) => createElement('span', null, children as any),
    Title: ({ children, onClick }: { children: unknown; onClick?: () => void }) =>
      createElement('h5', { onClick }, children as any)
  }
}))

import SearchResults, {
  MAX_SEARCH_RESULTS,
  scanHistoryMatches,
  selectAndHydrateTopSearchResults
} from './SearchResults'

function createFakeSearchDb(blocks: MessageBlock[], topicRows: Array<{ id: string; messages: Message[] }>) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]))
  const bulkGetCalls: string[][] = []

  const makeCollection = <T,>(items: T[]) => ({
    until(stopPredicate: () => boolean) {
      return {
        async each(callback: (item: T) => void) {
          for (const item of items) {
            if (stopPredicate()) break
            callback(item)
          }
        }
      }
    }
  })

  return {
    bulkGetCalls,
    database: {
      message_blocks: {
        toCollection: () => makeCollection(blocks),
        bulkGet: vi.fn(async (ids: string[]) => {
          bulkGetCalls.push(ids)
          return ids.map((id) => blockMap.get(id))
        })
      },
      topics: {
        toCollection: () => makeCollection(topicRows)
      }
    } as any
  }
}

describe('SearchResults global scan, sorting, and top-K snippet hydration', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('scans >200 matches without retaining content, reports true total count, sorts globally by createdAt, and hydrates only top MAX_SEARCH_RESULTS', async () => {
    const topic: Topic = {
      id: 'topic-1',
      assistantId: 'assistant-1',
      name: 'Search Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const storeTopicsMap = new Map<string, Topic>([['topic-1', topic]])

    const totalValidMatches = 250
    const blocks: MessageBlock[] = []
    const messages: Message[] = []

    for (let index = 0; index < totalValidMatches; index += 1) {
      const messageId = `msg-${String(index).padStart(4, '0')}`
      const blockId = `blk-${String(index).padStart(4, '0')}`
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString()

      messages.push({
        id: messageId,
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt,
        status: 'success' as any,
        blocks: [blockId]
      })
      blocks.push({
        id: blockId,
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: `Line before\nNeedleKeyword match #${index} payload\nLine after`,
        createdAt,
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock)
    }

    blocks.push(
      {
        id: 'blk-orphan',
        messageId: 'msg-missing',
        type: MessageBlockType.MAIN_TEXT,
        content: 'NeedleKeyword in deleted message',
        createdAt: '2026-06-01T00:00:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-thinking',
        messageId: messages[0].id,
        type: MessageBlockType.THINKING,
        content: 'NeedleKeyword in thinking block',
        createdAt: '2026-06-01T00:00:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock
    )

    const { database, bulkGetCalls } = createFakeSearchDb(blocks, [{ id: 'topic-1', messages }])

    const scanned = await scanHistoryMatches({
      database,
      keywords: 'NeedleKeyword',
      matchMode: 'whole-word',
      storeTopicsMap,
      isCancelled: () => false
    })

    expect(scanned).not.toBeNull()
    expect(scanned!.candidates).toHaveLength(totalValidMatches)
    for (const candidate of scanned!.candidates) {
      expect(candidate).not.toHaveProperty('content')
    }
    expect(bulkGetCalls).toHaveLength(0)

    const newestResults = await selectAndHydrateTopSearchResults({
      database,
      candidates: scanned!.candidates,
      terms: scanned!.terms,
      matchMode: 'whole-word',
      sortOrder: 'newest',
      isCancelled: () => false
    })

    expect(newestResults).toHaveLength(MAX_SEARCH_RESULTS)
    expect(bulkGetCalls).toHaveLength(1)
    expect(bulkGetCalls[0]).toHaveLength(MAX_SEARCH_RESULTS)
    expect(newestResults![0].message.id).toBe('msg-0249')
    expect(newestResults![0].snippet).toContain('NeedleKeyword match #249')
    expect(newestResults![MAX_SEARCH_RESULTS - 1].message.id).toBe('msg-0050')
    expect(newestResults![0]).not.toHaveProperty('content')

    const oldestResults = await selectAndHydrateTopSearchResults({
      database,
      candidates: scanned!.candidates,
      terms: scanned!.terms,
      matchMode: 'whole-word',
      sortOrder: 'oldest',
      isCancelled: () => false
    })

    expect(oldestResults).toHaveLength(MAX_SEARCH_RESULTS)
    expect(bulkGetCalls).toHaveLength(2)
    expect(oldestResults![0].message.id).toBe('msg-0000')
    expect(oldestResults![0].snippet).toContain('NeedleKeyword match #0')
    expect(oldestResults![MAX_SEARCH_RESULTS - 1].message.id).toBe('msg-0199')
  })

  it('renders true total count >200 in SearchResults component and re-hydrates globally oldest slice on sort toggle', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const topic: Topic = {
      id: 'topic-ui',
      assistantId: 'assistant-1',
      name: 'UI Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.storeTopicsMap = new Map([['topic-ui', topic]])

    const blocks: MessageBlock[] = []
    const messages: Message[] = []
    for (let index = 0; index < 210; index += 1) {
      const messageId = `ui-msg-${String(index).padStart(4, '0')}`
      const blockId = `ui-blk-${String(index).padStart(4, '0')}`
      const createdAt = new Date(Date.UTC(2026, 1, 1, 0, index, 0)).toISOString()
      messages.push({
        id: messageId,
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-ui',
        createdAt,
        status: 'success' as any,
        blocks: [blockId]
      })
      blocks.push({
        id: blockId,
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: `TokenAlpha item-${index}`,
        createdAt,
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock)
    }

    const { database } = createFakeSearchDb(blocks, [{ id: 'topic-ui', messages }])
    mocks.db = database

    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'TokenAlpha',
          onMessageClick: vi.fn(),
          onTopicClick: vi.fn()
        })
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(container.textContent).toContain('"count":210')
    expect(container.querySelector('[data-count]')?.getAttribute('data-count')).toBe('200')
    expect(container.textContent).toContain('item-209')

    const oldestBtn = container.querySelector('button[data-value="oldest"]') as HTMLButtonElement
    expect(oldestBtn).not.toBeNull()

    await act(async () => {
      oldestBtn.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('"count":210')
    expect(container.textContent).toContain('item-0')

    await act(async () => {
      root.unmount()
    })
  })

  it('aborts scan cleanly when search sequence is superseded and handles empty keywords', async () => {
    const { database } = createFakeSearchDb(
      [
        {
          id: 'blk-1',
          messageId: 'msg-1',
          type: MessageBlockType.MAIN_TEXT,
          content: 'alpha beta',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: MessageBlockStatus.SUCCESS
        } as MessageBlock
      ],
      []
    )

    const empty = await scanHistoryMatches({
      database,
      keywords: '   ',
      matchMode: 'whole-word',
      storeTopicsMap: new Map(),
      isCancelled: () => false
    })
    expect(empty).toEqual({ terms: [], candidates: [] })

    const cancelled = await scanHistoryMatches({
      database,
      keywords: 'alpha',
      matchMode: 'whole-word',
      storeTopicsMap: new Map(),
      isCancelled: () => true
    })
    expect(cancelled).toBeNull()
  })

  it('cancels in-flight scan on unmount and highlights terms without HTML entity corruption', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const topic: Topic = {
      id: 'topic-entity',
      assistantId: 'assistant-1',
      name: 'Entity Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    mocks.storeTopicsMap = new Map([['topic-entity', topic]])

    const message: Message = {
      id: 'msg-entity',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-entity',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success' as any,
      blocks: ['blk-entity']
    }
    const block: MessageBlock = {
      id: 'blk-entity',
      messageId: 'msg-entity',
      type: MessageBlockType.MAIN_TEXT,
      content: 'Say "hello" & check quot token in a&b',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: MessageBlockStatus.SUCCESS
    } as MessageBlock

    const { database } = createFakeSearchDb([block], [{ id: 'topic-entity', messages: [message] }])
    mocks.db = database

    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'quot',
          onMessageClick: vi.fn(),
          onTopicClick: vi.fn()
        })
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    const marks = Array.from(container.querySelectorAll('mark')).map((el) => el.textContent)
    expect(marks).toEqual(['quot'])
    expect(container.textContent).toContain('Say "hello" & check quot token in a&b')

    let scanObservedCancelled = false
    mocks.db = {
      message_blocks: {
        toCollection: () => ({
          until: (stopPredicate: () => boolean) => ({
            each: () =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  scanObservedCancelled = stopPredicate()
                  resolve()
                }, 50)
              })
          })
        }),
        bulkGet: vi.fn(async () => [])
      },
      topics: {
        toCollection: () => ({
          until: () => ({ each: async () => {} })
        })
      }
    }

    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'slow-query',
          onMessageClick: vi.fn(),
          onTopicClick: vi.fn()
        })
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(210)
    })

    await act(async () => {
      root.unmount()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(scanObservedCancelled).toBe(true)
  })

  it('matches keywords split across inline Markdown or HTML delimiters without false negatives', async () => {
    const topic: Topic = {
      id: 'topic-md',
      assistantId: 'assistant-1',
      name: 'Markdown Split Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const storeTopicsMap = new Map<string, Topic>([['topic-md', topic]])
    const messages: Message[] = [1, 2, 3].map((n) => ({
      id: `msg-md-${n}`,
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-md',
      createdAt: `2026-01-01T00:0${n}:00.000Z`,
      status: 'success' as any,
      blocks: [`blk-md-${n}`]
    }))
    const blocks: MessageBlock[] = [
      {
        id: 'blk-md-1',
        messageId: 'msg-md-1',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Split bold foo**bar** token',
        createdAt: '2026-01-01T00:01:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-md-2',
        messageId: 'msg-md-2',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Split link [foo](https://example.invalid)bar token',
        createdAt: '2026-01-01T00:02:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-md-3',
        messageId: 'msg-md-3',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Unrelated plain paragraph without match',
        createdAt: '2026-01-01T00:03:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock
    ]

    const { database } = createFakeSearchDb(blocks, [{ id: 'topic-md', messages }])
    const scanned = await scanHistoryMatches({
      database,
      keywords: 'foobar',
      matchMode: 'whole-word',
      storeTopicsMap,
      isCancelled: () => false
    })

    expect(scanned?.candidates.map((c) => c.blockId)).toEqual(['blk-md-1', 'blk-md-2'])
  })
})
