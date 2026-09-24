import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('removed provider probes', () => {
  it('removes the probe services and UI entrypoints', () => {
    for (const file of [
      'services/HealthCheckService.ts',
      'types/healthCheck.ts',
      'utils/healthCheck.ts',
      'components/HealthStatusIndicator',
      'pages/settings/ProviderSettings/ModelList'
    ]) {
      expect(existsSync(`src/renderer/src/${file}`)).toBe(false)
    }
    for (const file of [
      'services/ApiService.ts',
      'components/Popups/ApiKeyListPopup/hook.ts',
      'pages/settings/ProviderSettings/ProviderSetting.tsx'
    ]) {
      expect(readFileSync(`src/renderer/src/${file}`, 'utf8')).not.toMatch(
        /checkApi\b|checkModel\b|HealthCheck|healthCheck/
      )
    }
    expect(readFileSync('src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx', 'utf8')).not.toMatch(
      /fetchModels|ManageModels/
    )
    const translations = JSON.parse(readFileSync('src/renderer/src/i18n/locales/zh-cn.json', 'utf8'))
    expect(translations.settings.models.check).toBeUndefined()
    expect(translations.settings.provider.check_all_keys).toBeUndefined()
  })
})
