import { startCliVersionSync } from '@renderer/services/CliVersionService'
import { useEffect } from 'react'

export default function PlatformRuntime() {
  useEffect(startCliVersionSync, [])
  return null
}
