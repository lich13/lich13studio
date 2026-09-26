import { getModelLogoById, normalizeModelLogoKey } from '@renderer/config/models/logo'
import { describe, expect, it } from 'vitest'

describe('model logo resolution', () => {
  it('normalizes provider model aliases', () => {
    expect(normalizeModelLogoKey(' Codex/GPT_6-Astra ')).toBe('codex/gpt-6-astra')
  })

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-sol', 'codex/gpt-6-luna'])(
    'resolves %s to a local icon',
    (modelId) => {
      expect(getModelLogoById(modelId)).toBeTruthy()
    }
  )

  it('uses the GPT family fallback for future model IDs', () => {
    expect(getModelLogoById('openai/gpt-7-preview')).toBeTruthy()
  })
})
