import type { Middleware } from '@reduxjs/toolkit'
import { installModelCatalog } from '@shared/modelCatalog/runtime'
import type { PlatformModelCatalogSnapshot } from '@shared/modelCatalog/types'

/** Catalog bytes travel through store sync but only user directory edits are persisted. */
export const modelCatalogMiddleware: Middleware = () => (next) => (action) => {
  const update = action as { type?: string; payload?: PlatformModelCatalogSnapshot }
  if (update.type === 'llm/applyPlatformCatalog' && update.payload) installModelCatalog(update.payload)
  return next(action)
}
