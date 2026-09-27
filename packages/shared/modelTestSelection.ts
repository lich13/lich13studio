import { type ModelProviderCatalog, selectionFromModel } from './modelProviderSelection'

export type {
  ModelProviderCatalog as ModelTestCatalog,
  ModelProviderSelection as ModelTestSelection
} from './modelProviderSelection'
export { resolveModelProviderSelection as resolveModelTestSelection } from './modelProviderSelection'

/** Preferences only: never persist running tasks, credentials or test output. */
export function initialModelTestSelection(catalog: Pick<ModelProviderCatalog, 'providers' | 'defaultModel'>) {
  return selectionFromModel(catalog.defaultModel, catalog.providers)
}
