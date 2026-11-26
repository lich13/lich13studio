import { ActionIconButton } from '@renderer/components/Buttons'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import { scrollElementIntoView } from '@renderer/utils'
import { clearSearchHighlights, setSearchHighlights } from '@renderer/utils/searchHighlights'
import { Tooltip } from 'antd'
import debounce from 'lodash/debounce'
import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  children?: React.ReactNode
  searchTarget: React.RefObject<React.ReactNode> | React.RefObject<HTMLElement> | HTMLElement
  /**
   * 过滤`node`，`node`只会是`Node.TEXT_NODE`类型的文本节点
   *
   * 返回`true`表示该`node`会被搜索
   */
  filter: NodeFilter
  includeUser?: boolean
  onIncludeUserChange?: (value: boolean) => void
  /**
   * 是否显示“包含用户问题”切换按钮（默认为 true）。
   * 在富文本编辑器场景通常不需要该按钮。
   */
  showUserToggle?: boolean
  /**
   * 搜索条定位方式
   */
  positionMode?: 'fixed' | 'absolute' | 'sticky'
}

enum SearchCompletedState {
  NotSearched,
  Searched
}

export interface ContentSearchRef {
  disable(): boolean
  enable(initialText?: string): void
  // 搜索下一个并定位
  searchNext(): void
  // 搜索上一个并定位
  searchPrev(): void
  // 搜索并定位
  search(): void
  // 搜索但不定位，或者说是更新
  silentSearch(): void
  focus(): void
}

const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

const findRangesInTarget = (
  target: HTMLElement,
  filter: NodeFilter,
  searchText: string,
  isCaseSensitive: boolean,
  isWholeWord: boolean
): Range[] => {
  clearSearchHighlights()
  const ranges: Range[] = []

  const escapedSearchText = escapeRegExp(searchText)

  // 检查搜索文本是否仅包含拉丁字母
  const hasOnlyLatinLetters = /^[a-zA-Z\s]+$/.test(searchText)

  // 只有当搜索文本仅包含拉丁字母时才应用大小写敏感
  const regexFlags = hasOnlyLatinLetters && isCaseSensitive ? 'g' : 'gi'
  const regexPattern = isWholeWord ? `\\b${escapedSearchText}\\b` : escapedSearchText
  const searchRegex = new RegExp(regexPattern, regexFlags)
  const treeWalker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, filter)
  const allTextNodes: { node: Node; startOffset: number; endOffset: number }[] = []
  const chunks: string[] = []
  let totalLength = 0

  // 1. 拼接所有非空文本节点内容
  while (treeWalker.nextNode()) {
    const text = treeWalker.currentNode.nodeValue
    if (!text) continue
    const endOffset = totalLength + text.length
    allTextNodes.push({
      node: treeWalker.currentNode,
      startOffset: totalLength,
      endOffset
    })
    chunks.push(text)
    totalLength = endOffset
  }

  if (allTextNodes.length === 0) {
    return ranges
  }

  const fullText = chunks.join('')

  // 2. 在完整文本中查找匹配项，并用单游标线性映射回 DOM Range (O(M + T))
  let nodeCursor = 0
  let match: RegExpExecArray | null = null
  while ((match = searchRegex.exec(fullText))) {
    if (match[0].length === 0) {
      searchRegex.lastIndex += 1
      continue
    }
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    while (nodeCursor < allTextNodes.length && allTextNodes[nodeCursor].endOffset <= matchStart) {
      nodeCursor += 1
    }
    if (nodeCursor >= allTextNodes.length) {
      break
    }

    const startEntry = allTextNodes[nodeCursor]
    let endCursor = nodeCursor
    while (endCursor < allTextNodes.length && allTextNodes[endCursor].endOffset < matchEnd) {
      endCursor += 1
    }
    if (endCursor >= allTextNodes.length) {
      break
    }

    const endEntry = allTextNodes[endCursor]
    const range = new Range()
    range.setStart(startEntry.node, matchStart - startEntry.startOffset)
    range.setEnd(endEntry.node, matchEnd - endEntry.startOffset)
    ranges.push(range)
    nodeCursor = endCursor
  }

  return ranges
}

