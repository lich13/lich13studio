// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  mode: 'stream' as 'stream' | 'non-stream',
  set: vi.fn()
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ chatRequestMode: settings.mode, setChatRequestMode: settings.set })
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => children
}))
vi.mock('@renderer/components/Buttons/ActionIconButton', () => ({
  default: ({ children, active, ...props }: any) =>
    createElement('button', { ...props, 'data-active': active }, children)
}))

import ChatRequestModeToggle from './ChatRequestModeToggle'

afterEach(() => {
  settings.mode = 'stream'
  settings.set.mockClear()
})

it('renders one accessible toolbar icon and toggles the persisted global mode', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const rootElement = document.createElement('div')
  const root = createRoot(rootElement)
  await act(async () => root.render(createElement(ChatRequestModeToggle)))
  const button = rootElement.querySelector('button')!
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.getAttribute('aria-label')).toContain('chat.request_mode.stream')
  expect(button.getAttribute('data-active')).toBe('true')
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(settings.set).toHaveBeenCalledWith('non-stream')
  await act(async () => root.unmount())
})
