import type { ProviderPlatform } from './platforms'

export interface CliVersionCache {
  version: string
  checkedAt: number
  syncedAt?: number
}
export type CliVersions = Partial<Record<ProviderPlatform, CliVersionCache>>
export const CLI_SYNC_INTERVAL = 60 * 60 * 1000
// Official stable releases verified 2026-09-24. These keep first-run/offline requests usable.
export const CLI_BASELINES: Record<ProviderPlatform, string> = {
  openai: '0.156.1',
  grok: '1.0.41',
  anthropic: '2.1.281'
}
const repos = { openai: 'openai/codex', anthropic: 'anthropics/claude-code' } as const

export function isStableVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split('.').every((part) => Number.isSafeInteger(Number(part)))
  )
}
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}
export function effectiveCliVersion(platform: ProviderPlatform, value?: string): string {
  return isStableVersion(value) && compareVersions(value, CLI_BASELINES[platform]) >= 0
    ? value
    : CLI_BASELINES[platform]
}
export function releaseVersion(platform: 'openai' | 'anthropic', releases: unknown[]): string | undefined {
  const prefix = platform === 'openai' ? 'rust-v' : 'v'
  return releases
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const release = item as { tag_name?: string; draft?: boolean; prerelease?: boolean }
      if (
        release.draft ||
        release.prerelease ||
        typeof release.tag_name !== 'string' ||
        !release.tag_name.startsWith(prefix)
      )
        return []
      const version = release.tag_name.slice(prefix.length)
      return isStableVersion(version) ? [version] : []
    })
    .sort((a, b) => compareVersions(b, a))[0]
}

export async function fetchCliVersion(
  platform: ProviderPlatform,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<string> {
  if (platform === 'grok') {
    const response = await fetcher('https://x.ai/cli/stable', { signal, credentials: 'omit' })
    if (!response.ok) throw new Error('CLI version unavailable')
    const version = (await response.text()).trim()
    if (!isStableVersion(version)) throw new Error('Invalid CLI version')
    return version
  }
  const base = `https://api.github.com/repos/${repos[platform]}/releases`
  try {
    const response = await fetcher(`${base}/latest`, {
      signal,
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lich13studio-cli-sync' }
    })
    if (response.ok) {
      const version = releaseVersion(platform, [await response.json()])
      if (version) return version
    }
  } catch {
    if (signal.aborted) throw new Error('CLI version timeout')
  }
  const response = await fetcher(`${base}?per_page=30`, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lich13studio-cli-sync' }
  })
  if (!response.ok) throw new Error('CLI version unavailable')
  const releases = await response.json()
  const version = Array.isArray(releases) ? releaseVersion(platform, releases) : undefined
  if (!version) throw new Error('Invalid CLI version')
  return version
}

export function stripIdentityHeaders(existing: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(existing).filter(
      ([key]) =>
        !['user-agent', 'originator', 'version', 'x-grok-client-version', 'x-grok-client-identifier'].includes(
          key.toLowerCase()
        )
    )
  )
}

export function platformRequestHeaders(
  platform: ProviderPlatform,
  version?: string,
  existing: Record<string, string> = {},
  environment = 'unknown; unknown'
): Record<string, string> {
  const headers = stripIdentityHeaders(existing)
  const resolved = effectiveCliVersion(platform, version)
  if (platform === 'openai')
    return {
      ...headers,
      'User-Agent': `codex_cli_rs/${resolved} (${environment})`,
      originator: 'codex_cli_rs',
      version: resolved
    }
  if (platform === 'grok')
    return {
      ...headers,
      'User-Agent': `xai-grok-workspace/${resolved}`,
      'x-grok-client-version': resolved,
      'x-grok-client-identifier': 'grok-shell'
    }
  return { ...headers, 'User-Agent': `claude-cli/${resolved} (external, cli)` }
}
