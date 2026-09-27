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
vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => children,
  Typography: { Text: ({ children, ...props }: any) => createElement('span', props, children) },
  Select: ({ options, value, onChange, disabled, 'aria-label': label }: any) =>
    createElement(
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
}))

import { type ModelProviderSelection, resolveModelProviderSelection } from '@shared/modelProviderSelection'

import ModelProviderSelect from './ModelProviderSelect'

afterEach(() => vi.unstubAllGlobals())
it('keeps model and provider independent and blocks incompatible choices until explicitly repaired', async () => {
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
  const selects = container.querySelectorAll('select')
  expect([...selects[1].options].map((option) => option.value)).toEqual(['', 'one', 'two'])
  await act(async () => {
    selects[1].value = 'two'
    selects[1].dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected).toEqual({ platform: 'openai', modelId: 'gpt-6-sol', providerId: 'two' })
  await act(async () => {
    selects[0].value = JSON.stringify(['anthropic', 'claude-opus-4-7'])
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(selected.providerId).toBe('two')
  expect(resolveModelProviderSelection(selected, fixture.catalog as any).model).toBeUndefined()
  expect(container.textContent).toContain('settings.modelTest.providerUnavailable')
  expect(selects[1].querySelector('option[value="two"]')?.getAttribute('disabled')).not.toBeNull()
  await act(async () => {
    selects[1].value = 'claude'
    selects[1].dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(resolveModelProviderSelection(selected, fixture.catalog as any).model).toMatchObject({
    id: 'claude-opus-4-7',
    provider: 'claude'
  })
  await act(async () => root.unmount())
})
