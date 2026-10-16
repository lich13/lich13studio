import { createHash, timingSafeEqual } from 'node:crypto'

/** The local API server only ever listens on loopback interfaces. */
export function isLoopbackHost(host: string | undefined): boolean {
  const value = (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

/** Browser origins of the app's own webviews. Requests without Origin are non-browser clients. */
const APP_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'])

export function isAllowedApiOrigin(origin: string | undefined): boolean {
  return !origin || APP_ORIGINS.has(origin)
}

/** Constant-time comparison that does not leak the key length. */
export function safeTokenEqual(token: string, apiKey: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(token), digest(apiKey)) && token.length === apiKey.length
}
