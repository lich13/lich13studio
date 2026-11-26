// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  catalog: {
    providers: [
      { id: 'one', name: 'One', platform: 'openai', enabled: true },
      { id: 'two', name: 'Two', platform: 'openai', enabled: true },
      { id: 'off', name: 'Off', platform: 'openai', enabled: false },
      { id: 'claude', name: 'Claude', platform: 'anthropic', enabled: true }
    ],
    platformModels: {
      openai: [{ id: 'gpt-6-sol', name: 'Sol', group: '' }],
      grok: [],
      anthropic: [{ id: 'claude-opus-4-7', name: 'Opus', group: '' }]
    }
  }
}))
vi.mock('@renderer/store', () => ({ useAppSelector: (fn: any) => fn({ llm: fixture.catalog }) }))
vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => null }))
vi.mock('@renderer/components/ModelTagsWithLabel', () => ({ default: () => null }))
vi.mock('@renderer/config/models', () => ({ isEmbeddingModel: () => false, isRerankModel: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const renderedSelectProps: any[] = []

vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => children,
  Typography: { Text: ({ children, ...props }: any) => createElement('span', props, children) },
  Select: (props: any) => {
    renderedSelectProps.push(props)
    const { options, value, onChange, disabled, 'aria-label': label } = props
    return createElement(
      'select',
      {
        'aria-label': label,
        value: value || '',
        disabled,
        onChange: (e: any) => onChange(e.target.value)
      },
      [
        createElement('option', { key: 'empty', value: '' }, 'Select'),
        ...options.flatMap((entry: any) =>
          (entry.options || [entry]).map((o: any) =>
            createElement('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label)
          )
        )
      ]
    )
  }
}))

import { type ModelProviderSelection, resolveModelProviderSelection } from '@shared/modelProviderSelection'

const loadAndroidComponent = async () => {
  vi.resetModules()
  renderedSelectProps.length = 0
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
  })
  return import('./ModelProviderSelect')
}

