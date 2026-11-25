import { useEffect, useRef } from 'react'

const actions: Array<() => void> = []
let activeHistoryBackHandler: (() => boolean) | null = null

export function registerActiveHistoryBackHandler(handler: () => boolean): () => void {
  activeHistoryBackHandler = handler
  return () => {
    if (activeHistoryBackHandler === handler) {
      activeHistoryBackHandler = null
    }
  }
}

export function popActiveHistoryRoute(): boolean {
  return activeHistoryBackHandler ? activeHistoryBackHandler() : false
}

export function useMobileBack(active: boolean, action: () => void) {
  const current = useRef(action)
  current.current = action
  useEffect(() => {
    if (!active) return
    const callback = () => current.current()
    actions.push(callback)
    return () => {
      const index = actions.indexOf(callback)
      if (index >= 0) actions.splice(index, 1)
    }
  }, [active])
}

export function handleMobileBack() {
  const action = actions.at(-1)
  action?.()
  return Boolean(action)
}
