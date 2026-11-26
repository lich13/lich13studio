import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import { EMPTY_MODEL, getDefaultTopic } from '@renderer/services/AssistantService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistant,
  addTopic,
  insertAssistant,
  removeAllTopics,
  removeAssistant,
  removeTopic,
  setModel,
  updateAssistant,
  updateAssistants,
  updateAssistantSettings as _updateAssistantSettings,
  updateDefaultAssistant,
  updateTopic,
  updateTopics
} from '@renderer/store/assistants'
import { setDefaultModel, setQuickModel, setTranslateModel } from '@renderer/store/llm'
import type { Assistant, AssistantSettings, Model, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { assistantModelSelection, selectionModelReference } from '@shared/modelProviderSelection'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useModel } from './useModel'
import { TopicManager } from './useTopic'

export function useAssistants() {
  const { t } = useTranslation()
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()
  const logger = loggerService.withContext('useAssistants')

  return {
    assistants,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => dispatch(addAssistant(assistant)),
    insertAssistant: (index: number, assistant: Assistant) => dispatch(insertAssistant({ index, assistant })),
    copyAssistant: (assistant: Assistant): Assistant | undefined => {
      if (!assistant) {
        logger.error("assistant doesn't exists.")
        return
      }
      const index = assistants.findIndex((_assistant) => _assistant.id === assistant.id)
      const _assistant: Assistant = { ...assistant, id: uuid(), topics: [getDefaultTopic(assistant.id)] }
      if (index === -1) {
        logger.warn("Origin assistant's id not found. Fallback to addAssistant.")
        dispatch(addAssistant(_assistant))
      } else {
        // 插入到后面
        try {
          dispatch(insertAssistant({ index: index + 1, assistant: _assistant }))
        } catch (e) {
          logger.error('Failed to insert assistant', e as Error)
          window.toast.error(t('message.error.copy'))
        }
      }
      return _assistant
    },
    removeAssistant: async (id: string) => {
      const assistant = assistants.find((a) => a.id === id)
      const topics = Array.isArray(assistant?.topics) ? assistant.topics : []
      const results = await Promise.allSettled(topics.map(({ id: topicId }) => TopicManager.removeTopic(topicId)))
      let firstError: unknown = null
      let failedCount = 0
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          dispatch(removeTopic({ assistantId: id, topic: topics[index] }))
        } else {
          failedCount += 1
          firstError ??= result.reason
        }
      })
      if (failedCount > 0) {
        const err = firstError instanceof Error ? firstError : new Error(String(firstError ?? 'Failed to delete topic'))
        logger.error('Failed to remove all topics before deleting assistant', err)
        window.toast?.error(t('common.delete_failed'))
        throw err
      }
      dispatch(removeAssistant({ id }))
    }
  }
}

export function useAssistant(id: string) {
  const { t } = useTranslation()
  const logger = loggerService.withContext('useAssistant')
  const assistant = useAppSelector((state) => state.assistants.assistants.find((a) => a.id === id) as Assistant)
  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()
  const llm = useAppSelector((state) => state.llm)

  const savedModel = assistant?.model ?? assistant?.defaultModel ?? defaultModel ?? EMPTY_MODEL
  const currentModel = useModel(savedModel.id, savedModel.provider)
  const model = useMemo(
    () =>
      assistant?.modelSelection
        ? selectionModelReference(assistantModelSelection(assistant, llm), llm)
        : (currentModel ?? savedModel),
    [assistant, llm, currentModel, savedModel]
  )

  const normalizedTopics = useMemo(
    () => (Array.isArray(assistant?.topics) ? assistant.topics : []),
    [assistant?.topics]
  )
  const assistantWithModel = useMemo(
    () => ({ ...assistant, model, topics: normalizedTopics }),
    [assistant, model, normalizedTopics]
  )

  const settingsRef = useRef(assistant?.settings)

  useEffect(() => {
    settingsRef.current = assistant?.settings
  }, [assistant?.settings])

  const updateAssistantSettings = useCallback(
    (settings: Partial<AssistantSettings>) => {
      assistant?.id && dispatch(_updateAssistantSettings({ assistantId: assistant.id, settings }))
    },
    [assistant?.id, dispatch]
  )

  return {
    assistant: assistantWithModel,
    model,
    addTopic: (topic: Topic) => dispatch(addTopic({ assistantId: assistant.id, topic })),
    removeTopic: async (topic: Topic) => {
      await TopicManager.removeTopic(topic.id)
      dispatch(removeTopic({ assistantId: assistant.id, topic }))
    },
    moveTopic: (topic: Topic, toAssistant: Assistant) => {
      dispatch(addTopic({ assistantId: toAssistant.id, topic: { ...topic, assistantId: toAssistant.id } }))
      dispatch(removeTopic({ assistantId: assistant.id, topic }))
      // update topic messages in database
      void db.topics
        .where('id')
        .equals(topic.id)
        .modify((dbTopic) => {
          if (dbTopic.messages) {
            dbTopic.messages = dbTopic.messages.map((message) => ({
              ...message,
              assistantId: toAssistant.id
            }))
          }
        })
    },
    updateTopic: (topic: Topic) => dispatch(updateTopic({ assistantId: assistant.id, topic })),
    updateTopics: (topics: Topic[]) => dispatch(updateTopics({ assistantId: assistant.id, topics })),
    removeAllTopics: async () => {
      if (!assistant) return
      const results = await Promise.allSettled(normalizedTopics.map((topic) => TopicManager.removeTopic(topic.id)))
      let failedCount = 0
      let firstError: unknown = null
      results.forEach((result) => {
        if (result.status === 'rejected') {
          failedCount += 1
          firstError ??= result.reason
        }
      })
      if (failedCount > 0) {
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            dispatch(removeTopic({ assistantId: assistant.id, topic: normalizedTopics[index] }))
          }
        })
        const err = firstError instanceof Error ? firstError : new Error(String(firstError ?? 'Failed to delete topic'))
        logger.error('Failed to remove all topics', err)
        window.toast?.error(t('common.delete_failed'))
        throw err
      }
      const defaultTopic = getDefaultTopic(assistant.id)
      dispatch(removeAllTopics({ assistantId: assistant.id, defaultTopic }))
    },
    setModel: useCallback(
      (model: Model) => assistant && dispatch(setModel({ assistantId: assistant?.id, model })),
      [assistant, dispatch]
    ),
    updateAssistant: useCallback(
      (update: Partial<Omit<Assistant, 'id'>>) => dispatch(updateAssistant({ id, ...update })),
      [dispatch, id]
    ),
    updateAssistantSettings
  }
}

export function useDefaultAssistant() {
  const defaultAssistant = useAppSelector((state) => state.assistants.defaultAssistant)
  const dispatch = useAppDispatch()
  const memoizedTopics = useMemo(() => [getDefaultTopic(defaultAssistant.id)], [defaultAssistant.id])

  return {
    defaultAssistant: {
      ...defaultAssistant,
      topics: memoizedTopics
    },
    updateDefaultAssistant: (assistant: Assistant) => dispatch(updateDefaultAssistant({ assistant }))
  }
}

export function useDefaultModel() {
  const { defaultModel, quickModel, translateModel } = useAppSelector((state) => state.llm)
  const dispatch = useAppDispatch()

  return {
    defaultModel,
    quickModel,
    translateModel,
    setDefaultModel: (model: Model) => dispatch(setDefaultModel({ model })),
    setQuickModel: (model: Model) => dispatch(setQuickModel({ model })),
    setTranslateModel: (model: Model) => dispatch(setTranslateModel({ model }))
  }
}
