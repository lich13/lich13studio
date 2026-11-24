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
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const { Text, Title } = Typography

type SearchResult = {
  message: Message
  topic: Topic
  content: string
  snippet: string
}

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
const MAX_SEARCH_RESULTS = 200

type ResultSortOrder = 'newest' | 'oldest'

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

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, ...props }) => {
  const { t } = useTranslation()
  const { handleScroll, containerRef } = useScrollPosition('SearchResults')
  const searchSeqRef = useRef(0)

  const [matchMode, setMatchMode] = useState<KeywordMatchMode>('whole-word')
  const [sortOrder, setSortOrder] = useState<ResultSortOrder>('newest')
  const [searchTerms, setSearchTerms] = useState<string[]>(() => splitKeywordsToTerms(keywords))

  // FIXME: db 中没有 topic.name 等信息，只能从 store 获取
  const storeTopicsMap = useSelector(selectTopicsMap)

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStats, setSearchStats] = useState({ count: 0, time: 0 })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const seq = ++searchSeqRef.current
    const trimmedKeywords = keywords.trim()

    if (trimmedKeywords.length === 0) {
      setSearchResults([])
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const timer = window.setTimeout(() => {
      void (async () => {
        const startTime = performance.now()
        const newSearchTerms = splitKeywordsToTerms(trimmedKeywords)

        if (newSearchTerms.length === 0) {
          if (seq === searchSeqRef.current) {
            setSearchResults([])
            setSearchStats({ count: 0, time: 0 })
            setSearchTerms([])
            setIsLoading(false)
          }
          return
        }

        const searchRegexes = buildKeywordRegexes(newSearchTerms, { matchMode, flags: 'i' })
        const matchedBlocks: Array<{ messageId: string; content: string }> = []
        const neededMessageIds = new Set<string>()

        await db.message_blocks
          .toCollection()
          .until(() => seq !== searchSeqRef.current || matchedBlocks.length >= MAX_SEARCH_RESULTS)
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
              matchedBlocks.push({ messageId: block.messageId, content: block.content })
              neededMessageIds.add(block.messageId)
            }
          })

        if (seq !== searchSeqRef.current) {
          return
        }

        const matchedMessages = new Map<string, Message>()
        if (neededMessageIds.size > 0) {
          await db.topics
            .toCollection()
            .until(() => seq !== searchSeqRef.current || neededMessageIds.size === 0)
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

        if (seq !== searchSeqRef.current) {
          return
        }

        const results: SearchResult[] = []
        for (const block of matchedBlocks) {
          const message = matchedMessages.get(block.messageId)
          if (!message) {
            continue
          }
          const topic = storeTopicsMap.get(message.topicId)
          if (!topic) {
            continue
          }
          results.push({
            message,
            topic,
            content: block.content,
            snippet: buildSearchSnippet(block.content, newSearchTerms, matchMode)
          })
        }

        const endTime = performance.now()
        setSearchResults(results)
        setSearchStats({
          count: results.length,
          time: (endTime - startTime) / 1000
        })
        setSearchTerms(newSearchTerms)
        setIsLoading(false)
      })().catch(() => {
        if (seq === searchSeqRef.current) {
          setIsLoading(false)
        }
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [keywords, matchMode, storeTopicsMap])

  const sortedSearchResults = useMemo(() => {
    const results = [...searchResults]
    results.sort((a, b) => {
      const timeA = Date.parse(a.message.createdAt) || 0
      const timeB = Date.parse(b.message.createdAt) || 0
      if (timeA !== timeB) {
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
      }
      return a.message.id.localeCompare(b.message.id)
    })
    return results
  }, [searchResults, sortOrder])

  const highlightText = (text: string) => {
    // Escape HTML entities to prevent XSS from LLM response content
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const safeText = escapeHtml(text)
    const highlightRegex = buildKeywordUnionRegex(searchTerms, { matchMode, flags: 'gi' })
    if (!highlightRegex) {
      return <span dangerouslySetInnerHTML={{ __html: safeText }} />
    }
    const highlightedText = safeText.replace(highlightRegex, (match) => `<mark>${match}</mark>`)
    return <span dangerouslySetInnerHTML={{ __html: highlightedText }} />
  }

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
  }, [sortedSearchResults, containerRef])

  return (
    <Container ref={containerRef} {...props} onScroll={handleScroll}>
      <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
        <SearchToolbar>
          <Segmented
            shape="round"
            size="small"
            value={sortOrder}
            onChange={(value) => setSortOrder(value as ResultSortOrder)}
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
        {sortedSearchResults.length > 0 && (
          <SearchStats>
            {t('history.search.results_stats', {
              count: searchStats.count,
              time: searchStats.time.toFixed(3)
            })}
          </SearchStats>
        )}
        <List
          itemLayout="vertical"
          dataSource={sortedSearchResults}
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
