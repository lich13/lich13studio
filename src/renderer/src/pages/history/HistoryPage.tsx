import { HStack } from '@renderer/components/Layout'
import { registerActiveHistoryBackHandler } from '@renderer/services/mobile/back'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { InputRef } from 'antd'
import { Button, Divider, Input } from 'antd'
import last from 'lodash/last'
import { ChevronLeft, CornerDownLeft, Search, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SearchMessage from './components/SearchMessage'
import SearchResults from './components/SearchResults'
import TopicMessages from './components/TopicMessages'
import TopicsHistory from './components/TopicsHistory'

type Route = 'topics' | 'topic' | 'search' | 'message'

interface HistoryPageProps {
  onClose?: () => void
}

const HistoryPage: FC<HistoryPageProps> = ({ onClose }) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const [stack, setStack] = useState<Route[]>(['topics'])
  const [topic, setTopic] = useState<Topic | undefined>(undefined)
  const [message, setMessage] = useState<Message | undefined>(undefined)
  const inputRef = useRef<InputRef>(null)
  const stackRef = useRef<Route[]>(stack)
  stackRef.current = stack
  const dispatch = useAppDispatch()

  const goBack = useCallback(() => {
    const nextStack = [...stackRef.current]
    if (nextStack.length <= 1) {
      return false
    }
    const route = nextStack.pop()
    setStack(nextStack)
    if (route === 'search') {
      setSearch('')
    }
    if (route === 'topic') {
      setTopic(undefined)
      dispatch(newMessagesActions.setPreviewTopicId(null))
    }
    if (route === 'message') {
      setMessage(undefined)
      dispatch(newMessagesActions.setPreviewTopicId(null))
    }
    return true
  }, [dispatch])

  const onSearch = () => {
    setSearchKeywords(search)
    setStack(['topics', 'search'])
    setTopic(undefined)
    dispatch(newMessagesActions.setPreviewTopicId(null))
  }

  // topic 不包含 messages，用到的时候才会获取
  const onTopicClick = (topic: Topic | null | undefined) => {
    if (!topic) {
      window.toast.error(t('history.error.topic_not_found'))
      return
    }
    dispatch(newMessagesActions.setPreviewTopicId(topic.id))
    setStack((prev) => [...prev, 'topic'])
    setTopic(topic)
  }

  const onMessageClick = (message: Message) => {
    dispatch(newMessagesActions.setPreviewTopicId(message.topicId))
    void dispatch(loadTopicMessagesThunk(message.topicId))
    setStack(['topics', 'search', 'message'])
    setMessage(message)
  }

  const isShow = (route: Route) => (last(stack) === route ? 'flex' : 'none')

  useEffect(() => {
    const unregister = registerActiveHistoryBackHandler(goBack)
    inputRef.current?.focus()
    return () => {
      unregister()
      dispatch(newMessagesActions.setPreviewTopicId(null))
    }
  }, [dispatch, goBack])

  return (
    <Container>
      <HStack style={{ padding: '0 12px', marginTop: 8 }}>
        <Input
          prefix={
            stack.length > 1 ? (
              <SearchIcon className="back-icon" onClick={goBack}>
                <ChevronLeft size={16} />
              </SearchIcon>
            ) : (
              <SearchIcon>
                <Search size={15} />
              </SearchIcon>
            )
          }
          suffix={search.length ? <CornerDownLeft size={16} /> : null}
          ref={inputRef}
          placeholder={t('history.search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value.trimStart())}
          allowClear
          autoFocus
          spellCheck={false}
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
          onPressEnter={onSearch}
        />
        {onClose && <Button type="text" aria-label={t('common.close')} icon={<X size={18} />} onClick={onClose} />}
      </HStack>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      <TopicsHistory
        keywords={search}
        onClick={onTopicClick as any}
        onSearch={onSearch}
        style={{ display: isShow('topics') }}
      />
      <TopicMessages topic={topic} style={{ display: isShow('topic') }} />
      <SearchResults
        keywords={isShow('search') ? searchKeywords : ''}
        onMessageClick={onMessageClick}
        onTopicClick={onTopicClick}
        style={{ display: isShow('search') }}
      />
      <SearchMessage message={message} style={{ display: isShow('message') }} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
  &.back-icon {
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: var(--color-background-mute);
    }
  }
`

export default HistoryPage
