import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { NotificationService } from '@renderer/services/NotificationService'
import { useAppDispatch } from '@renderer/store'
import { setUpdateState } from '@renderer/store/runtime'
import { uuid } from '@renderer/utils'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useRuntime } from './useRuntime'

export default function useUpdateHandler() {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const notificationService = NotificationService.getInstance()
  const { update } = useRuntime()
  const manualCheckRef = useRef(update.manualCheck)

  // Keep ref in sync with current state
  useEffect(() => {
    manualCheckRef.current = update.manualCheck
  }, [update.manualCheck])

  useEffect(() => {
    const removers = [
      window.api.update.onNotAvailable(() => {
        dispatch(setUpdateState({ checking: false, manualCheck: false }))
        if (manualCheckRef.current) {
          window.toast.success(t('settings.about.updateNotAvailable'))
        }
      }),
      window.api.update.onAvailable((releaseInfo: UpdateInfo) => {
        void notificationService.send({
          id: uuid(),
          type: 'info',
          title: t('button.update_available'),
          message: t('button.update_available', { version: releaseInfo.version }),
          timestamp: Date.now(),
          source: 'update',
          channel: 'system'
        })
        dispatch(
          setUpdateState({
            checking: false,
            downloading: true,
            info: releaseInfo,
            available: true
          })
        )
      }),
      window.api.update.onDownloadStart(() => {
        dispatch(
          setUpdateState({
            checking: false,
            downloading: true
          })
        )
      }),
      window.api.update.onDownloadProgress((progress: ProgressInfo) => {
        dispatch(
          setUpdateState({
            downloading: progress.percent < 100,
            downloadProgress: progress.percent
          })
        )
      }),
      window.api.update.onDownloaded((releaseInfo: UpdateInfo) => {
        dispatch(
          setUpdateState({
            downloading: false,
            info: releaseInfo,
            downloaded: true
          })
        )
        // Auto show update dialog when download completes (only if user manually triggered the check)
        if (manualCheckRef.current) {
          void UpdateDialogPopup.show({ releaseInfo })
        }
      }),
      window.api.update.onError((error) => {
        dispatch(
          setUpdateState({
            checking: false,
            downloading: false,
            downloadProgress: 0,
            manualCheck: false
          })
        )
        if (manualCheckRef.current) {
          window.modal.info({
            title: t('settings.about.updateError'),
            content: error?.message || t('settings.about.updateError'),
            icon: null
          })
        }
      })
    ]
    return () => removers.forEach((remover) => remover())
  }, [dispatch, notificationService, t])
}
