import { invoke } from '@tauri-apps/api/core'

export const runtimeCapabilities = Object.freeze({
  android: typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent),
  get desktop() {
    return !this.android
  },
  get tray() {
    return this.desktop
  },
  get screenCapture() {
    return this.desktop
  }
})

export function mobileCommand<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>('mobile_command', { command, args })
}

if (runtimeCapabilities.android && typeof document !== 'undefined') {
  document.documentElement.dataset.runtime = 'android'
}

/** Desktop Tauri builds keep credentials in the OS credential store. */
export function desktopCredentialStoreAvailable(): boolean {
  return !runtimeCapabilities.android && typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)
}

export function isMainTauriWindow(): boolean {
  return (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label === 'main'
}
