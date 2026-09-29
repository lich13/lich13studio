import { startCliVersionSync } from '@renderer/services/CliVersionService'
import { fingerprintBankService } from '@renderer/services/modelTrace/FingerprintBankService'
import { platformModelCatalogService } from '@renderer/services/PlatformModelCatalogService'
import { useEffect } from 'react'

export default function PlatformRuntime() {
  useEffect(startCliVersionSync, [])
  useEffect(() => platformModelCatalogService.start(), [])
  useEffect(() => fingerprintBankService.start(), [])
  return null
}
