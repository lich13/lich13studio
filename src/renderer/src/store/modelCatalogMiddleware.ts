import type { Middleware } from '@reduxjs/toolkit'
import { installModelCatalog } from '@shared/modelCatalog/runtime'
import type { PlatformModelCatalogSnapshot } from '@shared/modelCatalog/types'

/** Catalog bytes travel through store sync but only user directory edits are persisted. */
export const modelCatalogMiddleware: Middleware = () => (next) => (action) => {
  const update = action as {
    type?: string
    payload?: PlatformModelCatalogSnapshot | PlatformModelCatalogSnapshot[]
  }
  if (update.type === 'llm/applyPlatformCatalog' && update.payload && !Array.isArray(update.payload)) {
    installModelCatalog(update.payload)
  } else if (update.type === 'llm/applyPlatformCatalogs' && Array.isArray(update.payload)) {
    for (const snapshot of update.payload) {
      installModelCatalog(snapshot)
    }
  }
  return next(action)
}
