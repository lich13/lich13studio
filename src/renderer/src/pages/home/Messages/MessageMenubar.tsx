import { loggerService } from '@logger'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import { isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import type { MessageMenubarButtonId, MessageMenubarScope } from '@renderer/config/registry/messageMenubar'
import { DEFAULT_MESSAGE_MENUBAR_SCOPE, getMessageMenubarConfig } from '@renderer/config/registry/messageMenubar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle } from '@renderer/services/MessagesService'
import type { RootState } from '@renderer/store'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Assistant, Model, Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { copyMessageAsPlainText } from '@renderer/utils/copy'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { findMainTextBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { MenuProps } from 'antd'
import { Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { AtSign, Check, FilePenLine, ListChecks, Menu, Save, Split, ThumbsUp, Upload } from 'lucide-react'
import type { Dispatch, FC, ReactNode, SetStateAction } from 'react'
import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  assistant: Assistant
  topic: Topic
  model?: Model
  index?: number
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  setModel: (model: Model) => void
  onUpdateUseful?: (msgId: string) => void
}

const logger = loggerService.withContext('MessageMenubar')

type MessageOperationsHandlers = ReturnType<typeof useMessageOperations>

type MessageMenubarButtonContext = {
  assistant: Assistant
  confirmDeleteMessage: boolean
  confirmRegenerateMessage: boolean
  copied: boolean
  deleteMessage: MessageOperationsHandlers['deleteMessage']
  dropdownItems: MenuProps['items']
  handleResendUserMessage: (messageUpdate?: Message) => Promise<void>
  isAssistantMessage: boolean
  isBubbleStyle: boolean
  isGrouped?: boolean
  isLastMessage: boolean
  isUserMessage: boolean
  message: Message
  onCopy: (e: React.MouseEvent) => void
  onEdit: () => void | Promise<void>
  onMentionModel: (e: React.MouseEvent) => void | Promise<void>
  onRegenerate: (e?: React.MouseEvent) => void | Promise<void>
  onUseful: (e: React.MouseEvent) => void
  setShowDeleteTooltip: Dispatch<SetStateAction<boolean>>
  showDeleteTooltip: boolean
  softHoverBg: boolean
  t: TFunction
}

type MessageMenubarButtonRenderer = (ctx: MessageMenubarButtonContext) => ReactNode | null

const MessageMenubar: FC<Props> = (props) => {
  const { message, index, isGrouped, isLastMessage, isAssistantMessage, assistant, topic, model, onUpdateUseful } =
    props
  const { t } = useTranslation()
  const { toggleMultiSelectMode } = useChatContext(props.topic)
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  // remove confirm for regenerate; tooltip stays simple
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  // const assistantModel = assistant?.model
  const { deleteMessage, resendMessage, regenerateAssistantMessage, appendAssistantResponse } =
    useMessageOperations(topic)

  const { isBubbleStyle } = useMessageStyle()
  const { confirmDeleteMessage, confirmRegenerateMessage } = useSettings()

  // const loading = useTopicLoading(topic)

  const isUserMessage = message.role === 'user'

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)
  // const processedMessage = useMemo(() => {
  //   if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
  //     return withMessageThought(message)
  //   }
  //   return message
  // }, [message])

  const mainTextContent = useMemo(() => {
    // 只处理助手消息和来自推理模型的消息
    // if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
    // return getMainTextContent(withMessageThought(message))
    // }
    return getMainTextContent(message)
  }, [message])

  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      const currentMessageId = message.id // from props
      const latestMessageEntity = store.getState().messages.entities[currentMessageId]

      let contentToCopy = ''
      if (latestMessageEntity) {
        contentToCopy = getMainTextContent(latestMessageEntity)
      } else {
        contentToCopy = getMainTextContent(message)
      }

      void navigator.clipboard.writeText(removeTrailingDoubleSpaces(contentToCopy.trimStart()))

      window.toast.success(t('message.copied'))
      setCopied(true)
    },
    [message, setCopied, t] // message is needed for message.id and as a fallback. t is for translation.
  )

  const onNewBranch = useCallback(async () => {
    void EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.toast.success(t('chat.message.new.branch.created'))
  }, [index, t])

  const handleResendUserMessage = useCallback(
    async (messageUpdate?: Message) => {
      await resendMessage(messageUpdate ?? message, assistant)
    },
    [assistant, message, resendMessage]
  )

  const { startEditing } = useMessageEditing()

  const onEdit = useCallback(async () => {
    startEditing(message.id)
  }, [message.id, startEditing])

  const menubarScope: MessageMenubarScope = topic?.type ?? DEFAULT_MESSAGE_MENUBAR_SCOPE
  const { buttonIds, dropdownRootAllowKeys } = getMessageMenubarConfig(menubarScope)

  const isEditable = useMemo(() => {
    return findMainTextBlocks(message).length > 0 // 使用 MCP Server 后会有大于一段 MatinTextBlock
  }, [message])

  const dropdownItems = useMemo(() => {
    const items: MenuProps['items'] = [
      ...(isEditable
        ? [
            {
              label: t('common.edit'),
              key: 'edit',
              icon: <FilePenLine size={15} />,
              onClick: onEdit
            }
          ]
        : []),
      {
        label: t('chat.message.new.branch.label'),
        key: 'new-branch',
        icon: <Split size={15} />,
        onClick: onNewBranch
      },
      {
        label: t('chat.multiple.select.label'),
        key: 'multi-select',
        icon: <ListChecks size={15} />,
        onClick: () => {
          toggleMultiSelectMode(true)
        }
      },
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={15} />,
        children: [
          {
            label: t('chat.save.file.title'),
            key: 'file',
            onClick: () => {
              const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
              void window.api.file.save(fileName, mainTextContent)
            }
          }
        ]
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <Upload size={15} />,
        children: [
          exportMenuOptions.plain_text && {
            label: t('chat.topics.copy.plain_text'),
            key: 'copy_message_plain_text',
            onClick: () => copyMessageAsPlainText(message)
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md.label'),
            key: 'markdown',
            onClick: async () => {
              const { exportMessageAsMarkdown } = await import('@renderer/utils/export')
              await exportMessageAsMarkdown(message)
            }
          },
          exportMenuOptions.markdown_reason && {
            label: t('chat.topics.export.md.reason'),
            key: 'markdown_reason',
            onClick: async () => {
              const { exportMessageAsMarkdown } = await import('@renderer/utils/export')
              await exportMessageAsMarkdown(message, true)
            }
          },
          exportMenuOptions.docx && {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const { messageToMarkdown } = await import('@renderer/utils/export')
              const markdown = messageToMarkdown(message)
              const title = await getMessageTitle(message)
              void window.api.export.toWord(markdown, title)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              const title = topic.name?.replace(/\\/g, '_') || 'Untitled'
              const { default: ObsidianExportPopup } = await import('@renderer/components/Popups/ObsidianExportPopup')
              await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
            }
          }
        ].filter(Boolean)
      }
    ].filter(Boolean)

    if (!dropdownRootAllowKeys || dropdownRootAllowKeys.length === 0) {
      return items
    }

    const allowSet = new Set(dropdownRootAllowKeys)
    return items.filter((item) => {
      if (!item || typeof item !== 'object') {
        return false
      }
      if ('type' in item && item.type === 'divider') {
        return false
      }
      if ('key' in item && item.key) {
        return allowSet.has(String(item.key))
      }
      return false
    })
  }, [
    dropdownRootAllowKeys,
    exportMenuOptions.docx,
    exportMenuOptions.markdown,
    exportMenuOptions.markdown_reason,
    exportMenuOptions.obsidian,
    exportMenuOptions.plain_text,
    isEditable,
    mainTextContent,
    message,
    onEdit,
    onNewBranch,
    t,
    toggleMultiSelectMode,
    topic.name
  ])

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    // No need to reset or edit the message anymore
    // const selectedModel = isGrouped ? model : assistantModel
    // const _message = resetAssistantMessage(message, selectedModel)
    // editMessage(message.id, { ..._message }) // REMOVED

    // Call the function from the hook
    void regenerateAssistantMessage(message, assistant)
  }

  // 按条件筛选能够提及的模型，该函数仅在isAssistantMessage时会用到
  const mentionModelFilter = useMemo(() => {
    const defaultFilter = (model: Model) => !isEmbeddingModel(model) && !isRerankModel(model)

    if (!isAssistantMessage) {
      return defaultFilter
    }
    const state = store.getState()
    const topicMessages: Message[] = selectMessagesForTopic(state, topic.id)
    // 理论上助手消息只会关联一条用户消息
    const relatedUserMessage = topicMessages.find((msg) => {
      return msg.role === 'user' && message.askId === msg.id
    })
    // 无关联用户消息时，默认返回所有模型
    if (!relatedUserMessage) {
      return defaultFilter
    }

    const relatedUserMessageBlocks = relatedUserMessage.blocks.map((msgBlockId) =>
      messageBlocksSelectors.selectById(store.getState(), msgBlockId)
    )

    if (!relatedUserMessageBlocks) {
      return defaultFilter
    }

    if (relatedUserMessageBlocks.some((block) => block && block.type === MessageBlockType.IMAGE)) {
      return (m: Model) => isVisionModel(m) && defaultFilter(m)
    } else {
      return defaultFilter
    }
  }, [isAssistantMessage, message.askId, topic.id])

  const onMentionModel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const { SelectChatModelPopup } = await import('@renderer/components/Popups/SelectModelPopup')
      const selectedModel = await SelectChatModelPopup.show({ model, filter: mentionModelFilter })
      if (!selectedModel) return
      void appendAssistantResponse(message, selectedModel, { ...assistant, model: selectedModel })
    },
    [appendAssistantResponse, assistant, mentionModelFilter, message, model]
  )

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUpdateUseful?.(message.id)
    },
    [message.id, onUpdateUseful]
  )

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = !isBubbleStyle
  const isUserBubbleStyleMessage = isBubbleStyle && isUserMessage

  const buttonContext: MessageMenubarButtonContext = {
    assistant,
    confirmDeleteMessage,
    confirmRegenerateMessage,
    copied,
    deleteMessage,
    dropdownItems,
    handleResendUserMessage,
    isAssistantMessage,
    isBubbleStyle,
    isGrouped,
    isLastMessage,
    isUserMessage,
    message,
    onCopy,
    onEdit,
    onMentionModel,
    onRegenerate,
    onUseful,
    setShowDeleteTooltip,
    showDeleteTooltip,
    softHoverBg,
    t
  }

  return (
    <>
      {showMessageTokens && <MessageTokens message={message} />}
      <MenusBar
        className={classNames({ menubar: true, show: isLastMessage, 'user-bubble-style': isUserBubbleStyleMessage })}>
        {buttonIds.map((buttonId) => {
          const renderFn = buttonRenderers[buttonId]
          if (!renderFn) {
            logger.warn(`No renderer registered for MessageMenubar button id: ${buttonId}`)
            return null
          }
          const element = renderFn(buttonContext)
          if (!element) {
            return null
          }
          return <Fragment key={buttonId}>{element}</Fragment>
        })}
      </MenusBar>
    </>
  )
}

const MenusBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;

  &.user-bubble-style {
    margin-top: 5px;
  }
`

const ActionButton = styled.div<{ $softHoverBg?: boolean }>`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 26px;
  height: 26px;
  transition: all 0.2s ease;
  &:hover {
    background-color: ${(props) =>
      props.$softHoverBg ? 'var(--color-background-soft)' : 'var(--color-background-mute)'};
    color: var(--color-text-1);
    .anticon,
    .lucide {
      color: var(--color-text-1);
    }
  }
  .anticon,
  .iconfont {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-icon);
  }
  .icon-at {
    font-size: 16px;
  }
`

const buttonRenderers: Record<MessageMenubarButtonId, MessageMenubarButtonRenderer> = {
  'user-regenerate': ({
    message,
    confirmRegenerateMessage,
    handleResendUserMessage,
    setShowDeleteTooltip,
    t,
    isBubbleStyle
  }) => {
    if (message.role !== 'user') {
      return null
    }

    if (confirmRegenerateMessage) {
      return (
        <Popconfirm
          title={t('message.regenerate.confirm')}
          okButtonProps={{ danger: true }}
          onConfirm={() => handleResendUserMessage()}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
            <ActionButton
              className="message-action-button"
              onClick={(e) => e.stopPropagation()}
              $softHoverBg={isBubbleStyle}>
              <RefreshIcon size={15} />
            </ActionButton>
          </Tooltip>
        </Popconfirm>
      )
    }

    return (
      <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
        <ActionButton
          className="message-action-button"
          onClick={() => handleResendUserMessage()}
          $softHoverBg={isBubbleStyle}>
          <RefreshIcon size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  'user-edit': ({ message, onEdit, softHoverBg, t }) => {
    if (message.role !== 'user') {
      return null
    }

    return (
      <Tooltip title={t('common.edit')} mouseEnterDelay={0.8}>
        <ActionButton className="message-action-button" onClick={onEdit} $softHoverBg={softHoverBg}>
          <EditIcon size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  copy: ({ onCopy, softHoverBg, copied, t }) => (
    <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
      <ActionButton className="message-action-button" onClick={onCopy} $softHoverBg={softHoverBg}>
        {!copied && <CopyIcon size={15} />}
        {copied && <Check size={15} color="var(--color-primary)" />}
      </ActionButton>
    </Tooltip>
  ),
  'assistant-regenerate': ({
    isAssistantMessage,
    confirmRegenerateMessage,
    onRegenerate,
    setShowDeleteTooltip,
    softHoverBg,
    t
  }) => {
    if (!isAssistantMessage) {
      return null
    }

    if (confirmRegenerateMessage) {
      return (
        <Popconfirm
          title={t('message.regenerate.confirm')}
          okButtonProps={{ danger: true }}
          onConfirm={() => onRegenerate()}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
            <ActionButton
              className="message-action-button"
              onClick={(e) => e.stopPropagation()}
              $softHoverBg={softHoverBg}>
              <RefreshIcon size={15} />
            </ActionButton>
          </Tooltip>
        </Popconfirm>
      )
    }

    return (
      <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
        <ActionButton className="message-action-button" onClick={onRegenerate} $softHoverBg={softHoverBg}>
          <RefreshIcon size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  'assistant-mention-model': ({ isAssistantMessage, onMentionModel, softHoverBg, t }) => {
    if (!isAssistantMessage) {
      return null
    }

    return (
      <Tooltip title={t('message.mention.title')} mouseEnterDelay={0.8}>
        <ActionButton className="message-action-button" onClick={onMentionModel} $softHoverBg={softHoverBg}>
          <AtSign size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  useful: ({ isAssistantMessage, isGrouped, onUseful, softHoverBg, message, t }) => {
    if (!isAssistantMessage || !isGrouped) {
      return null
    }

    return (
      <Tooltip title={t('chat.message.useful.label')} mouseEnterDelay={0.8}>
        <ActionButton className="message-action-button" onClick={onUseful} $softHoverBg={softHoverBg}>
          {message.useful ? (
            <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} />
          ) : (
            <ThumbsUp size={15} />
          )}
        </ActionButton>
      </Tooltip>
    )
  },
  delete: ({
    confirmDeleteMessage,
    deleteMessage,
    message,
    setShowDeleteTooltip,
    showDeleteTooltip,
    softHoverBg,
    t
  }) => {
    const deleteTooltip = (
      <Tooltip
        title={t('common.delete')}
        mouseEnterDelay={1}
        open={showDeleteTooltip}
        onOpenChange={setShowDeleteTooltip}>
        <DeleteIcon size={15} />
      </Tooltip>
    )

    const handleDeleteMessage = async () => {
      await deleteMessage(message.id)
    }

    if (confirmDeleteMessage) {
      return (
        <Popconfirm
          title={t('message.message.delete.content')}
          okButtonProps={{ danger: true }}
          onConfirm={async () => await handleDeleteMessage()}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            $softHoverBg={softHoverBg}>
            {deleteTooltip}
          </ActionButton>
        </Popconfirm>
      )
    }

    return (
      <ActionButton
        className="message-action-button"
        onClick={async (e) => {
          e.stopPropagation()
          await handleDeleteMessage()
        }}
        $softHoverBg={softHoverBg}>
        {deleteTooltip}
      </ActionButton>
    )
  },
  'more-menu': ({ isUserMessage, dropdownItems, softHoverBg }) => {
    if (isUserMessage) {
      return null
    }

    return (
      <Dropdown
        menu={{ items: dropdownItems, onClick: (e) => e.domEvent.stopPropagation() }}
        trigger={['click']}
        placement="topRight">
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()} $softHoverBg={softHoverBg}>
          <Menu size={19} />
        </ActionButton>
      </Dropdown>
    )
  }
}

export default memo(MessageMenubar)
