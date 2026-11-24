import { LoadingIcon } from '@renderer/components/Icons'
import db from '@renderer/databases'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { selectTopicsMap } from '@renderer/store/assistants'
import type { Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import {
  buildKeywordRegexes,
  buildKeywordUnionRegex,
  type KeywordMatchMode,
  splitKeywordsToTerms
} from '@renderer/utils/keywordSearch'
import { List, Segmented, Spin, Typography } from 'antd'
import type { FC } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const { Text, Title } = Typography

export type SearchResult = {
  blockId: string
  message: Message
  topic: Topic
  snippet: string
}

export type SearchMatchCandidate = {
  blockId: string
  message: Message
  topic: Topic
  createdAtMs: number
}

type SearchDatabase = Pick<typeof db, 'message_blocks' | 'topics'>

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  keywords: string
  onMessageClick: (message: Message) => void
  onTopicClick: (topic: Topic) => void
}

const SEARCH_SNIPPET_CONTEXT_LINES = 1
const SEARCH_SNIPPET_MAX_LINES = 12
const SEARCH_SNIPPET_MAX_LINE_LENGTH = 160
const SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS = 40
const SEARCH_SNIPPET_MAX_LINE_FRAGMENTS = 3
const SEARCH_DEBOUNCE_MS = 200
export const MAX_SEARCH_RESULTS = 200

export type ResultSortOrder = 'newest' | 'oldest'

const stripMarkdownFormatting = (text: string) => {
  return text
    .replace(/```(?:[^\n]*\n)?([\s\S]*?)```/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/<[^>]*>/g, '')
}

const normalizeText = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const mergeRanges = (ranges: Array<[number, number]>) => {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (!last || range[0] > last[1] + 1) {
      merged.push([range[0], range[1]])
      continue
    }
    last[1] = Math.max(last[1], range[1])
  }
  return merged
}

const buildLineSnippet = (line: string, regexes: RegExp[]) => {
  if (line.length <= SEARCH_SNIPPET_MAX_LINE_LENGTH) {
    return line
  }

  const matchRanges: Array<[number, number]> = []
  for (const regex of regexes) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) !== null) {
      matchRanges.push([match.index, match.index + match[0].length])
      if (match[0].length === 0) {
        regex.lastIndex += 1
      }
    }
  }

  if (matchRanges.length === 0) {
    return `${line.slice(0, SEARCH_SNIPPET_MAX_LINE_LENGTH)}...`
  }

  const expandedRanges: Array<[number, number]> = matchRanges.map(([start, end]) => [
    Math.max(0, start - SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS),
    Math.min(line.length, end + SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS)
  ])
  const mergedRanges = mergeRanges(expandedRanges)
  const limitedRanges = mergedRanges.slice(0, SEARCH_SNIPPET_MAX_LINE_FRAGMENTS)

  let result = limitedRanges.map(([start, end]) => line.slice(start, end)).join(' ... ')
  // 片段未从行首开始，补前置省略号。
  if (limitedRanges[0][0] > 0) {
    result = `...${result}`
  }
  // 片段未覆盖到行尾，补后置省略号。
  if (limitedRanges[limitedRanges.length - 1][1] < line.length) {
    result = `${result}...`
  }
  // 还有未展示的匹配片段，提示省略。
  if (mergedRanges.length > SEARCH_SNIPPET_MAX_LINE_FRAGMENTS) {
    result = `${result}...`
  }
  // 最终长度超限，强制截断并补省略号。
  if (result.length > SEARCH_SNIPPET_MAX_LINE_LENGTH) {
    result = `${result.slice(0, SEARCH_SNIPPET_MAX_LINE_LENGTH)}...`
  }
  return result
}

