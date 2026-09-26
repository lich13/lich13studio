import { modelTestSession } from '@renderer/services/modelTrace/ModelTestSessionService'
import { useSyncExternalStore } from 'react'

export function useModelTestSession() {
  return useSyncExternalStore(modelTestSession.subscribe, modelTestSession.getSnapshot)
}
