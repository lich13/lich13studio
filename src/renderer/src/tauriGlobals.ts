import * as core from '@tauri-apps/api/core'
import * as event from '@tauri-apps/api/event'
import * as webviewWindow from '@tauri-apps/api/webviewWindow'
import * as tauriWindow from '@tauri-apps/api/window'

// withGlobalTauri is disabled so the full API is not injected into every
// document. Expose only the modules the renderer uses, from bundled
// explicit imports, and only inside the Tauri runtime.
const host = window as unknown as Record<string, unknown>
if (host.__TAURI_INTERNALS__ && !host.__TAURI__) {
  Object.defineProperty(host, '__TAURI__', {
    value: Object.freeze({ core, event, webviewWindow, window: tauriWindow }),
    configurable: false,
    enumerable: false,
    writable: false
  })
}