const buildSearchSnippet = (text: string, terms: string[], matchMode: KeywordMatchMode) => {
  const normalized = normalizeText(stripMarkdownFormatting(text))
  const lines = normalized.split('\n')
  if (lines.length === 0) {
    return ''
  }

  const nonEmptyTerms = terms.filter((term) => term.length > 0)
  const regexes = buildKeywordRegexes(nonEmptyTerms, { matchMode, flags: 'gi' })
  const matchedLineIndexes: number[] = []

  if (regexes.length > 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const isMatch = regexes.some((regex) => {
        regex.lastIndex = 0
        return regex.test(line)
      })
      if (isMatch) {
        matchedLineIndexes.push(i)
      }
    }
  }

  const ranges: Array<[number, number]> =
    matchedLineIndexes.length > 0
      ? mergeRanges(
          matchedLineIndexes.map((index) => [
            Math.max(0, index - SEARCH_SNIPPET_CONTEXT_LINES),
            Math.min(lines.length - 1, index + SEARCH_SNIPPET_CONTEXT_LINES)
          ])
        )
      : [[0, Math.min(lines.length - 1, SEARCH_SNIPPET_MAX_LINES - 1)]]

  const outputLines: string[] = []
  let truncated = false

  if (ranges[0][0] > 0) {
    outputLines.push('...')
  }

  for (const [start, end] of ranges) {
    if (outputLines.length >= SEARCH_SNIPPET_MAX_LINES) {
      truncated = true
      break
    }
    if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '...') {
      outputLines.push('...')
    }
    for (let i = start; i <= end; i += 1) {
      if (outputLines.length >= SEARCH_SNIPPET_MAX_LINES) {
        truncated = true
        break
      }
      outputLines.push(buildLineSnippet(lines[i], regexes))
    }
    if (truncated) {
      break
    }
  }

  if ((truncated || ranges[ranges.length - 1][1] < lines.length - 1) && outputLines.at(-1) !== '...') {
    outputLines.push('...')
  }

  return outputLines.join('\n')
}

export async function scanHistoryMatches({
  database,
  keywords,
  matchMode,
  storeTopicsMap,
  isCancelled
}: {
  database: SearchDatabase
  keywords: string
  matchMode: KeywordMatchMode
  storeTopicsMap: ReadonlyMap<string, Topic>
  isCancelled: () => boolean
}): Promise<{ terms: string[]; candidates: SearchMatchCandidate[] } | null> {
  const terms = splitKeywordsToTerms(keywords.trim())
  if (terms.length === 0) {
    return { terms: [], candidates: [] }
  }

  const searchRegexes = buildKeywordRegexes(terms, { matchMode, flags: 'i' })
  const matchedRefs: Array<{ blockId: string; messageId: string }> = []
  const neededMessageIds = new Set<string>()

  await database.message_blocks
    .toCollection()
    .until(isCancelled)
    .each((block) => {
      if (block.type !== MessageBlockType.MAIN_TEXT || typeof block.content !== 'string') {
        return
      }
      const searchableContent = stripMarkdownFormatting(block.content)
      const isMatched = searchRegexes.some((regex) => {
        regex.lastIndex = 0
        return regex.test(searchableContent)
      })
      if (isMatched) {
        matchedRefs.push({ blockId: block.id, messageId: block.messageId })
        neededMessageIds.add(block.messageId)
      }
    })

  if (isCancelled()) {
    return null
  }

  const matchedMessages = new Map<string, Message>()
  if (neededMessageIds.size > 0) {
    await database.topics
      .toCollection()
      .until(() => isCancelled() || neededMessageIds.size === 0)
      .each((topicRow) => {
        if (!storeTopicsMap.has(topicRow.id) || !Array.isArray(topicRow.messages)) {
          return
        }
        for (const message of topicRow.messages) {
          if (neededMessageIds.has(message.id)) {
            matchedMessages.set(message.id, message)
            neededMessageIds.delete(message.id)
            if (neededMessageIds.size === 0) {
              break
            }
          }
        }
      })
  }

  if (isCancelled()) {
    return null
  }

  const candidates: SearchMatchCandidate[] = []
  for (const ref of matchedRefs) {
    const message = matchedMessages.get(ref.messageId)
    if (!message) {
      continue
    }
    const topic = storeTopicsMap.get(message.topicId)
    if (!topic) {
      continue
    }
    candidates.push({
      blockId: ref.blockId,
      message,
      topic,
      createdAtMs: Date.parse(message.createdAt) || 0
    })
  }

  return { terms, candidates }
}

