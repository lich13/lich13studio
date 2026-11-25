import { mobileCommand, runtimeCapabilities } from '@renderer/services/mobile/runtime'
import {
  PROVIDER_IMPORT_MAX_LINK_LENGTH,
  PROVIDER_IMPORT_MAX_QUEUE,
  PROVIDER_IMPORT_REJECTED_MARKER
} from '@shared/providerImport'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Credentials only live in this in-memory queue until the user confirms import.
const pending = new Set<string>()
const queue: string[] = []
let listener: (() => void) | undefined
let started = false

export function enqueueProviderImports(urls: readonly string[], allowInvalid = false): void {
  let rejected = false
  for (const raw of urls) {
    if (typeof raw !== 'string') continue
    const url = raw.trim()
    if (!url) continue
    if (!allowInvalid && !/^ccswitch:/i.test(url)) continue
    if (pending.has(url)) continue
    if (
      url === PROVIDER_IMPORT_REJECTED_MARKER ||
      url.length > PROVIDER_IMPORT_MAX_LINK_LENGTH ||
      pending.size >= PROVIDER_IMPORT_MAX_QUEUE
    ) {
      rejected = true
      continue
    }
    pending.add(url)
    queue.push(url)
  }
  // Over-limit links are dropped without retaining their contents; one marker
  // lets the handler show a single notice.
  if (rejected && !pending.has(PROVIDER_IMPORT_REJECTED_MARKER)) {
    pending.add(PROVIDER_IMPORT_REJECTED_MARKER)
    queue.push(PROVIDER_IMPORT_REJECTED_MARKER)
  }
  if (queue.length > 0) {
    listener?.()
  }
}

export function submitProviderImportText(rawText: string): void {
  const trimmed = rawText.trim()
  if (!trimmed) return
  if (trimmed.length > PROVIDER_IMPORT_MAX_LINK_LENGTH) {
    enqueueProviderImports([PROVIDER_IMPORT_REJECTED_MARKER], true)
    return
  }
  const embeddedMatch = /^ccswitch:\/\//i.test(trimmed) ? trimmed : (trimmed.match(/ccswitch:\/\/\S+/i)?.[0] ?? trimmed)
  enqueueProviderImports([embeddedMatch], true)
}

export function startProviderImportListener(): void {
  if (
    started ||
    !runtimeCapabilities.android ||
    typeof window === 'undefined' ||
    !(window as any).__TAURI_INTERNALS__ ||
    getCurrentWindow().label !== 'main'
  ) {
    return
  }
  started = true
  const receive = async () => {
    const result = await mobileCommand<{ items?: string[] }>('takePendingImports')
    if (Array.isArray(result?.items) && result.items.length > 0) {
      enqueueProviderImports(result.items)
    }
  }
  void listen('provider-import-pending', () => {
    void receive().catch(() => {})
  })
    .then(receive)
    .catch(() => {
      started = false
    })
}

export function resetProviderImportQueueForTests(): void {
  pending.clear()
  queue.length = 0
  listener = undefined
  started = false
}

export const providerImportQueue = {
  subscribe(callback: () => void) {
    listener = callback
    if (queue.length > 0) {
      callback()
    }
    return () => {
      if (listener === callback) listener = undefined
    }
  },
  take: () => queue.shift(),
  complete: (url: string) => pending.delete(url)
}
