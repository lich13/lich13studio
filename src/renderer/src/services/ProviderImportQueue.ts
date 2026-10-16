import {
  PROVIDER_IMPORT_MAX_LINK_LENGTH,
  PROVIDER_IMPORT_MAX_QUEUE,
  PROVIDER_IMPORT_REJECTED_MARKER
} from '@shared/providerImport'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Credentials only live in this in-memory queue until the user confirms import.
const pending = new Set<string>()
const queue: string[] = []
let listener: (() => void) | undefined
let started = false

function enqueue(urls: string[]) {
  let rejected = false
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('ccswitch:') || pending.has(url)) continue
    if (url.length > PROVIDER_IMPORT_MAX_LINK_LENGTH || pending.size >= PROVIDER_IMPORT_MAX_QUEUE) {
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
  listener?.()
}

export function startProviderImportListener() {
  if (started || !(window as any).__TAURI_INTERNALS__ || getCurrentWindow().label !== 'main') return
  started = true
  const receive = async () => enqueue(await invoke<string[]>('take_pending_provider_imports'))
  void listen('provider-import-pending', () => {
    void receive().catch(() => {})
  })
    .then(receive)
    .catch(() => {
      started = false
    })
}

export const providerImportQueue = {
  subscribe(callback: () => void) {
    listener = callback
    callback()
    return () => {
      if (listener === callback) listener = undefined
    }
  },
  take: () => queue.shift(),
  complete: (url: string) => pending.delete(url)
}
