import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import db from '@renderer/databases'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { dbService } from '@renderer/services/db'
import FileManager from '@renderer/services/FileManager'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import PasteService from '@renderer/services/PasteService'
import store, { refreshMiniWindowPersistedState, useAppSelector } from '@renderer/store'
import { addTopic } from '@renderer/store/assistants'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { cancelThrottledBlockUpdate, throttledBlockUpdate } from '@renderer/store/thunk/messageThunk'
import type { FileMetadata, Topic } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, type Message, type MessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion, addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { defaultLanguage } from '@shared/config/constant'
import {
  assistantModelSelection,
  type ModelProviderSelection,
  resolveModelProviderSelection,
  selectionModelReference
} from '@shared/modelProviderSelection'
import { Button, Tooltip } from 'antd'
import cloneDeep from 'lodash/cloneDeep'
import isEmpty from 'lodash/isEmpty'
import last from 'lodash/last'
import { Image as ImageIcon, MessageSquareDiff, X } from 'lucide-react'
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
  finalizeMiniWindowErrorBlocks,
  getMiniWindowMessageWithBlock,
  getMiniWindowPersistedTopic,
  getMiniWindowResetState,
  getMiniWindowSupportExts,
  isMiniWindowChatModel,
  isMiniWindowComposingInput,
  isMiniWindowRequestCurrent,
  isMiniWindowSendKeyPressed,
  type MiniCaptureWindowInfo,
  type MiniWindowCaptureNotice
} from './miniWindowHelpers'