export async function selectAndHydrateTopSearchResults({
  database,
  candidates,
  terms,
  matchMode,
  sortOrder,
  limit = MAX_SEARCH_RESULTS,
  isCancelled
}: {
  database: Pick<SearchDatabase, 'message_blocks'>
  candidates: readonly SearchMatchCandidate[]
  terms: string[]
  matchMode: KeywordMatchMode
  sortOrder: ResultSortOrder
  limit?: number
  isCancelled: () => boolean
}): Promise<SearchResult[] | null> {
  if (candidates.length === 0 || limit <= 0) {
    return []
  }

  const topCandidates = candidates
    .slice()
    .sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) {
        return sortOrder === 'newest' ? b.createdAtMs - a.createdAtMs : a.createdAtMs - b.createdAtMs
      }
      return a.message.id.localeCompare(b.message.id) || a.blockId.localeCompare(b.blockId)
    })
    .slice(0, limit)

  const blocks = await database.message_blocks.bulkGet(topCandidates.map((item) => item.blockId))
  if (isCancelled()) {
    return null
  }

  const results: SearchResult[] = []
  for (let index = 0; index < topCandidates.length; index += 1) {
    const block = blocks[index]
    if (!block || block.type !== MessageBlockType.MAIN_TEXT || typeof block.content !== 'string') {
      continue
    }
    const candidate = topCandidates[index]
    results.push({
      blockId: candidate.blockId,
      message: candidate.message,
      topic: candidate.topic,
      snippet: buildSearchSnippet(block.content, terms, matchMode)
    })
  }

  return results
}

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, ...props }) => {
  const { t } = useTranslation()
  const { handleScroll, containerRef } = useScrollPosition('SearchResults')
  const searchSeqRef = useRef(0)
  const hydrateSeqRef = useRef(0)

  const [matchMode, setMatchMode] = useState<KeywordMatchMode>('whole-word')
  const [sortOrder, setSortOrder] = useState<ResultSortOrder>('newest')
  const sortOrderRef = useRef<ResultSortOrder>(sortOrder)
  sortOrderRef.current = sortOrder
  const [searchTerms, setSearchTerms] = useState<string[]>(() => splitKeywordsToTerms(keywords))
  const [matchedCandidates, setMatchedCandidates] = useState<{
    seq: number
    candidates: SearchMatchCandidate[]
    terms: string[]
    matchMode: KeywordMatchMode
  }>({ seq: 0, candidates: [], terms: [], matchMode: 'whole-word' })

  // FIXME: db 中没有 topic.name 等信息，只能从 store 获取
  const storeTopicsMap = useSelector(selectTopicsMap)

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStats, setSearchStats] = useState({ count: 0, time: 0 })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const seq = ++searchSeqRef.current
    hydrateSeqRef.current += 1
    const trimmedKeywords = keywords.trim()

    if (trimmedKeywords.length === 0) {
      setMatchedCandidates({ seq, candidates: [], terms: [], matchMode })
      setSearchResults([])
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
      setIsLoading(false)
      return () => {
        searchSeqRef.current += 1
        hydrateSeqRef.current += 1
      }
    }

    setIsLoading(true)

    const timer = window.setTimeout(() => {
      void (async () => {
        const startTime = performance.now()
        const isCancelled = () => seq !== searchSeqRef.current
        const scanned = await scanHistoryMatches({
          database: db,
          keywords: trimmedKeywords,
          matchMode,
          storeTopicsMap,
          isCancelled
        })
        if (!scanned || isCancelled()) {
          return
        }

        if (scanned.terms.length === 0) {
          setMatchedCandidates({ seq, candidates: [], terms: [], matchMode })
          setSearchResults([])
          setSearchStats({ count: 0, time: 0 })
          setSearchTerms([])
          setIsLoading(false)
          return
        }

        const results = await selectAndHydrateTopSearchResults({
          database: db,
          candidates: scanned.candidates,
          terms: scanned.terms,
          matchMode,
          sortOrder: sortOrderRef.current,
          isCancelled
        })
        if (!results || isCancelled()) {
          return
        }

        const endTime = performance.now()
        setMatchedCandidates({
          seq,
          candidates: scanned.candidates,
          terms: scanned.terms,
          matchMode
        })
        setSearchResults(results)
        setSearchStats({
          count: scanned.candidates.length,
          time: (endTime - startTime) / 1000
        })
        setSearchTerms(scanned.terms)
        setIsLoading(false)
      })().catch(() => {
        if (seq === searchSeqRef.current) {
          setIsLoading(false)
        }
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      searchSeqRef.current += 1
      hydrateSeqRef.current += 1
    }
  }, [keywords, matchMode, storeTopicsMap])

  const handleSortOrderChange = (nextOrder: ResultSortOrder) => {
    setSortOrder(nextOrder)
    if (matchedCandidates.candidates.length === 0 || matchedCandidates.seq !== searchSeqRef.current) {
      return
    }
    const hydrateSeq = ++hydrateSeqRef.current
    const activeSearchSeq = matchedCandidates.seq
    void selectAndHydrateTopSearchResults({
      database: db,
      candidates: matchedCandidates.candidates,
      terms: matchedCandidates.terms,
      matchMode: matchedCandidates.matchMode,
      sortOrder: nextOrder,
      isCancelled: () => hydrateSeq !== hydrateSeqRef.current || activeSearchSeq !== searchSeqRef.current
    })
      .then((results) => {
        if (results && hydrateSeq === hydrateSeqRef.current && activeSearchSeq === searchSeqRef.current) {
          setSearchResults(results)
        }
      })
      .catch(() => {})
  }

  const highlightText = (text: string) => {
    const highlightRegex = buildKeywordUnionRegex(searchTerms, { matchMode, flags: 'gi' })
    if (!highlightRegex) {
      return <span>{text}</span>
    }

    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = highlightRegex.exec(text)) !== null) {
      if (match[0].length === 0) {
        highlightRegex.lastIndex += 1
        continue
      }
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index))
      }
      parts.push(<mark key={match.index}>{match[0]}</mark>)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }
    return <span>{parts.length > 0 ? parts : text}</span>
  }

  useEffect(() => {
    containerRef.current?.scrollTo?.({ top: 0 })
  }, [searchResults, containerRef])

  return (
    <Container ref={containerRef} {...props} onScroll={handleScroll}>
      <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
        <SearchToolbar>
          <Segmented
            shape="round"
            size="small"
            value={sortOrder}
            onChange={(value) => handleSortOrderChange(value as ResultSortOrder)}
            options={[
              { label: t('history.search.sort.newest'), value: 'newest' },
              { label: t('history.search.sort.oldest'), value: 'oldest' }
            ]}
          />
          <Segmented
            shape="round"
            size="small"
            value={matchMode}
            onChange={(value) => setMatchMode(value as KeywordMatchMode)}
            options={[
              { label: t('history.search.match.whole_word'), value: 'whole-word' },
              { label: t('history.search.match.substring'), value: 'substring' }
            ]}
          />
        </SearchToolbar>
        {searchResults.length > 0 && (
          <SearchStats>
            {t('history.search.results_stats', {
              count: searchStats.count,
              time: searchStats.time.toFixed(3)
            })}
          </SearchStats>
        )}
        <List
          itemLayout="vertical"
          rowKey={(item) => item.blockId}
          dataSource={searchResults}
          pagination={{
            pageSize: 10,
            hideOnSinglePage: true
          }}
          style={{ opacity: isLoading ? 0 : 1 }}
          renderItem={({ message, topic, snippet }) => (
            <List.Item>
              <Title
                level={5}
                style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                onClick={() => onTopicClick(topic)}>
                {topic.name}
              </Title>
              <div style={{ cursor: 'pointer' }} onClick={() => onMessageClick(message)}>
                <Text style={{ whiteSpace: 'pre-line' }}>{highlightText(snippet)}</Text>
              </div>
              <SearchResultTime>
                <Text type="secondary">{new Date(message.createdAt).toLocaleString()}</Text>
              </SearchResultTime>
            </List.Item>
          )}
        />
        <div style={{ minHeight: 30 }}></div>
      </Spin>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 20px 36px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`

const SearchStats = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
`

const SearchToolbar = styled.div`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`

const SearchResultTime = styled.div`
  margin-top: 10px;
  text-align: right;
`

export default memo(SearchResults)
