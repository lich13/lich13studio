import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Credentials only live in this in-memory queue until the user confirms import.
const pending = new Set<string>()
const queue: string[] = []
let listener: (() => void) | undefined
let started = false

function enqueue(urls: string[]) {
  for (const url of urls) {
    if (!url.startsWith('ccswitch:') || pending.has(url)) continue
    pending.add(url)
    queue.push(url)
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
