import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { LOAD_MORE_COUNT } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations, useTopicMessages } from '@renderer/hooks/useMessageOperations'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import SelectionBox from '@renderer/pages/home/Messages/SelectionBox'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { dbService } from '@renderer/services/db'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getGroupedMessages, getUserMessage } from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import store, { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors, updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Topic } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { runAsyncFunction } from '@renderer/utils'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { isTextLikeBlock } from '@renderer/utils/messageUtils/is'
import last from 'lodash/last'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageAnchorLine from './MessageAnchorLine'
import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import { deriveTopicDisplayWindow } from './pagination'
import { MessagesContainer, ScrollContainer } from './shared'

interface MessagesProps {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

const logger = loggerService.withContext('Messages')

const Messages: React.FC<MessagesProps> = ({ assistant, topic, setActiveTopic, onComponentUpdate, onFirstUpdate }) => {
  const { containerRef: scrollContainerRef, handleScroll: handleScrollPosition } = useScrollPosition(
    `topic-${topic.id}`
  )
  const [loadedExtraCount, setLoadedExtraCount] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const { addTopic } = useAssistant(assistant.id)
  const { messageNavigation, showInputEstimatedTokens } = useSettings()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const messages = useTopicMessages(topic.id)
  const { displayCount, clearTopicMessages, deleteMessage, createTopicBranch } = useMessageOperations(topic)
  const { setTimeoutTimer } = useTimer()

  const { isMultiSelectMode, handleSelectMessage } = useChatContext(topic)

  const messageElements = useRef<Map<string, HTMLElement>>(new Map())
  const messagesRef = useRef<Message[]>(messages)
  const isProcessingContextRef = useRef(false)
  const assistantRef = useRef(assistant)
  const topicRef = useRef(topic)
  assistantRef.current = assistant
  topicRef.current = topic
  const prevTopicIdRef = useRef(topic.id)

  if (prevTopicIdRef.current !== topic.id) {
    prevTopicIdRef.current = topic.id
    if (loadedExtraCount !== 0) {
      setLoadedExtraCount(0)
    }
  }

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  const effectiveDisplayCount = displayCount + loadedExtraCount
  const { displayMessages, hasMore } = useMemo(
    () => deriveTopicDisplayWindow(messages, effectiveDisplayCount),
    [messages, effectiveDisplayCount]
  )

  // NOTE: 如果设置为平滑滚动会导致滚动条无法跟随生成的新消息保持在底部位置
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight })
        }
      })
    }
  }, [scrollContainerRef])

  const clearTopic = useCallback(
    async (data: Topic) => {
      if (data && data.id !== topic.id) {
        await clearTopicMessages(data.id)
        return
      }

      await clearTopicMessages()
      setLoadedExtraCount(0)
    },
    [clearTopicMessages, topic.id]
  )

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, async (data: Topic) => {
        window.modal.confirm({
          title: t('chat.input.clear.title'),
          content: t('chat.input.clear.content'),
          centered: true,
          onOk: () => clearTopic(data)
        })
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, async () => {
        if (isProcessingContextRef.current) return
        isProcessingContextRef.current = true

        try {
          const currentMessages = messagesRef.current

          if (currentMessages.length === 0) {
            return
          }

          const lastMessage = last(currentMessages)

          if (lastMessage?.type === 'clear') {
            await deleteMessage(lastMessage.id)
            scrollToBottom()
            return
          }

          const currentAssistant = assistantRef.current
          const currentTopic = topicRef.current
          const { message: clearMessage } = getUserMessage({
            assistant: currentAssistant,
            topic: currentTopic,
            type: 'clear'
          })
          await dbService.appendMessage(currentTopic.id, clearMessage, [])
          dispatch(newMessagesActions.addMessage({ topicId: currentTopic.id, message: clearMessage }))

          scrollToBottom()
        } finally {
          isProcessingContextRef.current = false
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_BRANCH, async (index: number) => {
        const currentAssistant = assistantRef.current
        const currentTopic = topicRef.current
        const newTopic = getDefaultTopic(currentAssistant.id)
        newTopic.name = currentTopic.name
        const currentMessages = messagesRef.current

        if (index < 0 || index > currentMessages.length) {
          logger.error(`[NEW_BRANCH] Invalid branch index: ${index}`)
          return
        }

        // 1. Add the new topic to Redux store FIRST
        addTopic(newTopic)

        // 2. Call the thunk to clone messages and update DB
        const success = await createTopicBranch(currentTopic.id, currentMessages.length - index, newTopic)

        if (success) {
          // 3. Set the new topic as active
          setActiveTopic(newTopic)
          // 4. Trigger auto-rename for the new topic
          void autoRenameTopic(currentAssistant, newTopic.id)
        } else {
          logger.error(`[NEW_BRANCH] Failed to create topic branch for topic ${newTopic.id}`)
          window.toast.error(t('message.branch.error'))
        }
      }),
      EventEmitter.on(
        EVENT_NAMES.EDIT_CODE_BLOCK,
        async (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => {
          const { msgBlockId, codeBlockId, newContent } = data

          const msgBlock = messageBlocksSelectors.selectById(store.getState(), msgBlockId)

          // FIXME: 目前 error block 没有 content
          if (msgBlock && isTextLikeBlock(msgBlock) && msgBlock.type !== MessageBlockType.ERROR) {
            try {
              const updatedRaw = await updateCodeBlock(msgBlock.content, codeBlockId, newContent)
              const updatedBlock: MessageBlock = {
                ...msgBlock,
                content: updatedRaw,
                updatedAt: new Date().toISOString()
              }

              dispatch(updateOneBlock({ id: msgBlockId, changes: { content: updatedRaw } }))
              await dispatch(updateMessageAndBlocksThunk(topicRef.current.id, null, [updatedBlock]))

              window.toast.success(t('code_block.edit.save.success'))
            } catch (error) {
              logger.error(
                `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`,
                error as Error
              )
              window.toast.error(t('code_block.edit.save.failed.label'))
            }
          } else {
            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: no such message block or the block doesn't have a content field`
            )
            window.toast.error(t('code_block.edit.save.failed.label'))
          }
        }
      )
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [addTopic, clearTopic, createTopicBranch, deleteMessage, dispatch, scrollToBottom, setActiveTopic, t])

  const contextCountSetting = assistant.settings?.contextCount
  useEffect(() => {
    if (!showInputEstimatedTokens) {
      onFirstUpdate?.()
      return
    }
    let cancelled = false
    const currentAssistant = assistantRef.current
    void runAsyncFunction(async () => {
      const tokensCount = await estimateHistoryTokens(currentAssistant, messages)
      if (cancelled) return
      void EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount,
        contextCount: getContextCount(currentAssistant, messages)
      })
    }).then(() => {
      if (!cancelled) {
        onFirstUpdate?.()
      }
    })
    return () => {
      cancelled = true
    }
  }, [assistant.id, assistant.prompt, contextCountSetting, messages, onFirstUpdate, showInputEstimatedTokens])

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || isLoadingMore) return

    const container = scrollContainerRef.current
    const previousScrollHeight = container?.scrollHeight ?? 0
    const previousScrollTop = container?.scrollTop ?? 0

    setIsLoadingMore(true)
    setTimeoutTimer(
      'loadMoreMessages',
      () => {
        setLoadedExtraCount((prev) => prev + LOAD_MORE_COUNT)
        setIsLoadingMore(false)

        requestAnimationFrame(() => {
          const currentContainer = scrollContainerRef.current
          if (!currentContainer) {
            return
          }

          const nextScrollHeight = currentContainer.scrollHeight
          currentContainer.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight)
        })
      },
      300
    )
  }, [hasMore, isLoadingMore, scrollContainerRef, setTimeoutTimer])

  useShortcut('copy_last_message', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      void navigator.clipboard.writeText(getMainTextContent(lastMessage))
      window.toast.success(t('message.copy.success'))
    }
  })

  useShortcut('edit_last_user_message', () => {
    const lastUserMessage = messagesRef.current.findLast((m) => m.role === 'user' && m.type !== 'clear')
    if (lastUserMessage) {
      void EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, lastUserMessage.id)
    }
  })

  useEffect(() => {
    requestAnimationFrame(() => onComponentUpdate?.())
  }, [displayMessages, onComponentUpdate])

  const prevScrollMetaRef = useRef({ topicId: topic.id, length: 0 })
  useEffect(() => {
    const prev = prevScrollMetaRef.current
    const topicChanged = prev.topicId !== topic.id
    const messagesAdded = messages.length > prev.length
    prevScrollMetaRef.current = { topicId: topic.id, length: messages.length }

    if (!messages.length || (!topicChanged && !messagesAdded)) {
      return
    }

    setTimeoutTimer(
      'messages-scroll-bottom',
      () => {
        scrollToBottom()
      },
      120
    )
  }, [messages.length, scrollToBottom, setTimeoutTimer, topic.id])

  const prevGroupArraysRef = useRef<Map<string, (Message & { index: number })[]>>(new Map())
  const groupedMessages = useMemo(() => {
    const rawEntries = Object.entries(getGroupedMessages(displayMessages))
    const prevMap = prevGroupArraysRef.current
    const nextMap = new Map<string, (Message & { index: number })[]>()
    const stabilized = rawEntries.map(([key, group]) => {
      const prevGroup = prevMap.get(key)
      if (prevGroup && prevGroup.length === group.length && prevGroup.every((item, idx) => item === group[idx])) {
        nextMap.set(key, prevGroup)
        return [key, prevGroup] as [string, (Message & { index: number })[]]
      }
      nextMap.set(key, group)
      return [key, group] as [string, (Message & { index: number })[]]
    })
    prevGroupArraysRef.current = nextMap
    return stabilized
  }, [displayMessages])

  const handleMessagesScroll = useCallback(() => {
    handleScrollPosition()

    if (!scrollContainerRef.current || isLoadingMore || !hasMore) {
      return
    }

    if (scrollContainerRef.current.scrollTop <= 80) {
      loadMoreMessages()
    }
  }, [handleScrollPosition, hasMore, isLoadingMore, loadMoreMessages, scrollContainerRef])

  return (
    <MessagesContainer
      id="messages"
      className="messages-container"
      ref={scrollContainerRef}
      key={assistant.id}
      onScroll={handleMessagesScroll}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <ContextMenu>
          <ScrollContainer>
            {isLoadingMore && (
              <LoaderContainer>
                <LoadingIcon color="var(--color-text-2)" />
              </LoaderContainer>
            )}
            {groupedMessages.map(([key, groupMessages]) => (
              <MessageGroup
                key={key}
                messages={groupMessages}
                topic={topic}
                registerMessageElement={registerMessageElement}
              />
            ))}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
      {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages} />}
      <SelectionBox
        isMultiSelectMode={isMultiSelectMode}
        scrollContainerRef={scrollContainerRef}
        messageElements={messageElements.current}
        handleSelectMessage={handleSelectMessage}
      />
    </MessagesContainer>
  )
}

const LoaderContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 10px;
  width: 100%;
  background: var(--color-background);
  pointer-events: none;
`

export default Messages