// eslint-disable-next-line @eslint-react/no-forward-ref
export const ContentSearch = React.forwardRef<ContentSearchRef, Props>(
  (
    { searchTarget, filter, includeUser = false, onIncludeUserChange, showUserToggle = true, positionMode = 'fixed' },
    ref
  ) => {
    const target: HTMLElement | null = (() => {
      if (searchTarget instanceof HTMLElement) {
        return searchTarget
      } else {
        return (searchTarget.current as HTMLElement) ?? null
      }
    })()
    const containerRef = React.useRef<HTMLDivElement>(null)
    const searchInputRef = React.useRef<HTMLInputElement>(null)
    const [enableContentSearch, setEnableContentSearch] = useState(false)
    const enableContentSearchRef = useRef(false)
    enableContentSearchRef.current = enableContentSearch
    const [searchCompleted, setSearchCompleted] = useState(SearchCompletedState.NotSearched)
    const [isCaseSensitive, setIsCaseSensitive] = useState(false)
    const [isWholeWord, setIsWholeWord] = useState(false)
    const [allRanges, setAllRanges] = useState<Range[]>([])
    const [currentIndex, setCurrentIndex] = useState(-1)
    const shouldScrollOnLocateRef = useRef(true)
    const prevSearchText = useRef('')
    const { t } = useTranslation()

    const resetSearch = useCallback(() => {
      clearSearchHighlights()
      setAllRanges([])
      setCurrentIndex(-1)
      setSearchCompleted(SearchCompletedState.NotSearched)
    }, [])

    const locateByIndex = useCallback(
      (shouldScroll = true) => {
        // 清理旧的高亮
        clearSearchHighlights()

        if (allRanges.length > 0) {
          // 1. 创建并注册所有匹配项的高亮
          setSearchHighlights(allRanges, allRanges[currentIndex])

          // 2. 如果有当前项，为其创建并注册一个特殊的高亮
          if (currentIndex !== -1 && allRanges[currentIndex]) {
            const currentMatchRange = allRanges[currentIndex]

            // 3. 将当前项滚动到视图中
            // 获取第一个文本节点的父元素来进行滚动
            const parentElement = currentMatchRange.startContainer.parentElement
            if (shouldScroll && parentElement) {
              // 优先在指定的滚动容器内滚动，避免滚动整个页面导致索引错乱/看起来"跳到第一条"
              scrollElementIntoView(parentElement, target)
            }
          }
        }
      },
      [allRanges, currentIndex, target]
    )

    const search = useCallback(
      (mode: 'jump' | 'reset' | 'preserve' = 'reset') => {
        const searchText = searchInputRef.current?.value.trim() ?? null
        setSearchCompleted(SearchCompletedState.Searched)
        if (target && searchText !== null && searchText !== '') {
          shouldScrollOnLocateRef.current = mode === 'jump'
          const ranges = findRangesInTarget(target, filter, searchText, isCaseSensitive, isWholeWord)
          setAllRanges(ranges)
          setCurrentIndex((prev) => {
            if (ranges.length === 0) return -1
            if (mode === 'jump') return 0
            if (mode === 'preserve') return prev >= 0 ? Math.min(prev, ranges.length - 1) : -1
            return -1
          })
        }
      },
      [target, filter, isCaseSensitive, isWholeWord]
    )

    const implementation = useMemo(
      () => ({
        disable: () => {
          if (!enableContentSearchRef.current) return false
          enableContentSearchRef.current = false
          setEnableContentSearch(false)
          clearSearchHighlights()
          return true
        },
        enable: (initialText?: string) => {
          enableContentSearchRef.current = true
          setEnableContentSearch(true)
          if (searchInputRef.current) {
            const inputEl = searchInputRef.current
            if (initialText && initialText.trim().length > 0) {
              inputEl.value = initialText
              requestAnimationFrame(() => {
                inputEl.focus()
                inputEl.select()
                search('reset')
              })
            } else {
              requestAnimationFrame(() => {
                inputEl.focus()
                inputEl.select()
              })
            }
          }
        },
        searchNext: () => {
          if (allRanges.length > 0) {
            shouldScrollOnLocateRef.current = true
            setCurrentIndex((prev) => (prev < allRanges.length - 1 ? prev + 1 : 0))
          }
        },
        searchPrev: () => {
          if (allRanges.length > 0) {
            shouldScrollOnLocateRef.current = true
            setCurrentIndex((prev) => (prev > 0 ? prev - 1 : allRanges.length - 1))
          }
        },
        resetSearchState: () => {
          setSearchCompleted(SearchCompletedState.NotSearched)
        },
        search: () => {
          search('jump')
        },
        silentSearch: () => {
          if (!enableContentSearchRef.current) return
          search('preserve')
        },
        focus: () => {
          searchInputRef.current?.focus()
        }
      }),
      [allRanges.length, search]
    )

    const searchFnRef = useRef(implementation.search)
    searchFnRef.current = implementation.search
    const _searchHandlerDebounce = useMemo(() => debounce(() => searchFnRef.current(), 300), [])

    useEffect(() => {
      return () => {
        _searchHandlerDebounce.cancel()
      }
    }, [_searchHandlerDebounce])

    const searchHandler = useCallback(() => {
      _searchHandlerDebounce()
    }, [_searchHandlerDebounce])

    const userInputHandler = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value.trim()
        if (value.length === 0) {
          resetSearch()
        } else {
          searchHandler()
        }
        prevSearchText.current = value
      },
      [searchHandler, resetSearch]
    )

    const keyDownHandler = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          const value = (event.target as HTMLInputElement).value.trim()
          if (value.length === 0) {
            resetSearch()
            return
          }
          if (event.shiftKey) {
            implementation.searchPrev()
          } else {
            implementation.searchNext()
          }
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          implementation.disable()
        }
      },
      [implementation, resetSearch]
    )

    const searchInputFocus = useCallback(() => {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }, [])

    const userOutlinedButtonOnClick = useCallback(() => {
      onIncludeUserChange?.(!includeUser)
      searchInputFocus()
    }, [includeUser, onIncludeUserChange, searchInputFocus])

    useImperativeHandle(ref, () => implementation, [implementation])

    useEffect(() => {
      const shouldScroll = shouldScrollOnLocateRef.current
      shouldScrollOnLocateRef.current = true
      locateByIndex(shouldScroll)
    }, [currentIndex, locateByIndex])

    useEffect(() => {
      if (enableContentSearch && searchInputRef.current?.value.trim()) {
        search('jump')
      }
    }, [isCaseSensitive, isWholeWord, enableContentSearch, search])

    const prevButtonOnClick = () => {
      implementation.searchPrev()
      searchInputFocus()
    }

    const nextButtonOnClick = () => {
      implementation.searchNext()
      searchInputFocus()
    }

    const closeButtonOnClick = () => {
      implementation.disable()
    }

    const caseSensitiveButtonOnClick = () => {
      setIsCaseSensitive(!isCaseSensitive)
      searchInputFocus()
    }

    const wholeWordButtonOnClick = () => {
      setIsWholeWord(!isWholeWord)
      searchInputFocus()
    }

    return (
      <Container
        ref={containerRef}
        style={enableContentSearch ? {} : { display: 'none' }}
        $overlayPosition={positionMode === 'absolute' ? 'absolute' : 'static'}>
        <NarrowLayout style={{ width: '100%' }}>
          <SearchBarContainer $position={positionMode}>
            <InputWrapper>
              <Input
                ref={searchInputRef}
                onInput={userInputHandler}
                onKeyDown={keyDownHandler}
                placeholder={t('chat.assistant.search.placeholder')}
                style={{ lineHeight: '20px' }}
              />
              <ToolBar>
                {showUserToggle && (
                  <Tooltip title={t('button.includes_user_questions')} mouseEnterDelay={0.8} placement="bottom">
                    <ActionIconButton onClick={userOutlinedButtonOnClick}>
                      <User size={18} style={{ color: includeUser ? 'var(--color-link)' : 'var(--color-icon)' }} />
                    </ActionIconButton>
                  </Tooltip>
                )}
                <Tooltip title={t('button.case_sensitive')} mouseEnterDelay={0.8} placement="bottom">
                  <ActionIconButton onClick={caseSensitiveButtonOnClick}>
                    <CaseSensitive
                      size={18}
                      style={{ color: isCaseSensitive ? 'var(--color-link)' : 'var(--color-icon)' }}
                    />
                  </ActionIconButton>
                </Tooltip>
                <Tooltip title={t('button.whole_word')} mouseEnterDelay={0.8} placement="bottom">
                  <ActionIconButton onClick={wholeWordButtonOnClick}>
                    <WholeWord size={18} style={{ color: isWholeWord ? 'var(--color-link)' : 'var(--color-icon)' }} />
                  </ActionIconButton>
                </Tooltip>
              </ToolBar>
            </InputWrapper>
            <Separator></Separator>
            <SearchResults>
              {searchCompleted !== SearchCompletedState.NotSearched && allRanges.length > 0 ? (
                <>
                  <SearchResultCount>{currentIndex + 1}</SearchResultCount>
                  <SearchResultSeparator>/</SearchResultSeparator>
                  <SearchResultTotalCount>{allRanges.length}</SearchResultTotalCount>
                </>
              ) : (
                <SearchResultsPlaceholder>0/0</SearchResultsPlaceholder>
              )}
            </SearchResults>
            <ToolBar>
              <ActionIconButton onClick={prevButtonOnClick} disabled={allRanges.length === 0}>
                <ChevronUp size={18} />
              </ActionIconButton>
              <ActionIconButton onClick={nextButtonOnClick} disabled={allRanges.length === 0}>
                <ChevronDown size={18} />
              </ActionIconButton>
              <ActionIconButton onClick={closeButtonOnClick}>
                <X size={18} />
              </ActionIconButton>
            </ToolBar>
          </SearchBarContainer>
        </NarrowLayout>
        <Placeholder />
      </Container>
    )
  }
)

