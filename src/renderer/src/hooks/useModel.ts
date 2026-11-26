import { createSelector } from '@reduxjs/toolkit'
import store, { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'

import { selectAllProviders, selectEnabledProviders } from './useProvider'

function buildModelIndex(providers: Array<{ models: Model[] }>) {
  const byKey = new Map<string, Model>()
  const byId = new Map<string, Model>()
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      const key = `${model.provider}\0${model.id}`
      if (!byKey.has(key)) byKey.set(key, model)
      if (!byId.has(model.id)) byId.set(model.id, model)
    }
  }
  return { byKey, byId }
}

export const selectModelMap = createSelector([selectEnabledProviders], buildModelIndex)
const selectAllModelMap = createSelector([selectAllProviders], buildModelIndex)

export function useModel(id?: string, providerId?: string) {
  const modelMap = useAppSelector((state) => (id ? selectModelMap(state) : null))
  if (!id || !modelMap) return undefined
  return providerId ? modelMap.byKey.get(`${providerId}\0${id}`) : modelMap.byId.get(id)
}

export function getModel(id?: string, providerId?: string) {
  if (!id) return undefined
  const modelMap = selectAllModelMap(store.getState())
  return providerId ? modelMap.byKey.get(`${providerId}\0${id}`) : modelMap.byId.get(id)
}
