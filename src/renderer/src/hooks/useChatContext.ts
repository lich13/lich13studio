import { loggerService } from '@logger'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { setSelectedMessageIds, toggleMultiSelectMode } from '@renderer/store/runtime'
import type { Topic } from '@renderer/types'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector, useStore } from 'react-redux'

const logger = loggerService.withContext('useChatContext')

let topicChangeSubscribers = 0
let topicChangeUnsubscribe: (() => void) | null = null
let activeDispatchRef: ReturnType<typeof useDispatch> | null = null

export const useChatContext = (activeTopic: Topic) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const store = useStore<RootState>()
  const { deleteMessage } = useMessageOperations(activeTopic)

  const isMultiSelectMode = useSelector((state: RootState) => state.runtime.chat.isMultiSelectMode)
  const selectedMessageIds = useSelector((state: RootState) => state.runtime.chat.selectedMessageIds)

  useEffect(() => {
    activeDispatchRef = dispatch
    topicChangeSubscribers += 1
    if (!topicChangeUnsubscribe) {
      topicChangeUnsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, () => {
        if (store.getState().runtime.chat.isMultiSelectMode) {
          activeDispatchRef?.(toggleMultiSelectMode(false))
        }
      })
    }
    return () => {
      topicChangeSubscribers = Math.max(0, topicChangeSubscribers - 1)
      if (topicChangeSubscribers === 0 && topicChangeUnsubscribe) {
        topicChangeUnsubscribe()
        topicChangeUnsubscribe = null
        activeDispatchRef = null
      }
    }
  }, [dispatch, store])

  const handleToggleMultiSelectMode = useCallback(
    (value: boolean) => {
      dispatch(toggleMultiSelectMode(value))
    },
    [dispatch]
  )

  const handleSelectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      dispatch(
        setSelectedMessageIds(
          selected
            ? selectedMessageIds.includes(messageId)
              ? selectedMessageIds
              : [...selectedMessageIds, messageId]
            : selectedMessageIds.filter((id) => id !== messageId)
        )
      )
    },
    [dispatch, selectedMessageIds]
  )

  const handleMultiSelectAction = useCallback(
    async (actionType: string, messageIds: string[]) => {
      if (messageIds.length === 0) {
        window.toast.warning(t('chat.multiple.select.empty'))
        return
      }

      const state = store.getState()
      const messages = selectMessagesForTopic(state, activeTopic.id)
      const messageBlocks = messageBlocksSelectors.selectEntities(state)
      const selectedIdSet = new Set(messageIds)

      switch (actionType) {
        case 'delete':
          window.modal.confirm({
            title: t('message.delete.confirm.title'),
            content: t('message.delete.confirm.content', { count: messageIds.length }),
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
              try {
                await Promise.all(messageIds.map((messageId) => deleteMessage(messageId)))
                window.toast.success(t('message.delete.success'))
                handleToggleMultiSelectMode(false)
              } catch (error) {
                logger.error('Failed to delete messages:', error as Error)
                window.toast.error(t('message.delete.failed'))
              }
            }
          })
          break
        case 'save': {
          const selectedMessages = messages.filter((msg) => selectedIdSet.has(msg.id))
          if (selectedMessages.length > 0) {
            const contentToSave = selectedMessages
              .map((msg) =>
                msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              )
              .join('\n\n---\n\n')
            const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
            await window.api.file.save(fileName, contentToSave)
            window.toast.success(t('message.save.success.title'))
            handleToggleMultiSelectMode(false)
          }
          break
        }
        case 'copy': {
          const selectedMessages = messages.filter((msg) => selectedIdSet.has(msg.id))
          if (selectedMessages.length > 0) {
            const contentToCopy = selectedMessages
              .map((msg) =>
                msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              )
              .join('\n\n---\n\n')
            void navigator.clipboard.writeText(contentToCopy)
            window.toast.success(t('message.copied'))
            handleToggleMultiSelectMode(false)
          }
          break
        }
        default:
          break
      }
    },
    [t, store, activeTopic.id, deleteMessage, handleToggleMultiSelectMode]
  )

  return {
    isMultiSelectMode,
    selectedMessageIds,
    toggleMultiSelectMode: handleToggleMultiSelectMode,
    handleMultiSelectAction,
    handleSelectMessage,
    activeTopic
  }
}
