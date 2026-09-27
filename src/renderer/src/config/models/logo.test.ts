import { getModelLogoById, normalizeModelLogoKey } from '@renderer/config/models/logo'
import { describe, expect, it } from 'vitest'

describe('model logo resolution', () => {
  it('normalizes provider model aliases', () => {
    expect(normalizeModelLogoKey(' Codex/GPT_6-Astra ')).toBe('codex/gpt-6-astra')
  })

  it.each([
    'gpt-5.6-sol',
    'gpt-5-6-terra',
    'gpt-5.6-luna',
    'gpt-6-astra',
    'gpt-6-sol',
    'Codex/GPT_6-Luna',
    'codex-mini-latest',
    'openai/gpt-7-preview'
  ])('uses the OpenAI brand in both themes for %s', (modelId) => {
    expect(getModelLogoById(modelId, 'light')).toBe(OpenAILight)
    expect(getModelLogoById(modelId, 'dark')).toBe(OpenAIDark)
    expect(OpenAILight).not.toBe(OpenAIDark)
  })

  it('does not brand unrelated model names as OpenAI', () => {
    expect(getModelLogoById('mygpt-6-unknown')).toBeUndefined()
  })
})
import OpenAIDark from '@renderer/assets/images/models/cherry/openai-dark.svg'
import OpenAILight from '@renderer/assets/images/models/cherry/openai-light.svg'
