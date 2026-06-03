import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ModelSelector from '@renderer/components/ModelSelector'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import { useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { ConversationService } from '@renderer/services/ConversationService'
import FileManager from '@renderer/services/FileManager'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import PasteService from '@renderer/services/PasteService'
import store from '@renderer/store'
import { addTopic } from '@renderer/store/assistants'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import {
  bulkAddBlocks,
  cancelThrottledBlockUpdate,
  saveMessageAndBlocksToDB,
  throttledBlockUpdate,
  updateMessage,
  updateSingleBlock
} from '@renderer/store/thunk/messageThunk'
import type { FileMetadata, Topic } from '@renderer/types'
import { FILE_TYPE, ThemeMode } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, type Message, type MessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { defaultLanguage } from '@shared/config/constant'
import { Button, Tooltip } from 'antd'
import { cloneDeep, isEmpty } from 'lodash'
import { last } from 'lodash'
import { Image as ImageIcon, X } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatWindow from '../chat/ChatWindow'
import CapturePanel from './components/CapturePanel'
import ClipboardPreview from './components/ClipboardPreview'
import Footer from './components/Footer'
import InputBar from './components/InputBar'
import MiniWindowCaptureButton from './components/MiniWindowCaptureButton'
import {
  captureMiniWindowScreenshot,
  captureMiniWindowSelectedWindow,
  getMiniWindowChatModels,
  getMiniWindowMessageWithBlock,
  getMiniWindowPersistedTopic,
  getMiniWindowSupportExts,
  isMiniWindowChatModel,
  isMiniWindowComposingInput,
  isMiniWindowSendKeyPressed,
  type MiniCaptureWindowInfo,
  type MiniWindowCaptureNotice,
  updateMiniWindowDefaultAssistantModel
} from './miniWindowHelpers'

const logger = loggerService.withContext('HomeWindow')

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const { language, readClipboardAtStartup, windowStyle } = useSettings()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [isFirstMessage, setIsFirstMessage] = useState(true)

  const [userInputText, setUserInputText] = useState('')
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [filePreviewUrls, setFilePreviewUrls] = useState<Record<string, string>>({})
  const [captureWindows, setCaptureWindows] = useState<MiniCaptureWindowInfo[]>([])
  const [capturingWindow, setCapturingWindow] = useState(false)

  const [clipboardText, setClipboardText] = useState('')
  const lastClipboardTextRef = useRef<string | null>(null)

  const [isPinned, setIsPinned] = useState(false)

  // Indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  // Indicator for whether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const { defaultAssistant, updateDefaultAssistant } = useDefaultAssistant()
  const { defaultModel } = useDefaultModel()
  const { providers } = useProviders()
  const currentAssistant = useMemo(
    () => ({
      ...defaultAssistant,
      model: defaultAssistant.model ?? defaultAssistant.defaultModel ?? defaultModel
    }),
    [defaultAssistant, defaultModel]
  )
  const chatModels = useMemo(() => getMiniWindowChatModels(providers), [providers])
  const supportedExts = useMemo(() => getMiniWindowSupportExts(currentAssistant), [currentAssistant])
  const canCaptureImage = supportedExts.length > 0

  const currentTopic = useRef<Topic>(getDefaultTopic(currentAssistant.id))
  const currentAskId = useRef('')

  const inputBarRef = useRef<HTMLDivElement>(null)

  const referenceText = useMemo(() => clipboardText || userInputText, [clipboardText, userInputText])

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])
  const canSend = userContent.trim().length > 0 || files.length > 0

  useEffect(() => {
    currentTopic.current = getDefaultTopic(currentAssistant.id)
  }, [currentAssistant.id])

  useEffect(() => {
    if (!canCaptureImage) {
      setCaptureWindows([])
    }
  }, [canCaptureImage])

  useEffect(() => {
    let isCancelled = false

    const loadPreviewUrls = async () => {
      const imageFiles = files.filter((file) => file.type === FILE_TYPE.IMAGE)
      const previews = await Promise.all(
        imageFiles.map(async (file) => {
          try {
            return [file.id, await FileManager.resolvePreviewUrl(file)] as const
          } catch (error) {
            logger.warn('Failed to resolve mini window attachment preview:', error as Error)
            return null
          }
        })
      )

      if (!isCancelled) {
        setFilePreviewUrls(Object.fromEntries(previews.filter((preview) => preview !== null)))
      }
    }

    void loadPreviewUrls()

    return () => {
      isCancelled = true
    }
  }, [files])

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  const focusInput = useCallback(() => {
    if (inputBarRef.current) {
      const input = inputBarRef.current.querySelector('input')
      if (input) {
        input.focus()
      }
    }
  }, [])

  // Use useCallback with stable dependencies to avoid infinite loops
  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup || !document.hasFocus()) return

    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text
        setClipboardText(text.trim())
      }
    } catch (error) {
      // Silently handle clipboard read errors (common in some environments)
      logger.warn('Failed to read clipboard:', error as Error)
    }
  }, [readClipboardAtStartup])

  const clearClipboard = useCallback(async () => {
    setClipboardText('')
    lastClipboardTextRef.current = null
    focusInput()
  }, [focusInput])

  const onWindowShow = useCallback(async () => {
    await readClipboard()
    focusInput()
  }, [readClipboard, focusInput])

  useEffect(() => {
    void window.api.miniWindow.setPin(isPinned)
  }, [isPinned])

  useEffect(() => {
    return window.api.miniWindow.onShow(() => {
      void onWindowShow()
    })
  }, [onWindowShow])

  useEffect(() => {
    void readClipboard()
  }, [readClipboard])

  const handleCloseWindow = useCallback(() => window.api.miniWindow.hide(), [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        {
          if (!isMiniWindowSendKeyPressed(e)) return
          if (isLoading) return

          e.preventDefault()
          if (canSend) {
            void handleSendMessage()
            focusInput()
          }
        }
        break
      case 'Backspace':
        {
          if (userInputText.length === 0) {
            void clearClipboard()
          }
        }
        break
      case 'Escape':
        {
          if (isMiniWindowComposingInput(e)) return
          handleEsc()
        }
        break
    }
  }

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLInputElement>) => {
      await PasteService.handlePaste(
        event.nativeEvent,
        supportedExts,
        setFiles,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        t
      )
    },
    [supportedExts, t]
  )

  const notifyCapture = useCallback(
    (notice: MiniWindowCaptureNotice, error?: unknown) => {
      switch (notice) {
        case 'image-required':
          window.toast.warning(t('chat.input.capture.image_required'))
          break
        case 'unavailable':
          window.toast.error(t('chat.input.capture.unavailable'))
          break
        case 'success':
          window.toast.success(t('chat.input.capture.success'))
          break
        case 'failed': {
          const message = error instanceof Error ? error.message : t('chat.input.capture.failed')
          window.toast.error(`${t('chat.input.capture.failed')}: ${message}`)
          break
        }
      }
    },
    [t]
  )

  const addCapturedFile = useCallback((file: FileMetadata) => {
    setFiles((previousFiles) => [...previousFiles, file])
  }, [])

  const handleSelectCaptureWindow = useCallback(
    async (target: MiniCaptureWindowInfo) => {
      if (capturingWindow) return

      setCapturingWindow(true)
      setCaptureWindows([])
      try {
        await captureMiniWindowSelectedWindow({
          target,
          captureWindow: window.api.system.captureWindow,
          savePastedImage: window.api.file.savePastedImage,
          onAddFile: addCapturedFile,
          notify: notifyCapture
        })
      } finally {
        setCapturingWindow(false)
      }
    },
    [addCapturedFile, capturingWindow, notifyCapture]
  )

  const handleOpenCapturePicker = useCallback(async () => {
    if (capturingWindow) return

    setCapturingWindow(true)
    try {
      await captureMiniWindowScreenshot({
        canCaptureImage,
        listCaptureWindows: window.api.system.listCaptureWindows,
        captureWindow: window.api.system.captureWindow,
        savePastedImage: window.api.file.savePastedImage,
        onSelectWindow: setCaptureWindows,
        onAddFile: addCapturedFile,
        notify: notifyCapture
      })
    } finally {
      setCapturingWindow(false)
    }
  }, [addCapturedFile, canCaptureImage, capturingWindow, notifyCapture])

  const handleModelChange = useCallback(
    (value: string) => {
      const selectedModel = chatModels.find((model) => getModelUniqId(model) === value)
      if (!selectedModel) return
      updateDefaultAssistant(updateMiniWindowDefaultAssistantModel(defaultAssistant, selectedModel))
      setFiles((prevFiles) =>
        getMiniWindowSupportExts({ ...currentAssistant, model: selectedModel }).length ? prevFiles : []
      )
    },
    [chatModels, currentAssistant, defaultAssistant, updateDefaultAssistant]
  )

  const removeFile = useCallback((fileId: string) => {
    setFiles((prevFiles) => prevFiles.filter((file) => file.id !== fileId))
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const handleError = (error: Error) => {
    setIsLoading(false)
    setError(error.message)
  }

  const ensureMiniTopicPersisted = useCallback(
    async (topic: Topic) => {
      const topicInDb = await db.topics.get(topic.id)
      if (!topicInDb) {
        await db.topics.add({ id: topic.id, messages: [] })
      }

      const assistantInStore = store
        .getState()
        .assistants.assistants.find((assistant) => assistant.id === currentAssistant.id)
      const topicInAssistant = assistantInStore?.topics?.some((item) => item.id === topic.id)

      if (!topicInAssistant) {
        store.dispatch(addTopic({ assistantId: currentAssistant.id, topic: getMiniWindowPersistedTopic(topic) }))
      }
    },
    [currentAssistant.id]
  )

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if ((isEmpty(userContent) && files.length === 0) || !currentTopic.current) {
        return
      }

      let persistQueue = Promise.resolve()
      const queueMiniWindowPersist = (task: () => Promise<void>, label: string) => {
        persistQueue = persistQueue
          .then(task)
          .catch((error) => {
            logger.error(`Failed to persist mini window ${label}:`, error as Error)
          })
          .then(() => undefined)
      }

      try {
        const topicId = currentTopic.current.id
        await ensureMiniTopicPersisted(currentTopic.current)

        const uploadedFiles = files.length > 0 ? await FileManager.uploadFiles(files) : []

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, userContent].filter(Boolean).join('\n\n'),
          assistant: currentAssistant,
          topic: currentTopic.current,
          files: uploadedFiles
        })

        await saveMessageAndBlocksToDB(topicId, userMessage, blocks)
        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        let assistantMessage = getAssistantMessage({
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        assistantMessage.askId = userMessage.id
        currentAskId.current = userMessage.id

        await saveMessageAndBlocksToDB(topicId, assistantMessage, [])
        store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        const persistAssistantMessageUpdate = (updates: Partial<Message>, label: string) => {
          assistantMessage = { ...assistantMessage, ...updates }
          queueMiniWindowPersist(() => updateMessage(topicId, assistantMessage.id, updates), label)
        }

        const updateAssistantMessageWithBlock = (block: MessageBlock) => {
          assistantMessage = getMiniWindowMessageWithBlock(assistantMessage, block.id)
          store.dispatch(
            newMessagesActions.updateMessage({
              topicId,
              messageId: assistantMessage.id,
              updates: { blockInstruction: { id: block.id } }
            })
          )
          store.dispatch(upsertOneBlock(block))
          queueMiniWindowPersist(
            () =>
              Promise.all([
                bulkAddBlocks([block]),
                updateMessage(topicId, assistantMessage.id, { blocks: assistantMessage.blocks })
              ]).then(() => undefined),
            'assistant block'
          )
        }

        const persistBlockUpdate = (blockId: string, changes: Partial<MessageBlock>, label: string) => {
          queueMiniWindowPersist(() => updateSingleBlock(blockId, changes), label)
        }

        const allMessagesForTopic = selectMessagesForTopic(store.getState(), topicId)
        const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessage.id)

        const messagesForContext = allMessagesForTopic
          .slice(0, userMessageIndex + 1)
          .filter((m) => m && !m.status?.includes('ing'))

        let blockId: string | null = null
        let thinkingBlockId: string | null = null
        let thinkingStartTime: number | null = null

        const resolveThinkingDuration = (duration?: number) => {
          if (typeof duration === 'number' && Number.isFinite(duration)) {
            return duration
          }
          if (thinkingStartTime !== null) {
            return Math.max(0, performance.now() - thinkingStartTime)
          }
          return 0
        }

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        setIsFirstMessage(false)
        setUserInputText('')
        setFiles([])

        const newAssistant = cloneDeep(currentAssistant)
        if (!newAssistant.settings) {
          newAssistant.settings = {}
        }
        newAssistant.settings.streamOutput = true
        // 显式关闭这些功能
        newAssistant.webSearchProviderId = undefined
        newAssistant.mcpServers = undefined
        // replace prompt vars
        newAssistant.prompt = await replacePromptVariables(
          currentAssistant.prompt,
          currentAssistant.model?.name ?? currentAssistant.name
        )
        // logger.debug('newAssistant', newAssistant)

        const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(
          messagesForContext,
          newAssistant
        )

        await fetchChatCompletion({
          messages: modelMessages,
          assistant: newAssistant,
          requestOptions: {},
          topicId,
          uiMessages: uiMessages,
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_START:
                {
                  setIsOutputted(true)
                  thinkingStartTime = performance.now()
                  if (thinkingBlockId) {
                    store.dispatch(
                      updateOneBlock({ id: thinkingBlockId, changes: { status: MessageBlockStatus.STREAMING } })
                    )
                    persistBlockUpdate(thinkingBlockId, { status: MessageBlockStatus.STREAMING }, 'thinking block')
                  } else {
                    const block = createThinkingBlock(assistantMessage.id, '', {
                      status: MessageBlockStatus.STREAMING
                    })
                    thinkingBlockId = block.id
                    updateAssistantMessageWithBlock(block)
                  }
                }
                break
              case ChunkType.THINKING_DELTA:
                {
                  setIsOutputted(true)
                  if (thinkingBlockId) {
                    if (thinkingStartTime === null) {
                      thinkingStartTime = performance.now()
                    }
                    const thinkingDuration = resolveThinkingDuration(chunk.thinking_millsec)
                    throttledBlockUpdate(thinkingBlockId, {
                      content: chunk.text,
                      thinking_millsec: thinkingDuration
                    })
                  }
                }
                break
              case ChunkType.THINKING_COMPLETE:
                {
                  if (thinkingBlockId) {
                    const thinkingDuration = resolveThinkingDuration(chunk.thinking_millsec)
                    cancelThrottledBlockUpdate(thinkingBlockId)
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: {
                          content: chunk.text,
                          status: MessageBlockStatus.SUCCESS,
                          thinking_millsec: thinkingDuration
                        }
                      })
                    )
                    persistBlockUpdate(
                      thinkingBlockId,
                      {
                        content: chunk.text,
                        status: MessageBlockStatus.SUCCESS,
                        thinking_millsec: thinkingDuration
                      },
                      'thinking block complete'
                    )
                  }
                  thinkingStartTime = null
                  thinkingBlockId = null
                }
                break
              case ChunkType.TEXT_START:
                {
                  setIsOutputted(true)
                  if (blockId) {
                    store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.STREAMING } }))
                    persistBlockUpdate(blockId, { status: MessageBlockStatus.STREAMING }, 'text block')
                  } else {
                    const block = createMainTextBlock(assistantMessage.id, '', {
                      status: MessageBlockStatus.STREAMING
                    })
                    blockId = block.id
                    updateAssistantMessageWithBlock(block)
                  }
                }
                break
              case ChunkType.TEXT_DELTA:
                {
                  setIsOutputted(true)
                  if (blockId) {
                    throttledBlockUpdate(blockId, { content: chunk.text })
                  }
                }
                break

              case ChunkType.TEXT_COMPLETE:
                {
                  if (blockId) {
                    cancelThrottledBlockUpdate(blockId)
                    store.dispatch(
                      updateOneBlock({
                        id: blockId,
                        changes: { content: chunk.text, status: MessageBlockStatus.SUCCESS }
                      })
                    )
                    persistBlockUpdate(
                      blockId,
                      { content: chunk.text, status: MessageBlockStatus.SUCCESS },
                      'text block complete'
                    )
                  }
                }
                break
              case ChunkType.ERROR: {
                //stop the thinking timer
                const isAborted = isAbortError(chunk.error)
                const possibleBlockId = thinkingBlockId || blockId
                if (possibleBlockId) {
                  store.dispatch(
                    updateOneBlock({
                      id: possibleBlockId,
                      changes: {
                        status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
                      }
                    })
                  )
                  persistBlockUpdate(
                    possibleBlockId,
                    { status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR },
                    'error block'
                  )
                  const nextStatus = isAborted ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.SUCCESS
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId,
                      messageId: assistantMessage.id,
                      updates: {
                        status: nextStatus
                      }
                    })
                  )
                  persistAssistantMessageUpdate({ status: nextStatus }, 'assistant error status')
                }
                if (!isAborted) {
                  throw new Error(chunk.error.message)
                }
                thinkingStartTime = null
                thinkingBlockId = null
              }
              //fall through
              case ChunkType.BLOCK_COMPLETE:
                setIsLoading(false)
                setIsOutputted(true)
                currentAskId.current = ''
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId,
                    messageId: assistantMessage.id,
                    updates: { status: AssistantMessageStatus.SUCCESS }
                  })
                )
                persistAssistantMessageUpdate({ status: AssistantMessageStatus.SUCCESS }, 'assistant status')
                break
            }
          }
        })
        await persistQueue
      } catch (err) {
        if (isAbortError(err)) return
        handleError(err instanceof Error ? err : new Error('An error occurred'))
        logger.error('Error fetching result:', err as Error)
      } finally {
        await persistQueue
        setIsLoading(false)
        setIsOutputted(true)
        currentAskId.current = ''
      }
    },
    [ensureMiniTopicPersisted, files, userContent, currentAssistant]
  )

  const sendCurrentMessage = useCallback(() => {
    if (!isLoading && canSend) {
      void handleSendMessage()
      focusInput()
    }
  }, [canSend, focusInput, handleSendMessage, isLoading])

  const handlePause = useCallback(() => {
    if (currentAskId.current) {
      abortCompletion(currentAskId.current)
      setIsLoading(false)
      setIsOutputted(true)
      currentAskId.current = ''
    }
  }, [])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      handlePause()
    } else {
      void handleCloseWindow()
    }
  }, [isLoading, handleCloseWindow, handlePause])

  const handleCopy = useCallback(() => {
    if (!currentTopic.current) return

    const messages = selectMessagesForTopic(store.getState(), currentTopic.current.id)
    const lastMessage = last(messages) as Message | undefined

    if (lastMessage) {
      const content = getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(content)
      window.toast.success(t('message.copy.success'))
    }
  }, [currentTopic, t])

  const backgroundColor = useMemo(() => {
    // ONLY MAC: when transparent style + light theme: use vibrancy effect
    // because the dark style under mac's vibrancy effect has not been implemented
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }, [windowStyle, theme])

  // Memoize placeholder text
  const inputPlaceholder = useMemo(() => {
    return t('miniwindow.input.placeholder.empty', {
      model: currentAssistant.model?.name ?? currentAssistant.name
    })
  }, [t, currentAssistant])

  // Memoize footer props
  const baseFooterProps = useMemo(
    () => ({
      loading: isLoading,
      onEsc: handleEsc,
      setIsPinned,
      isPinned
    }),
    [isLoading, handleEsc, isPinned]
  )

  const header = (
    <MiniHeader>
      <BrandArea>
        {currentAssistant.model ? <ModelAvatar model={currentAssistant.model} size={22} /> : <ImageIcon size={18} />}
        <BrandText>
          <BrandTitle>lich13studio</BrandTitle>
          <BrandSubTitle>{t('miniwindow.header.default_assistant')}</BrandSubTitle>
        </BrandText>
      </BrandArea>
      <ModelSelector
        className="nodrag"
        size="small"
        style={{ width: 180 }}
        providers={providers}
        predicate={isMiniWindowChatModel}
        grouped
        showAvatar
        showSuffix={false}
        value={currentAssistant.model ? getModelUniqId(currentAssistant.model) : undefined}
        onChange={handleModelChange}
      />
    </MiniHeader>
  )

  const attachments = files.length > 0 && (
    <AttachmentStrip className="nodrag">
      {files.map((file) => (
        <AttachmentPill key={file.id}>
          {file.type === FILE_TYPE.IMAGE && filePreviewUrls[file.id] ? (
            <AttachmentPreviewImage src={filePreviewUrls[file.id]} alt="" />
          ) : (
            <ImageIcon size={14} />
          )}
          <span>{file.origin_name || file.name}</span>
          <Tooltip title={t('common.delete')}>
            <Button
              aria-label={t('common.delete')}
              size="small"
              type="text"
              icon={<X size={12} />}
              onClick={() => removeFile(file.id)}
            />
          </Tooltip>
        </AttachmentPill>
      ))}
    </AttachmentStrip>
  )

  return (
    <Container style={{ backgroundColor }} $draggable={draggable}>
      {header}
      <InputBar
        text={userInputText}
        assistant={currentAssistant}
        referenceText={referenceText}
        placeholder={inputPlaceholder}
        loading={isLoading}
        handleKeyDown={handleKeyDown}
        handleChange={handleChange}
        handlePaste={handlePaste}
        canSend={canSend}
        onSend={sendCurrentMessage}
        onPause={handlePause}
        actions={
          <MiniWindowCaptureButton
            canCaptureImage={canCaptureImage}
            capturing={capturingWindow}
            onClick={() => void handleOpenCapturePicker()}
          />
        }
        ref={inputBarRef}
      />
      <CapturePanel
        windows={captureWindows}
        capturing={capturingWindow}
        onSelectWindow={(windowInfo) => void handleSelectCaptureWindow(windowInfo)}
        onClose={() => setCaptureWindows([])}
      />
      {attachments}
      <ClipboardPreview referenceText={clipboardText} clearClipboard={clearClipboard} t={t} />
      <ContentArea>
        <ChatWindow
          assistant={currentAssistant}
          topic={currentTopic.current}
          isOutputted={isOutputted}
          isLoading={isLoading}
          hasError={Boolean(error)}
        />
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </ContentArea>
      <Footer key="footer" {...baseFooterProps} onCopy={handleCopy} />
    </Container>
  )
}

const Container = styled.div<{ $draggable: boolean }>`
  display: flex;
  flex: 1;
  height: 100%;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  -webkit-app-region: ${({ $draggable }) => ($draggable ? 'drag' : 'no-drag')};
  overflow: hidden;
  padding: 8px 10px 6px;
  color: var(--color-text);
`

const MiniHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 2px 2px 5px;
`

const BrandArea = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const BrandText = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.15;
`

const BrandTitle = styled.div`
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
`

const BrandSubTitle = styled.div`
  color: var(--color-text-secondary);
  font-size: 11px;
`

const AttachmentStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 74px;
  margin-top: 7px;
  overflow-y: auto;
  -webkit-app-region: none;
`

const AttachmentPill = styled.div`
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  gap: 6px;
  padding: 4px 4px 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 12px;

  span {
    max-width: 252px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const AttachmentPreviewImage = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--color-background);
`

const ContentArea = styled.main`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-background-soft) 70%, transparent);
  -webkit-app-region: none;
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 10px;
  border-radius: 8px;
  margin: 8px;
  font-size: 13px;
  word-break: break-all;
`

export default HomeWindow
