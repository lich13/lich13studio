import type { Draft, PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import i18n from '@renderer/i18n'
import type { Assistant, AssistantPreset, AssistantSettings, Model, Topic } from '@renderer/types'
import isEmpty from 'lodash/isEmpty'
import uniqBy from 'lodash/uniqBy'

import type { RootState } from '.'

export const DEFAULT_ASSISTANT_SETTINGS = {
  maxTokens: DEFAULT_MAX_TOKENS,
  enableMaxTokens: false,
  temperature: DEFAULT_TEMPERATURE,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  contextCount: DEFAULT_CONTEXTCOUNT,
  defaultModel: undefined,
  customParameters: [],
  reasoning_effort: 'max',
  reasoning_effort_cache: undefined,
  qwenThinkMode: undefined,
  toolUseMode: 'function',
  maxToolCalls: 20,
  enableMaxToolCalls: true
} as const satisfies AssistantSettings

export function getDefaultTopic(assistantId: string): Topic {
  return {
    id: crypto.randomUUID(),
    assistantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: i18n.t('chat.default.topic.name'),
    messages: [],
    isNameManuallyEdited: false
  }
}

export function getDefaultAssistant(): Assistant {
  return {
    id: 'default',
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    topics: [getDefaultTopic('default')],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: DEFAULT_ASSISTANT_SETTINGS
  }
}

export interface AssistantsState {
  defaultAssistant: Assistant
  assistants: Assistant[]
  tagsOrder: string[]
  collapsedTags?: Record<string, boolean>
  presets: AssistantPreset[]
}

const initialState: AssistantsState = {
  defaultAssistant: getDefaultAssistant(),
  assistants: [getDefaultAssistant()],
  tagsOrder: [],
  collapsedTags: {},
  presets: []
}

const normalizeTopics = <T extends Topic | Draft<Topic>>(topics: readonly T[] | undefined | null): T[] =>
  Array.isArray(topics) ? [...topics] : []

const assistantsSlice = createSlice({
  name: 'assistants',
  initialState,
  reducers: {
    updateDefaultAssistant: (state, action: PayloadAction<{ assistant: Assistant }>) => {
      state.defaultAssistant = action.payload.assistant as Draft<Assistant>
    },
    updateAssistants: (state, action: PayloadAction<Assistant[]>) => {
      state.assistants = action.payload as Draft<Assistant[]>
    },
    addAssistant: (state, action: PayloadAction<Assistant>) => {
      state.assistants.unshift(action.payload as Draft<Assistant>)
    },
    insertAssistant: (state, action: PayloadAction<{ index: number; assistant: Assistant }>) => {
      const { index, assistant } = action.payload

      if (index < 0 || index > state.assistants.length) {
        throw new Error(`InsertAssistant: index ${index} is out of bounds [0, ${state.assistants.length}]`)
      }

      state.assistants.splice(index, 0, assistant as Draft<Assistant>)
    },
    removeAssistant: (state, action: PayloadAction<{ id: string }>) => {
      state.assistants = state.assistants.filter((c) => c.id !== action.payload.id)
    },
    updateAssistant: (state, action: PayloadAction<Partial<Assistant> & { id: string }>) => {
      const { id, ...update } = action.payload
      if ('model' in update && !('modelSelection' in update)) update.modelSelection = undefined
      state.assistants = state.assistants.map((c) => (c.id === id ? ({ ...c, ...update } as Draft<Assistant>) : c))
    },
    updateAssistantSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      for (const assistant of state.assistants) {
        const settings = action.payload.settings
        if (assistant.id === action.payload.assistantId) {
          if (!assistant.settings) {
            assistant.settings = {
              temperature: DEFAULT_TEMPERATURE,
              contextCount: DEFAULT_CONTEXTCOUNT,
              enableMaxTokens: false,
              maxTokens: 0
            }
          }
          Object.assign(assistant.settings, settings)
        }
      }
    },
    setTagsOrder: (state, action: PayloadAction<string[]>) => {
      const newOrder = action.payload
      state.tagsOrder = newOrder
      const prevCollapsed = state.collapsedTags || {}
      const updatedCollapsed: Record<string, boolean> = { ...prevCollapsed }
      newOrder.forEach((tag) => {
        if (!(tag in updatedCollapsed)) {
          updatedCollapsed[tag] = false
        }
      })
      state.collapsedTags = updatedCollapsed
    },
    updateTagCollapse: (state, action: PayloadAction<string>) => {
      const tag = action.payload
      const prev = state.collapsedTags || {}
      state.collapsedTags = {
        ...prev,
        [tag]: !prev[tag]
      }
    },
    addTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      const topic: Topic = {
        ...action.payload.topic,
        createdAt: action.payload.topic.createdAt || new Date().toISOString(),
        updatedAt: action.payload.topic.updatedAt || new Date().toISOString()
      }
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: uniqBy([topic as Draft<Topic>, ...normalizeTopics(assistant.topics)], 'id')
            }
          : assistant
      )
    },
    removeTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: normalizeTopics(assistant.topics).filter(({ id }) => id !== action.payload.topic.id)
            }
          : assistant
      )
    },
    updateTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      const newTopic: Topic = {
        ...action.payload.topic,
        updatedAt: new Date().toISOString(),
        messages: []
      }
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: normalizeTopics(assistant.topics).map((topic) => {
                if (topic.id === newTopic.id) {
                  return newTopic as Draft<Topic>
                }
                topic.messages = []
                return topic
              })
            }
          : assistant
      )
    },
    updateTopics: (state, action: PayloadAction<{ assistantId: string; topics: Topic[] }>) => {
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: action.payload.topics.map(
                (topic) => (isEmpty(topic.messages) ? topic : { ...topic, messages: [] }) as Draft<Topic>
              )
            }
          : assistant
      )
    },
    removeAllTopics: (state, action: PayloadAction<{ assistantId: string; defaultTopic?: Topic }>) => {
      state.assistants = state.assistants.map((assistant) => {
        if (assistant.id === action.payload.assistantId) {
          return {
            ...assistant,
            topics: [(action.payload.defaultTopic ?? getDefaultTopic(assistant.id)) as Draft<Topic>]
          }
        }
        return assistant
      })
    },
    updateTopicUpdatedAt: (state, action: PayloadAction<{ topicId: string }>) => {
      outer: for (const assistant of state.assistants) {
        for (const topic of normalizeTopics(assistant.topics)) {
          if (topic.id === action.payload.topicId) {
            topic.updatedAt = new Date().toISOString()
            break outer
          }
        }
      }
    },
    setModel: (state, action: PayloadAction<{ assistantId: string; model: Model }>) => {
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              model: action.payload.model as Draft<Model>,
              modelSelection: undefined
            }
          : assistant
      )
    },
    setAssistantPresets: (state, action: PayloadAction<AssistantPreset[]>) => {
      state.presets = action.payload.map((preset) => preset as Draft<AssistantPreset>)
    },
    addAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      state.presets.push(action.payload as Draft<AssistantPreset>)
    },
    removeAssistantPreset: (state, action: PayloadAction<{ id: string }>) => {
      state.presets = state.presets.filter((c) => c.id !== action.payload.id)
    },
    updateAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      const preset = action.payload
      const index = state.presets.findIndex((a) => a.id === preset.id)
      if (index !== -1) {
        state.presets[index] = preset as Draft<AssistantPreset>
      }
    },
    updateAssistantPresetSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      for (const agent of state.presets) {
        const settings = action.payload.settings
        if (agent.id === action.payload.assistantId) {
          if (!agent.settings) {
            agent.settings = { ...DEFAULT_ASSISTANT_SETTINGS } as Draft<AssistantSettings>
          }
          Object.assign(agent.settings, settings)
        }
      }
    }
  }
})

export const {
  updateDefaultAssistant,
  updateAssistants,
  addAssistant,
  insertAssistant,
  removeAssistant,
  updateAssistant,
  addTopic,
  removeTopic,
  updateTopic,
  updateTopics,
  removeAllTopics,
  updateTopicUpdatedAt,
  setModel,
  setTagsOrder,
  updateAssistantSettings,
  updateTagCollapse,
  setAssistantPresets,
  addAssistantPreset,
  removeAssistantPreset,
  updateAssistantPreset,
  updateAssistantPresetSettings
} = assistantsSlice.actions

export const selectAllTopics = createSelector([(state: RootState) => state.assistants.assistants], (assistants) =>
  assistants.flatMap((assistant: Assistant) => normalizeTopics(assistant.topics))
)

export const selectTopicsMap = createSelector([selectAllTopics], (topics) => {
  return topics.reduce((map, topic) => {
    map.set(topic.id, topic)
    return map
  }, new Map<string, Topic>())
})

export default assistantsSlice.reducer
