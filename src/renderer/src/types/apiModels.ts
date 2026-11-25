import type { Model } from '@types'

import type { ProviderType } from './provider'

export interface ApiModelsFilter {
  providerType?: ProviderType
  offset?: number
  limit?: number
}

export interface ApiModel {
  id: string
  object: 'model'
  created: number
  name: string
  owned_by: string
  provider?: string
  provider_name?: string
  provider_type?: ProviderType
  provider_model_id?: string
}

export interface ApiModelsResponse {
  object: 'list'
  data: ApiModel[]
  total?: number
  offset?: number
  limit?: number
}

export type AdaptedApiModel = Model & {
  origin: ApiModel
}
