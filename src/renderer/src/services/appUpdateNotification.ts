import i18n from '@renderer/i18n'

import { checkLatestRelease } from './appUpdate'

export const notifyLatestReleaseIfAvailable = async (currentVersion: string, platform?: string) => {
  const releaseInfo = await checkLatestRelease(currentVersion, platform)

  if (releaseInfo.error || !releaseInfo.hasUpdate) {
    return releaseInfo
  }

  const url = releaseInfo.asset?.url || releaseInfo.releaseUrl

  await window.api.notification.send({
    id: `app-update-${releaseInfo.latestVersion || 'latest'}`,
    type: 'info',
    title: i18n.t('settings.about.updateAvailable', { version: releaseInfo.latestVersion }),
    message: i18n.t('settings.about.updateNotificationMessage'),
    timestamp: Date.now(),
    source: 'update',
    extra: { url }
  })

  return releaseInfo
}
