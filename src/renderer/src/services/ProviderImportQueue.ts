import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

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
  if (started || !(window as any).__TAURI_INTERNALS__) return
  started = true
  void onOpenUrl(enqueue)
    .then(async () => enqueue((await getCurrent()) ?? []))
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
