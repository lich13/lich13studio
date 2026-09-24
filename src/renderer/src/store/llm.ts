/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import { SYSTEM_PROVIDERS } from '@renderer/config/providers'
import { type AwsBedrockAuthType, type Model, type Provider, ProviderTypeSchema } from '@renderer/types'
import type { CliVersionCache, CliVersions } from '@shared/cliIdentity'
import {
  catalogModel,
  createPlatformModels,
  inferProviderPlatform,
  type PlatformModel,
  type PlatformModels,
  type ProviderPlatform,
  type StoredProvider,
  storedProvider
} from '@shared/platforms'
import { normalizeProviderEndpoint } from '@shared/providerImport'

type LlmSettings = {
  ollama: {
    keepAliveTime: number
  }
  lmstudio: {
    keepAliveTime: number
  }
  gpustack: {
    keepAliveTime: number
  }
  vertexai: {
    serviceAccount: {
      privateKey: string
      clientEmail: string
    }
    projectId: string
    location: string
  }
  awsBedrock: {
    authType: AwsBedrockAuthType
    accessKeyId: string
    secretAccessKey: string
    apiKey: string
    region: string
  }
  cherryIn: {
    accessToken: string
    refreshToken: string
  }
}

export interface LlmState {
  providers: StoredProvider[]
  platformModels: PlatformModels
  cliVersions: CliVersions
  defaultModel?: Model
  /** @deprecated */
  topicNamingModel?: Model
  quickModel?: Model
  translateModel?: Model
  quickAssistantId: string
  settings: LlmSettings
}

export const initialState: LlmState = {
  defaultModel: undefined,
  topicNamingModel: undefined,
  quickModel: undefined,
  translateModel: undefined,
  quickAssistantId: '',
  providers: SYSTEM_PROVIDERS,
  platformModels: createPlatformModels(),
  cliVersions: {},
  settings: {
    ollama: {
      keepAliveTime: 0
    },
    lmstudio: {
      keepAliveTime: 0
    },
    gpustack: {
      keepAliveTime: 0
    },
    vertexai: {
      serviceAccount: {
        privateKey: '',
        clientEmail: ''
      },
      projectId: '',
      location: ''
    },
    awsBedrock: {
      authType: 'iam',
      accessKeyId: '',
      secretAccessKey: '',
      apiKey: '',
      region: ''
    },
    cherryIn: {
      accessToken: '',
      refreshToken: ''
    }
  }
}

export const moveProvider = (providers: Provider[], id: string, position: number) => {
  const index = providers.findIndex((p) => p.id === id)
  if (index === -1) return providers

  const provider = providers[index]
  const newProviders = [...providers]
  newProviders.splice(index, 1)
  newProviders.splice(position - 1, 0, provider)
  return newProviders
}

