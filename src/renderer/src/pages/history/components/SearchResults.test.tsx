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

  it('sorts multi-term query candidates primarily by createdAtMs (newest/oldest) and uses matchedTermCount only as equal-timestamp tie-breaker', async () => {
    const topic: Topic = {
      id: 'topic-multi',
      assistantId: 'assistant-1',
      name: 'Multi Term Topic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const storeTopicsMap = new Map<string, Topic>([['topic-multi', topic]])
    const messages: Message[] = [
      {
        id: 'msg-older-both',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-multi',
        createdAt: '2026-01-01T00:01:00.000Z',
        status: 'success' as any,
        blocks: ['blk-older-both']
      },
      {
        id: 'msg-tie-single',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-multi',
        createdAt: '2026-01-01T00:05:00.000Z',
        status: 'success' as any,
        blocks: ['blk-tie-single']
      },
      {
        id: 'msg-tie-both',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-multi',
        createdAt: '2026-01-01T00:05:00.000Z',
        status: 'success' as any,
        blocks: ['blk-tie-both']
      },
      {
        id: 'msg-newer-single',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId: 'topic-multi',
        createdAt: '2026-01-01T00:10:00.000Z',
        status: 'success' as any,
        blocks: ['blk-newer-single']
      }
    ]
    const blocks: MessageBlock[] = [
      {
        id: 'blk-older-both',
        messageId: 'msg-older-both',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Contains both alpha and beta terms',
        createdAt: '2026-01-01T00:01:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-tie-single',
        messageId: 'msg-tie-single',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Equal timestamp with alpha only',
        createdAt: '2026-01-01T00:05:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-tie-both',
        messageId: 'msg-tie-both',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Equal timestamp with alpha and beta',
        createdAt: '2026-01-01T00:05:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-newer-single',
        messageId: 'msg-newer-single',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Contains only alpha term',
        createdAt: '2026-01-01T00:10:00.000Z',
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock
    ]

    const { database } = createFakeSearchDb(blocks, [{ id: 'topic-multi', messages }])
    const scanned = await scanHistoryMatches({
      database,
      keywords: 'alpha beta',
      matchMode: 'whole-word',
      storeTopicsMap,
      isCancelled: () => false
    })

    const newestResults = await selectAndHydrateTopSearchResults({
      database,
      candidates: scanned!.candidates,
      terms: scanned!.terms,
      matchMode: 'whole-word',
      sortOrder: 'newest',
      isCancelled: () => false
    })
    expect(newestResults?.map((r) => r.blockId)).toEqual([
      'blk-newer-single',
      'blk-tie-both',
      'blk-tie-single',
      'blk-older-both'
    ])

    // Top-K limit in newest mode keeps newest 1-term hit instead of evicting it behind older multi-term hits
    const newestTopOne = await selectAndHydrateTopSearchResults({
      database,
      candidates: scanned!.candidates,
      terms: scanned!.terms,
      matchMode: 'whole-word',
      sortOrder: 'newest',
      limit: 1,
      isCancelled: () => false
    })
    expect(newestTopOne?.map((r) => r.blockId)).toEqual(['blk-newer-single'])

    const oldestResults = await selectAndHydrateTopSearchResults({
      database,
      candidates: scanned!.candidates,
      terms: scanned!.terms,
      matchMode: 'whole-word',
      sortOrder: 'oldest',
      isCancelled: () => false
    })
    expect(oldestResults?.map((r) => r.blockId)).toEqual([
      'blk-older-both',
      'blk-tie-both',
      'blk-tie-single',
      'blk-newer-single'
    ])
  })

  it('reflects live topic renames immediately without re-scanning and triggers re-scan on equal-size topic replacement', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const topicA: Topic = {
      id: 'topic-live-a',
      assistantId: 'assistant-1',
      name: 'Original Title A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const topicB: Topic = {
      id: 'topic-live-b',
      assistantId: 'assistant-1',
      name: 'Replacement Title B',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: []
    }
    mocks.storeTopicsMap = new Map([['topic-live-a', topicA]])

    const msgA1: Message = {
      id: 'msg-a-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-live-a',
      createdAt: '2026-01-01T00:01:00.000Z',
      status: 'success' as any,
      blocks: ['blk-a-1']
    }
    const msgA2: Message = {
      id: 'msg-a-2',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-live-a',
      createdAt: '2026-01-01T00:02:00.000Z',
      status: 'success' as any,
      blocks: ['blk-a-2']
    }
    const msgB1: Message = {
      id: 'msg-b-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-live-b',
      createdAt: '2026-01-02T00:01:00.000Z',
      status: 'success' as any,
      blocks: ['blk-b-1']
    }
    const blocks: MessageBlock[] = [
      {
        id: 'blk-a-1',
        messageId: 'msg-a-1',
        type: MessageBlockType.MAIN_TEXT,
        content: 'SharedKeyword older in topic A',
        createdAt: msgA1.createdAt,
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-a-2',
        messageId: 'msg-a-2',
        type: MessageBlockType.MAIN_TEXT,
        content: 'SharedKeyword newer in topic A',
        createdAt: msgA2.createdAt,
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock,
      {
        id: 'blk-b-1',
        messageId: 'msg-b-1',
        type: MessageBlockType.MAIN_TEXT,
        content: 'SharedKeyword inside replacement topic B',
        createdAt: msgB1.createdAt,
        status: MessageBlockStatus.SUCCESS
      } as MessageBlock
    ]

    const { database, bulkGetCalls } = createFakeSearchDb(blocks, [
      { id: 'topic-live-a', messages: [msgA1, msgA2] },
      { id: 'topic-live-b', messages: [msgB1] }
    ])
    mocks.db = database

    const onTopicClick = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'SharedKeyword',
          onMessageClick: vi.fn(),
          onTopicClick
        })
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(container.textContent).toContain('Original Title A')
    expect(container.textContent).not.toContain('Replacement Title B')
    expect(bulkGetCalls).toHaveLength(1)

    // 1. Rename topic-live-a while SearchResults stays open: updates title & click target immediately without DB re-scan
    const renamedTopicA: Topic = { ...topicA, name: 'Renamed Live Title A' }
    mocks.storeTopicsMap = new Map([['topic-live-a', renamedTopicA]])
    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'SharedKeyword',
          onMessageClick: vi.fn(),
          onTopicClick
        })
      )
    })

    expect(container.textContent).toContain('Renamed Live Title A')
    expect(container.textContent).not.toContain('Original Title A')
    expect(bulkGetCalls).toHaveLength(1)

    const firstHeading = container.querySelector('h5') as HTMLElement
    act(() => {
      firstHeading.click()
    })
    expect(onTopicClick).toHaveBeenLastCalledWith(renamedTopicA)

    // Toggling sort order preserves the live renamed topic title
    const oldestBtn = container.querySelector('button[data-value="oldest"]') as HTMLButtonElement
    await act(async () => {
      oldestBtn.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Renamed Live Title A')

    // 2. Replace topic-live-a with topic-live-b (equal Map size: 1 -> 1): triggers re-scan and renders topic B
    mocks.storeTopicsMap = new Map([['topic-live-b', topicB]])
    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'SharedKeyword',
          onMessageClick: vi.fn(),
          onTopicClick
        })
      )
    })
    // Deleted topic A disappears immediately on render
    expect(container.textContent).not.toContain('Renamed Live Title A')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(container.textContent).toContain('Replacement Title B')
    expect(container.textContent).toContain('SharedKeyword inside replacement topic B')

    // 3. With multiple matched topics, deleting one updates both rendered list and stats count immediately on render
    mocks.storeTopicsMap = new Map([
      ['topic-live-a', renamedTopicA],
      ['topic-live-b', topicB]
    ])
    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'SharedKeyword',
          onMessageClick: vi.fn(),
          onTopicClick
        })
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(container.textContent).toContain('"count":3')

    // Delete topic-live-a (which had 2 of the 3 matches): stats count drops to 1 immediately before debounce completes
    mocks.storeTopicsMap = new Map([['topic-live-b', topicB]])
    await act(async () => {
      root.render(
        createElement(SearchResults, {
          keywords: 'SharedKeyword',
          onMessageClick: vi.fn(),
          onTopicClick
        })
      )
    })
    expect(container.textContent).toContain('"count":1')
    expect(container.textContent).not.toContain('"count":3')

    // 4. Empty storeTopicsMap short-circuits scanHistoryMatches without scanning message_blocks
    let scannedBlocks = 0
    const countingDb = {
      ...database,
      message_blocks: {
        ...database.message_blocks,
        toCollection: () => ({
          until: () => ({
            each: async () => {
              scannedBlocks += 1
            }
          })
        })
      }
    }
    const emptyScan = await scanHistoryMatches({
      database: countingDb,
      keywords: 'SharedKeyword',
      matchMode: 'whole-word',
      storeTopicsMap: new Map(),
      isCancelled: () => false
    })
    expect(emptyScan).toEqual({ terms: ['sharedkeyword'], candidates: [] })
    expect(scannedBlocks).toBe(0)

    await act(async () => {
      root.unmount()
    })
  })
})
