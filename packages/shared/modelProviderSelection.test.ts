import { describe, expect, it } from 'vitest'

import { resolveModelProviderSelection } from './modelProviderSelection'
import { createPlatformModels, type StoredProvider } from './platforms'

const providers: StoredProvider[] = [
  { id: 'one', name: 'One', platform: 'openai', type: 'openai-response', enabled: true, apiKey: '', apiHost: '' },
  { id: 'two', name: 'Two', platform: 'openai', type: 'openai-response', enabled: true, apiKey: '', apiHost: '' },
  { id: 'off', name: 'Off', platform: 'openai', type: 'openai-response', enabled: false, apiKey: '', apiHost: '' },
  { id: 'claude', name: 'Claude', platform: 'anthropic', type: 'anthropic', enabled: true, apiKey: '', apiHost: '' }
]
const catalog = { providers, platformModels: createPlatformModels() }

describe('independent model and provider selection', () => {
  it('keeps one catalog model when changing between compatible providers', () => {
    const selection = { platform: 'openai' as const, modelId: 'gpt-6-sol', providerId: 'one' }
    expect(resolveModelProviderSelection(selection, catalog).model?.provider).toBe('one')
    const second = resolveModelProviderSelection({ ...selection, providerId: 'two' }, catalog)
    expect(second.model).toMatchObject({ id: 'gpt-6-sol', provider: 'two' })
    expect(second.providers.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it.each(['claude', 'off', 'deleted'])('does not fall back from unavailable provider %s', (providerId) => {
    const selection = { platform: 'openai' as const, modelId: 'gpt-6-sol', providerId }
    const resolved = resolveModelProviderSelection(selection, catalog)
    expect(resolved.model).toBeUndefined()
    expect(resolved.issue).toBe('providerUnavailable')
    expect(selection.providerId).toBe(providerId)
  })

  it('keeps a missing model visible instead of selecting the first model', () => {
    const selection = { platform: 'openai' as const, modelId: 'deleted-model', providerId: 'one' }
    expect(resolveModelProviderSelection(selection, catalog).issue).toBe('modelUnavailable')
    expect(resolveModelProviderSelection(selection, catalog).model).toBeUndefined()
    expect(selection.modelId).toBe('deleted-model')
  })
})