ContentSearch.displayName = 'ContentSearch'

const Container = styled.div<{ $overlayPosition: 'static' | 'absolute' }>`
  display: flex;
  flex-direction: row;
  position: ${({ $overlayPosition }) => $overlayPosition};
  top: ${({ $overlayPosition }) => ($overlayPosition === 'absolute' ? '0' : 'auto')};
  left: ${({ $overlayPosition }) => ($overlayPosition === 'absolute' ? '0' : 'auto')};
  right: ${({ $overlayPosition }) => ($overlayPosition === 'absolute' ? '0' : 'auto')};
  z-index: 999;
`

const SearchBarContainer = styled.div<{ $position: 'fixed' | 'absolute' | 'sticky' }>`
  border: 1px solid var(--color-primary);
  border-radius: 10px;
  transition: all 0.2s ease;
  position: ${({ $position }) => $position};
  top: 15px;
  left: 20px;
  right: 20px;
  margin-bottom: 5px;
  padding: 5px 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background);
  flex: 1 1 auto; /* Take up input's previous space */
`

const Placeholder = styled.div`
  width: 5px;
`

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  flex: 1 1 auto; /* Take up input's previous space */
`

const Input = styled.input`
  border: none;
  color: var(--color-text);
  background-color: transparent;
  outline: none;
  width: 100%;
  padding: 0 5px; /* Adjust padding, wrapper will handle spacing */
  flex: 1; /* Allow input to grow */
  font-size: 14px;
  font-family: var(--font-family);
`

const ToolBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
`

const Separator = styled.div`
  width: 1px;
  height: 1.5em;
  background-color: var(--color-border);
  margin-left: 2px;
  margin-right: 2px;
  flex: 0 0 auto;
`

const SearchResults = styled.div`
  display: flex;
  justify-content: center;
  width: 80px;
  margin: 0 2px;
  flex: 0 0 auto;
  color: var(--color-text-1);
  font-size: 14px;
  font-family: var(--font-family);
  font-variant-numeric: tabular-nums;
`

const SearchResultsPlaceholder = styled.span`
  color: var(--color-text-1);
  opacity: 0.5;
`

const SearchResultCount = styled.span`
  color: var(--color-text);
`

const SearchResultSeparator = styled.span`
  color: var(--color-text);
  margin: 0 4px;
`

const SearchResultTotalCount = styled.span`
  color: var(--color-text);
`
