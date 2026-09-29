import { startCliVersionSync } from '@renderer/services/CliVersionService'
import { fingerprintBankService } from '@renderer/services/modelTrace/FingerprintBankService'
import { useEffect } from 'react'

export default function PlatformRuntime() {
  useEffect(startCliVersionSync, [])
  useEffect(() => fingerprintBankService.start(), [])
  return null
}
