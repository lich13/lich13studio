import store from '@renderer/store'
import { setCliVersion } from '@renderer/store/llm'
import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import {
  CLI_SYNC_INTERVAL,
  compareVersions,
  effectiveCliVersion,
  fetchCliVersion,
  platformRequestHeaders
} from '@shared/cliIdentity'
import { PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'

let environment = globalThis.navigator?.platform || 'unknown'
const pending = new Map<ProviderPlatform, Promise<void>>()

export function getPlatformHeaders(platform: ProviderPlatform, version?: string, headers?: Record<string, string>) {
  return platformRequestHeaders(platform, version, headers, environment)
}

export function syncCliVersion(platform: ProviderPlatform, force = false): Promise<void> {
  const active = pending.get(platform)
  if (active) return active
  const previous = store.getState().llm.cliVersions[platform]
  const now = Date.now()
  if (!force && previous && now >= previous.checkedAt && now - previous.checkedAt < CLI_SYNC_INTERVAL)
    return Promise.resolve()
  const task = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const current = effectiveCliVersion(platform, previous?.version)
    try {
      const version = await fetchCliVersion(platform, getTauriNativeFetch() ?? fetch, controller.signal)
      store.dispatch(
        setCliVersion({
          platform,
          cache: {
            version: compareVersions(version, current) > 0 ? version : current,
            checkedAt: now,
            syncedAt: Date.now()
          }
        })
      )
    } catch {
      store.dispatch(setCliVersion({ platform, cache: { ...previous, version: current, checkedAt: now } }))
    } finally {
      clearTimeout(timeout)
      pending.delete(platform)
    }
  })()
  pending.set(platform, task)
  return task
}

export function startCliVersionSync(): () => void {
  void window.api
    .getAppInfo()
    .then((info) => {
      environment = `${info.platform || globalThis.navigator?.platform || 'unknown'}; ${info.arch || 'unknown'}`
    })
    .catch(() => {})
  const sync = () => {
    for (const platform of PROVIDER_PLATFORMS) void syncCliVersion(platform)
  }
  sync()
  const timer = setInterval(sync, CLI_SYNC_INTERVAL)
  return () => clearInterval(timer)
}