const logger = loggerService.withContext('HomeWindow')

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const { language, readClipboardAtStartup } = useSettings()
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
  const llm = useAppSelector((state) => state.llm)
  const selection = assistantModelSelection(defaultAssistant, llm)
  const resolvedSelection = resolveModelProviderSelection(selection, llm)
  const currentAssistant = useMemo(
    () => ({
      ...defaultAssistant,
      model: selectionModelReference(assistantModelSelection(defaultAssistant, llm), llm)
    }),
    [defaultAssistant, llm]
  )
  const supportedExts = useMemo(() => getMiniWindowSupportExts(currentAssistant), [currentAssistant])
  const canCaptureImage = supportedExts.length > 0

  const currentTopic = useRef<Topic>(getDefaultTopic(currentAssistant.id))
  const [activeTopic, setActiveTopic] = useState<Topic>(() => currentTopic.current)
  const currentAskId = useRef('')

  const inputBarRef = useRef<HTMLDivElement>(null)

  const referenceText = useMemo(() => clipboardText || userInputText, [clipboardText, userInputText])

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])
  const canSend =
    Boolean(resolvedSelection.model && isMiniWindowChatModel(resolvedSelection.model)) &&
    (userContent.trim().length > 0 || files.length > 0)

  useEffect(() => {
    const nextTopic = getDefaultTopic(currentAssistant.id)
    currentTopic.current = nextTopic
    setActiveTopic(nextTopic)
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
    void i18n.changeLanguage(defaultLanguage)
    setDayjsLocale()
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
    await refreshMiniWindowPersistedState()
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
    (modelSelection: ModelProviderSelection) => {
      const model = selectionModelReference(modelSelection, llm)
      updateDefaultAssistant({ ...defaultAssistant, modelSelection, model })
      setFiles((prevFiles) => {
        if (getMiniWindowSupportExts({ ...currentAssistant, model }).length) {
          return prevFiles
        }
        if (prevFiles.length > 0) {
          void FileManager.cleanupUncommittedDraftFiles(prevFiles)
        }
        return []
      })
    },
    [llm, currentAssistant, defaultAssistant, updateDefaultAssistant]
  )

  const removeFile = useCallback((fileId: string) => {
    setFiles((prevFiles) => {
      const removed = prevFiles.filter((file) => file.id === fileId)
      if (removed.length > 0) {
        void FileManager.cleanupUncommittedDraftFiles(removed)
      }
      return prevFiles.filter((file) => file.id !== fileId)
    })
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
      let isCurrentRequest = () => false
      let finishCurrentRequest = () => undefined
      let finalizePendingRequestOnFailure: ((isAborted: boolean) => void) | null = null
      let registeredAskId = ''
      let registeredAbortFn: (() => void) | undefined
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

        await dbService.appendMessage(topicId, userMessage, blocks)
        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        let assistantMessage = getAssistantMessage({
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        assistantMessage.askId = userMessage.id
        const requestAskId = userMessage.id
        currentAskId.current = requestAskId

        isCurrentRequest = () => isMiniWindowRequestCurrent(currentAskId.current, requestAskId)
        const markCurrentRequestOutputted = () => {
          if (isCurrentRequest()) {
            setIsOutputted(true)
          }
        }
        finishCurrentRequest = () => {
          if (!isCurrentRequest()) return
          setIsLoading(false)
          setIsOutputted(true)
          currentAskId.current = ''
        }

        await dbService.appendMessage(topicId, assistantMessage, [])
        store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        const persistAssistantMessageUpdate = (updates: Partial<Message>, label: string) => {
          assistantMessage = { ...assistantMessage, ...updates }
          queueMiniWindowPersist(() => dbService.updateMessage(topicId, assistantMessage.id, updates), label)
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
                dbService.bulkAddBlocks([block]),
                dbService.updateMessage(topicId, assistantMessage.id, { blocks: assistantMessage.blocks })
              ]).then(() => undefined),
            'assistant block'
          )
        }

        const persistBlockUpdate = (blockId: string, changes: Partial<MessageBlock>, label: string) => {
          queueMiniWindowPersist(() => dbService.updateSingleBlock(blockId, changes), label)
        }

        const allMessagesForTopic = selectMessagesForTopic(store.getState(), topicId)
        const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessage.id)

        const messagesForContext = allMessagesForTopic
          .slice(0, userMessageIndex + 1)
          .filter((m) => m && !m.status?.includes('ing'))

        let blockId: string | null = null
        let thinkingBlockId: string | null = null
        let thinkingStartTime: number | null = null
        let terminalHandled = false

        const resolveThinkingDuration = (duration?: number) => {
          if (typeof duration === 'number' && Number.isFinite(duration)) {
            return duration
          }
          if (thinkingStartTime !== null) {
            return Math.max(0, performance.now() - thinkingStartTime)
          }
          return 0
        }

        const finalizeAssistantFailure = (isAborted: boolean) => {
          if (terminalHandled) return
          terminalHandled = true
          finalizeMiniWindowErrorBlocks({
            thinkingBlockId,
            blockId,
            isAborted,
            cancelBlockThrottle: cancelThrottledBlockUpdate,
            readLatestBlock: (id) => store.getState().messageBlocks.entities[id],
            resolveThinkingDuration,
            applyBlockChanges: (id, changes) => {
              store.dispatch(updateOneBlock({ id, changes }))
              persistBlockUpdate(id, changes, 'error block')
            }
          })
          thinkingStartTime = null
          thinkingBlockId = null
          blockId = null
          const nextStatus = isAborted ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.ERROR
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
        finalizePendingRequestOnFailure = finalizeAssistantFailure

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        setIsFirstMessage(false)
        setUserInputText('')
        setFiles([])

        const newAssistant = cloneDeep(currentAssistant)
        // 显式关闭这些功能
        // replace prompt vars
        newAssistant.prompt = await replacePromptVariables(
          currentAssistant.prompt,
          currentAssistant.model?.name ?? currentAssistant.name
        )
        // logger.debug('newAssistant', newAssistant)

        const [{ ConversationService }, { fetchChatCompletion }] = await Promise.all([
          import('@renderer/services/ConversationService'),
          import('@renderer/services/ApiService')
        ])
        const { modelMessages } = await ConversationService.prepareMessagesForModel(messagesForContext, newAssistant)

        const abortController = new AbortController()
        const abortFn = () => abortController.abort()
        registeredAskId = requestAskId
        registeredAbortFn = abortFn
        addAbortController(requestAskId, abortFn)

        await fetchChatCompletion({
          messages: modelMessages,
          assistant: newAssistant,
          requestOptions: { signal: abortController.signal },
          topicId,
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_START:
                {
                  markCurrentRequestOutputted()
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
                  markCurrentRequestOutputted()
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
                  markCurrentRequestOutputted()
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
                  markCurrentRequestOutputted()
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
                if (terminalHandled) break
                //stop the thinking timer
                const isAborted = isAbortError(chunk.error)
                finalizeAssistantFailure(isAborted)
                if (!isAborted) {
                  throw new Error(chunk.error?.message || String(chunk.error || ''))
                }
                finishCurrentRequest()
                break
              }
              case ChunkType.BLOCK_COMPLETE:
                if (terminalHandled) break
                terminalHandled = true
                finishCurrentRequest()
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
        const aborted = isAbortError(err)
        finalizePendingRequestOnFailure?.(aborted)
        if (aborted) {
          finishCurrentRequest()
          return
        }
        if (isCurrentRequest()) {
          handleError(err instanceof Error ? err : new Error(t('message.error.unknown')))
        }
        logger.error('Error fetching result:', err as Error)
      } finally {
        if (registeredAskId && registeredAbortFn) {
          removeAbortController(registeredAskId, registeredAbortFn)
        }
        await persistQueue
        finishCurrentRequest()
      }
    },
    [ensureMiniTopicPersisted, files, userContent, currentAssistant, t]
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

  const handleNewTopic = useCallback(async () => {
    if (isLoading) {
      handlePause()
    }

    const newTopic = getDefaultTopic(currentAssistant.id)

    try {
      await db.topics.add({ id: newTopic.id, messages: [] })
      store.dispatch(addTopic({ assistantId: currentAssistant.id, topic: getMiniWindowPersistedTopic(newTopic) }))

      const resetState = getMiniWindowResetState()
      currentTopic.current = newTopic
      currentAskId.current = ''
      lastClipboardTextRef.current = null
      setActiveTopic(newTopic)
      setIsFirstMessage(resetState.isFirstMessage)
      setUserInputText(resetState.userInputText)
      setClipboardText(resetState.clipboardText)
      setFiles((prevFiles) => {
        if (prevFiles.length > 0) {
          void FileManager.cleanupUncommittedDraftFiles(prevFiles)
        }
        return resetState.files
      })
      setFilePreviewUrls(resetState.filePreviewUrls)
      setCaptureWindows(resetState.captureWindows)
      setIsLoading(resetState.isLoading)
      setIsOutputted(resetState.isOutputted)
      setError(resetState.error)
      focusInput()
    } catch (error) {
      logger.error('Failed to create mini window topic:', error as Error)
      const message = error instanceof Error ? error.message : t('message.error.unknown')
      setError(message)
      window.toast.error(message)
    }
  }, [currentAssistant.id, focusInput, handlePause, isLoading, t])

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
    const lastMessage = last(messages)

    if (lastMessage) {
      const content = getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(content)
      window.toast.success(t('message.copy.success'))
    }
  }, [currentTopic, t])

  const backgroundColor = 'var(--color-background)'

  // Memoize placeholder text
  const inputPlaceholder = useMemo(() => {
    return t('miniwindow.input.placeholder.empty', {
      model: currentAssistant.model?.name ?? currentAssistant.name
    })
  }, [t, currentAssistant])
  const newTopicLabel = useMemo(() => t('chat.input.new_topic', { Command: '' }).trim(), [t])

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
      <BrandArea title="lich13studio">
        {currentAssistant.model ? <ModelAvatar model={currentAssistant.model} size={20} /> : <ImageIcon size={18} />}
        <BrandTitle>lich13studio</BrandTitle>
      </BrandArea>
      <HeaderActions className="nodrag">
        <ModelProviderSelect
          compact
          layout="inline"
          shrinkToFit
          showEffort
          selection={selection}
          onChange={handleModelChange}
        />
      </HeaderActions>
      <Tooltip placement="bottomRight" title={newTopicLabel} mouseLeaveDelay={0} arrow>
        <HeaderIconButton
          className="nodrag"
          type="text"
          aria-label={newTopicLabel}
          onClick={() => void handleNewTopic()}>
          <MessageSquareDiff size={16} />
        </HeaderIconButton>
      </Tooltip>
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
          topic={activeTopic}
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 30px;
  flex-shrink: 0;
  min-width: 0;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 2px 0 5px;
`

const BrandArea = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;

  > :first-child { flex-shrink: 0; }
`

const BrandTitle = styled.div`
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  -webkit-app-region: no-drag;
`

const HeaderIconButton = styled(Button)`
  display: inline-flex;
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: var(--color-background);

  &:hover,
  &:focus-visible {
    color: var(--color-primary);
    background: var(--color-background-mute);
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  }
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
