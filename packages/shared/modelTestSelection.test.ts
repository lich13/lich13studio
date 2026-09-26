import { describe, expect, it } from 'vitest'

import { initialModelTestSelection, resolveModelTestSelection } from './modelTestSelection'
import { createPlatformModels, type StoredProvider } from './platforms'

const providers: StoredProvider[] = [
  { id: 'one', name: 'One', platform: 'openai', type: 'openai-response', enabled: true, apiKey: '', apiHost: '' },
  { id: 'two', name: 'Two', platform: 'openai', type: 'openai-response', enabled: true, apiKey: '', apiHost: '' },
  { id: 'off', name: 'Off', platform: 'openai', type: 'openai-response', enabled: false, apiKey: '', apiHost: '' },
  { id: 'claude', name: 'Claude', platform: 'anthropic', type: 'anthropic', enabled: true, apiKey: '', apiHost: '' }
]
const catalog = { providers, platformModels: createPlatformModels() }

describe('independent test target selection', () => {
  it('keeps one catalog model when changing between compatible providers', () => {
    const selection = { platform: 'openai' as const, modelId: 'gpt-6-sol', providerId: 'one' }
    expect(resolveModelTestSelection(selection, catalog).model?.provider).toBe('one')
    const second = resolveModelTestSelection({ ...selection, providerId: 'two' }, catalog)
    expect(second.model).toMatchObject({ id: 'gpt-6-sol', provider: 'two' })
    expect(second.providers.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it.each(['claude', 'off', 'deleted'])('does not fall back from unavailable provider %s', (providerId) => {
    const selection = { platform: 'openai' as const, modelId: 'gpt-6-sol', providerId }
    const resolved = resolveModelTestSelection(selection, catalog)
    expect(resolved.model).toBeUndefined()
    expect(resolved.issue).toBe('providerUnavailable')
    expect(selection.providerId).toBe(providerId)
  })

  it('keeps a missing model visible instead of selecting the first model', () => {
    const selection = { platform: 'openai' as const, modelId: 'deleted-model', providerId: 'one' }
    expect(resolveModelTestSelection(selection, catalog).issue).toBe('modelUnavailable')
    expect(resolveModelTestSelection(selection, catalog).model).toBeUndefined()
    expect(selection.modelId).toBe('deleted-model')
  })

  it('initializes from the existing default once, without creating a new default', () => {
    expect(initialModelTestSelection(catalog)).toEqual({})
    expect(
      initialModelTestSelection({
        ...catalog,
        defaultModel: {
          id: 'gpt-6-sol',
          provider: 'two',
          name: 'Sol',
          group: ''
        }
      })
    ).toEqual({ platform: 'openai', modelId: 'gpt-6-sol', providerId: 'two' })
  })
})
