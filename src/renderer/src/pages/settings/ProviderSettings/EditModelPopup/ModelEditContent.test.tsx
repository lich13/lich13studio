// @vitest-environment jsdom
import type { Model, Provider } from '@renderer/types'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

vi.mock('@renderer/utils', () => ({
  getLowerBaseModelName: (id: string) => id.toLowerCase().split('/').pop(),
  getDefaultGroupName: () => 'OpenAI'
}))
vi.mock('@renderer/services/AssistantService', () => ({ getProviderByModel: vi.fn() }))
vi.mock('@renderer/hooks/useDynamicLabelWidth', () => ({ useDynamicLabelWidth: () => 100 }))
vi.mock('@renderer/utils/provider', () => ({ isNewApiProvider: () => false }))
vi.mock('@renderer/components/Icons/CopyIcon', () => ({ default: () => null }))
vi.mock('@renderer/components/TooltipIcons', () => ({ WarnTooltip: () => null }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/Tags/Model', () => {
  const tag =
    (name: string) =>
    ({ inactive, disabled, onClick }: any) =>
      createElement(
        'button',
        {
          'aria-label': name,
          'aria-pressed': !inactive,
          disabled,
          onClick
        },
        name
      )
  return {
    VisionTag: tag('vision'),
    ReasoningTag: tag('reasoning'),
    ToolsCallingTag: tag('tools'),
    EmbeddingTag: tag('embedding'),
    RerankerTag: tag('rerank')
  }
})
vi.mock('antd', () => {
  const pass = ({ children }: any) => children
  const form = Object.assign(pass, { Item: pass, useForm: () => [{ getFieldsValue: () => ({}) }] })
  return {
    Modal: pass,
    Form: form,
    Flex: pass,
    Tooltip: pass,
    Button: ({ children, onClick }: any) => createElement('button', { onClick }, children),
    Input: () => null,
    InputNumber: () => null,
    Select: () => null,
    Switch: () => null,
    Divider: () => null,
    message: { success: vi.fn() }
  }
})

import ModelEditContent from './ModelEditContent'

it('opening capabilities does not save inferred fields; toggling and restoring removes only explicit overrides', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div')
  const root = createRoot(element)
  const save = vi.fn()
  const model: Model = { id: 'gpt-6-luna', name: 'My Luna', group: 'My group', provider: 'p' }
  try {
    await act(async () =>
      root.render(
        createElement(ModelEditContent, { model, provider: { id: 'p' } as Provider, onUpdateModel: save, open: true })
      )
    )
    const click = async (label: string) => {
      const button = Array.from(element.querySelectorAll('button')).find((item) => item.textContent === label)!
      expect(button).toBeTruthy()
      await act(async () => button.click())
    }
    await click('settings.moresetting.label')
    expect(save).not.toHaveBeenCalled()
    expect(element.querySelector('[aria-label="vision"]')?.getAttribute('aria-pressed')).toBe('true')
    await click('vision')
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: model.id,
        name: model.name,
        group: model.group,
        capabilities: [{ type: 'vision', isUserSelected: false }]
      })
    )
    expect(element.querySelector('[aria-label="vision"]')?.getAttribute('aria-pressed')).toBe('false')
    await click('models.type.restore_auto')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ capabilities: [] }))
    expect(element.querySelector('[aria-label="vision"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(model).not.toHaveProperty('capabilities')
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
