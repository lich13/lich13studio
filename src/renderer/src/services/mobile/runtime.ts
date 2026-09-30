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
