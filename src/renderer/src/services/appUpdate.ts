export const GITHUB_REPO_URL = 'https://github.com/lich13/lich13studio'
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
export const GITHUB_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/lich13/lich13studio/releases/latest'

type GitHubReleaseAsset = {
  name?: string
  browser_download_url?: string
}

type GitHubRelease = {
  tag_name?: string
  html_url?: string
  body?: string
  assets?: GitHubReleaseAsset[]
}

export type AppReleaseAsset = {
  name: string
  url: string
}

export type AppReleaseInfo = {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string
  releaseNotes: string
  asset: AppReleaseAsset | null
  error?: string
}

export const getReleasePageUrl = (tagName?: string | null, htmlUrl?: string | null): string => {
  const tag = typeof tagName === 'string' ? tagName.trim() : ''
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/i.test(tag)) return GITHUB_RELEASES_URL
  const expected = `${GITHUB_RELEASES_URL}/tag/${encodeURIComponent(tag)}`
  try {
    const url = new URL(typeof htmlUrl === 'string' ? htmlUrl.trim() : '')
    if (
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      url.pathname === new URL(expected).pathname &&
      !url.search &&
      !url.hash
    )
      return url.href
  } catch {
    /* Fall back to the known repository and validated tag. */
  }
  return expected
}

const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '').split(/[+-]/)[0] || '0'

const parseVersionParts = (version: string) =>
  normalizeVersion(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))

export const compareVersions = (leftVersion: string, rightVersion: string) => {
  const leftParts = parseVersionParts(leftVersion)
  const rightParts = parseVersionParts(rightVersion)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const left = leftParts[index] ?? 0
    const right = rightParts[index] ?? 0
    if (left !== right) {
      return left - right
    }
  }

  return 0
}

const toAsset = (asset: GitHubReleaseAsset | undefined): AppReleaseAsset | null => {
  const name = asset?.name?.trim()
  const url = asset?.browser_download_url?.trim()
  if (!name || !url) {
    return null
  }
  return { name, url }
}

export const getPlatformAsset = (assets: GitHubReleaseAsset[] = [], platform = getCurrentPlatform()) => {
  const normalizedPlatform = platform.toLowerCase()
  const candidates = assets.filter((asset) => asset.name && asset.browser_download_url)
  const lowerName = (asset: GitHubReleaseAsset) => asset.name?.toLowerCase() || ''

  const preferred =
    normalizedPlatform === 'android'
      ? candidates.find((asset) => lowerName(asset).endsWith('_arm64-v8a.apk'))
      : normalizedPlatform === 'darwin' || normalizedPlatform === 'macos'
        ? candidates.find((asset) => lowerName(asset).endsWith('.dmg'))
        : normalizedPlatform === 'win32' || normalizedPlatform === 'windows'
          ? candidates.find((asset) => lowerName(asset).endsWith('.exe') || lowerName(asset).includes('setup'))
          : candidates.find((asset) => lowerName(asset).endsWith('.appimage') || lowerName(asset).endsWith('.deb'))

  return toAsset(preferred || candidates[0])
}

export const getCurrentPlatform = () => {
  const userAgent = globalThis.navigator?.userAgent || ''
  if (/android/i.test(userAgent)) return 'android'
  if (/mac/i.test(userAgent)) return 'darwin'
  if (/win/i.test(userAgent)) return 'win32'
  return 'linux'
}

export const checkLatestRelease = async (
  currentVersion: string,
  platform = getCurrentPlatform()
): Promise<AppReleaseInfo> => {
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API_URL)
    if (!response.ok) {
      throw new Error(`GitHub releases request failed with status ${response.status}`)
    }

    const release = (await response.json()) as GitHubRelease
    const releaseUrl = getReleasePageUrl(release.tag_name, release.html_url)
    if (releaseUrl === GITHUB_RELEASES_URL) {
      throw new Error('GitHub latest release has no valid version tag')
    }
    const latestVersion = normalizeVersion(release.tag_name || '')

    return {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseUrl,
      releaseNotes: release.body || '',
      asset: getPlatformAsset(release.assets || [], platform)
    }
  } catch (error) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: GITHUB_RELEASES_URL,
      releaseNotes: '',
      asset: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