const llmSlice = createSlice({
  name: 'llm',
  initialState: initialState,
  reducers: {
    updateProvider: (state, action: PayloadAction<Partial<Provider> & { id: string }>) => {
      if (action.payload.type) ProviderTypeSchema.parse(action.payload.type)
      const index = state.providers.findIndex((p) => p.id === action.payload.id)
      if (index !== -1) {
        const updated = storedProvider({ ...state.providers[index], ...action.payload })
        updated.apiHost = normalizeProviderEndpoint(updated.apiHost)
        state.providers[index] = updated
      }
    },
    updateProviders: (state, action: PayloadAction<Provider[]>) => {
      state.providers = action.payload
        .filter((provider) => ProviderTypeSchema.safeParse(provider.type).success)
        .map(storedProvider)
    },
    addProvider: (state, action: PayloadAction<Provider>) => {
      ProviderTypeSchema.parse(action.payload.type)
      state.providers.unshift(storedProvider(action.payload))
    },
    removeProvider: (state, action: PayloadAction<Provider>) => {
      const providerIndex = state.providers.findIndex((p) => p.id === action.payload.id)
      if (providerIndex !== -1) {
        state.providers.splice(providerIndex, 1)
      }
    },
    setPlatformModels: (state, action: PayloadAction<{ platform: ProviderPlatform; models: PlatformModel[] }>) => {
      state.platformModels[action.payload.platform] = action.payload.models.map(catalogModel)
    },
    setCliVersion: (state, action: PayloadAction<{ platform: ProviderPlatform; cache: CliVersionCache }>) => {
      state.cliVersions[action.payload.platform] = action.payload.cache
    },
    importPlatformProvider: (
      state,
      action: PayloadAction<{ provider: Provider; models: string[]; primaryModel?: string }>
    ) => {
      const { provider, models, primaryModel } = action.payload
      const platform = inferProviderPlatform(provider)
      const catalog = state.platformModels[platform]
      for (const id of models)
        if (!catalog.some((model) => model.id === id)) catalog.push({ id, name: id, group: platform })
      if (!state.providers.some((existing) => existing.id === provider.id))
        state.providers.unshift(storedProvider(provider))
      if (!state.defaultModel?.id) {
        const selected = catalog.find((model) => model.id === primaryModel) ?? catalog[0]
        if (selected) state.defaultModel = { ...selected, provider: provider.id }
      }
    },
    addModel: (state, action: PayloadAction<{ providerId: string; model: Model }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (!provider) return
      const models = state.platformModels[inferProviderPlatform(provider)]
      if (!models.some((model) => model.id === action.payload.model.id)) models.push(catalogModel(action.payload.model))
    },
    removeModel: (state, action: PayloadAction<{ providerId: string; model: Model }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (!provider) return
      const platform = inferProviderPlatform(provider)
      state.platformModels[platform] = state.platformModels[platform].filter(
        (model) => model.id !== action.payload.model.id
      )
    },
    setDefaultModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.defaultModel = action.payload.model
    },
    setQuickModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.quickModel = action.payload.model
    },
    setTranslateModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.translateModel = action.payload.model
    },

    setQuickAssistantId: (state, action: PayloadAction<string>) => {
      state.quickAssistantId = action.payload
    },
    setOllamaKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.ollama.keepAliveTime = action.payload
    },
    setLMStudioKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.lmstudio.keepAliveTime = action.payload
    },
    setGPUStackKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.gpustack.keepAliveTime = action.payload
    },
    setVertexAIProjectId: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.projectId = action.payload
    },
    setVertexAILocation: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.location = action.payload
    },
    setVertexAIServiceAccountPrivateKey: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.serviceAccount.privateKey = action.payload
    },
    setVertexAIServiceAccountClientEmail: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.serviceAccount.clientEmail = action.payload
    },
    setAwsBedrockAuthType: (state, action: PayloadAction<AwsBedrockAuthType>) => {
      state.settings.awsBedrock.authType = action.payload
    },
    setAwsBedrockAccessKeyId: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.accessKeyId = action.payload
    },
    setAwsBedrockSecretAccessKey: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.secretAccessKey = action.payload
    },
    setAwsBedrockApiKey: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.apiKey = action.payload
    },
    setAwsBedrockRegion: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.region = action.payload
    },
    setCherryInTokens: (state, action: PayloadAction<{ accessToken: string; refreshToken?: string }>) => {
      if (!state.settings.cherryIn) {
        state.settings.cherryIn = {
          accessToken: '',
          refreshToken: ''
        }
      }

      state.settings.cherryIn.accessToken = action.payload.accessToken

      if (action.payload.refreshToken !== undefined) {
        state.settings.cherryIn.refreshToken = action.payload.refreshToken
      }
    },
    clearCherryInTokens: (state) => {
      state.settings.cherryIn.accessToken = ''
      state.settings.cherryIn.refreshToken = ''
    },
    updateModel: (
      state,
      action: PayloadAction<{
        providerId: string
        model: Model
      }>
    ) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (provider) {
        const models = state.platformModels[inferProviderPlatform(provider)]
        const modelIndex = models.findIndex((m) => m.id === action.payload.model.id)
        if (modelIndex !== -1) {
          models[modelIndex] = catalogModel(action.payload.model)
        }
      }
    }
  }
})

export const {
  setPlatformModels,
  setCliVersion,
  importPlatformProvider,
  updateProvider,
  updateProviders,
  addProvider,
  removeProvider,
  addModel,
  removeModel,
  setDefaultModel,
  setQuickModel,
  setTranslateModel,
  setQuickAssistantId,
  setOllamaKeepAliveTime,
  setLMStudioKeepAliveTime,
  setGPUStackKeepAliveTime,
  setVertexAIProjectId,
  setVertexAILocation,
  setVertexAIServiceAccountPrivateKey,
  setVertexAIServiceAccountClientEmail,
  setAwsBedrockAuthType,
  setAwsBedrockAccessKeyId,
  setAwsBedrockSecretAccessKey,
  setAwsBedrockApiKey,
  setAwsBedrockRegion,
  setCherryInTokens,
  clearCherryInTokens,
  updateModel
} = llmSlice.actions

export default llmSlice.reducer