const loadDesktopComponent = async () => {
  vi.resetModules()
  renderedSelectProps.length = 0
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  })
  return import('./ModelProviderSelect')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('uses native Android optgroups, keeps selections independent, and preserves select nodes across redraws', async () => {
  const { default: ModelProviderSelect } = await loadAndroidComponent()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  let selected: ModelProviderSelection = { platform: 'openai', modelId: 'gpt-6-sol', providerId: 'one' }
  function View() {
    const [selection, setSelection] = useState(selected)
    selected = selection
    return createElement(ModelProviderSelect, { selection, onChange: setSelection })
  }
  await act(async () => root.render(createElement(View)))
  const selects = () => [...container.querySelectorAll('select')] as HTMLSelectElement[]
  const initialSelects = selects()
  expect(initialSelects).toHaveLength(2)
  const modelSelect = initialSelects[0]
  const providerSelect = initialSelects[1]
  expect(modelSelect.querySelectorAll('optgroup')).toHaveLength(3)
  expect([...modelSelect.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
    'OpenAI',
    'grok',
    'Anthropic'
  ])
  expect([...providerSelect.options].map((option) => option.value)).toEqual(['', 'one', 'two'])
  expect(modelSelect.value).toBe(JSON.stringify(['openai', 'gpt-6-sol']))
  expect(providerSelect.value).toBe('one')
  await act(async () => {
    providerSelect.value = 'two'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected).toEqual({ platform: 'openai', modelId: 'gpt-6-sol', providerId: 'two' })
  await act(async () => {
    modelSelect.value = JSON.stringify(['anthropic', 'claude-opus-4-7'])
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected.providerId).toBe('two')
  expect(selects()[0]).toBe(modelSelect)
  expect(selects()[1]).toBe(providerSelect)
  expect(resolveModelProviderSelection(selected, fixture.catalog as any).model).toBeUndefined()
  expect(container.textContent).toContain('settings.modelSelection.providerUnavailable')
  expect(providerSelect.querySelector('option[value="two"]')?.getAttribute('disabled')).not.toBeNull()
  await act(async () => {
    providerSelect.value = 'two'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected.providerId).toBe('two')
  await act(async () => {
    providerSelect.value = 'claude'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(resolveModelProviderSelection(selected, fixture.catalog as any).model).toMatchObject({
    id: 'claude-opus-4-7',
    provider: 'claude'
  })
  expect(selects()[0]).toBe(modelSelect)
  expect(selects()[1]).toBe(providerSelect)
  await act(async () => {
    const unknown = document.createElement('option')
    unknown.value = JSON.stringify(['anthropic', 'not-in-catalog'])
    modelSelect.append(unknown)
    modelSelect.value = unknown.value
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected).toEqual({ platform: 'anthropic', modelId: 'claude-opus-4-7', providerId: 'claude' })
  await act(async () => root.unmount())
})

it('offers a newly created provider after choosing a model on its platform', async () => {
  const { default: ModelProviderSelect } = await loadAndroidComponent()
  const originalProviders = fixture.catalog.providers
  fixture.catalog.providers = [{ id: 'fixture', name: 'Android CI provider', platform: 'openai', enabled: true }]
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  function View() {
    const [selection, setSelection] = useState<ModelProviderSelection>({
      platform: 'anthropic',
      modelId: 'claude-opus-4-7'
    })
    return createElement(ModelProviderSelect, { selection, onChange: setSelection })
  }
  try {
    await act(async () => root.render(createElement(View)))
    const [model, provider] = [...container.querySelectorAll('select')]
    expect(provider.options).toHaveLength(1)
    await act(async () => {
      model.value = JSON.stringify(['openai', 'gpt-6-sol'])
      model.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(model.title).toBe('gpt-6-sol')
    expect([...provider.options].map((option) => option.value)).toEqual(['', 'fixture'])
    await act(async () => {
      provider.value = 'fixture'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(provider.title).toBe('Android CI provider')
    expect([...container.querySelectorAll('select')]).toEqual([model, provider])
  } finally {
    await act(async () => root.unmount())
    fixture.catalog.providers = originalProviders
  }
})

it('rejects malformed, null, unknown-platform, empty, and wrong-shape selection values', async () => {
  const { parseModelProviderSelectionValue } = await loadAndroidComponent()
  expect(parseModelProviderSelectionValue(JSON.stringify(['openai', 'gpt-6-sol']))).toEqual(['openai', 'gpt-6-sol'])
  for (const value of [
    null,
    undefined,
    '',
    'not-json',
    '{}',
    '[]',
    '["openai"]',
    '["unknown","model"]',
    '["openai",""]',
    '["openai",1]'
  ]) {
    expect(parseModelProviderSelectionValue(value)).toBeNull()
  }
})

it('preserves virtual list numeric widths and injects shiftX/shiftY dropdownAlign on desktop', async () => {
  const { default: ModelProviderSelect } = await loadDesktopComponent()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const selection: ModelProviderSelection = { platform: 'openai', modelId: 'gpt-6-sol', providerId: 'one' }

  await act(async () => {
    root.render(createElement(ModelProviderSelect, { selection, onChange: vi.fn(), compact: true }))
  })

  expect(renderedSelectProps).toHaveLength(2)
  const [compactModel, compactProvider] = renderedSelectProps
  expect(compactModel.popupMatchSelectWidth).toBe(340)
  expect(compactProvider.popupMatchSelectWidth).toBe(220)
  expect(compactModel.listHeight).toBe(220)
  expect(compactProvider.listHeight).toBe(220)
  for (const selectProps of [compactModel, compactProvider]) {
    expect(selectProps.popupMatchSelectWidth).not.toBe(false)
    expect(selectProps.dropdownAlign).toEqual({
      overflow: { adjustX: 1, adjustY: 1, shiftX: true, shiftY: true }
    })
    expect(selectProps.styles?.popup?.root).toEqual({
      maxWidth: 'calc(var(--app-viewport-width, 100vw) - 16px)',
      maxHeight: 'calc(var(--app-viewport-height, 100vh) - 64px)'
    })
  }

  renderedSelectProps.length = 0
  await act(async () => {
    root.render(createElement(ModelProviderSelect, { selection, onChange: vi.fn(), compact: false }))
  })
  const [normalModel, normalProvider] = renderedSelectProps
  expect(normalModel.popupMatchSelectWidth).toBe(420)
  expect(normalProvider.popupMatchSelectWidth).toBe(260)
  expect(normalModel.listHeight).toBe(256)
  expect(normalProvider.listHeight).toBe(256)

  await act(async () => root.unmount())
})
