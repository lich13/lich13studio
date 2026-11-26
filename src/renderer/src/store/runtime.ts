import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import { AppLogo, UserAvatar } from '@renderer/config/env'

export interface ChatState {
  isMultiSelectMode: boolean
  selectedMessageIds: string[]
  renamingTopics: string[]
  newlyRenamedTopics: string[]
}

export interface ExportState {
  isExporting: boolean
}

export interface RuntimeState {
  avatar: string
  searching: boolean
  filesPath: string
  resourcesPath: string
  export: ExportState
  chat: ChatState
}

const initialState: RuntimeState = {
  avatar: UserAvatar,
  searching: false,
  filesPath: '',
  resourcesPath: '',
  export: {
    isExporting: false
  },
  chat: {
    isMultiSelectMode: false,
    selectedMessageIds: [],
    renamingTopics: [],
    newlyRenamedTopics: []
  }
}

const runtimeSlice = createSlice({
  name: 'runtime',
  initialState,
  reducers: {
    setAvatar: (state, action: PayloadAction<string | null>) => {
      state.avatar = action.payload || AppLogo
    },
    setSearching: (state, action: PayloadAction<boolean>) => {
      state.searching = action.payload
    },
    setFilesPath: (state, action: PayloadAction<string>) => {
      state.filesPath = action.payload
    },
    setResourcesPath: (state, action: PayloadAction<string>) => {
      state.resourcesPath = action.payload
    },
    setExportState: (state, action: PayloadAction<Partial<ExportState>>) => {
      state.export = { ...state.export, ...action.payload }
    },
    toggleMultiSelectMode: (state, action: PayloadAction<boolean>) => {
      state.chat.isMultiSelectMode = action.payload
      if (!action.payload) {
        state.chat.selectedMessageIds = []
      }
    },
    setSelectedMessageIds: (state, action: PayloadAction<string[]>) => {
      state.chat.selectedMessageIds = action.payload
    },
    setRenamingTopics: (state, action: PayloadAction<string[]>) => {
      state.chat.renamingTopics = action.payload
    },
    setNewlyRenamedTopics: (state, action: PayloadAction<string[]>) => {
      state.chat.newlyRenamedTopics = action.payload
    }
  }
})

export const {
  setAvatar,
  setSearching,
  setFilesPath,
  setResourcesPath,
  setExportState,
  toggleMultiSelectMode,
  setSelectedMessageIds,
  setRenamingTopics,
  setNewlyRenamedTopics
} = runtimeSlice.actions

export default runtimeSlice.reducer
