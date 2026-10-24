import { startCliVersionSync } from '@renderer/services/CliVersionService'
import { clearObsoleteCache } from '@renderer/services/obsoleteCache'
import { platformModelCatalogService } from '@renderer/services/PlatformModelCatalogService'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function PlatformRuntime() {
  const { t } = useTranslation()
  useEffect(startCliVersionSync, [])
  useEffect(() => platformModelCatalogService.start(), [])
  useEffect(() => {
    void clearObsoleteCache().catch(() => window.toast.warning(t('settings.data.obsolete_cache_cleanup_failed')))
  }, [t])
  return null
}
