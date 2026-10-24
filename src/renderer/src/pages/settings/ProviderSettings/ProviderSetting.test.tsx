// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ updateProvider: vi.fn(), error: vi.fn() }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider: {
      id: 'fixture',
      name: 'Fixture provider',
      type: 'openai-response',
      platform: 'openai',
      apiHost: '',
      apiKey: '',
      enabled: true
    },
    updateProvider: fixture.updateProvider
  })
}))
vi.mock('@renderer/context/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/utils/api', async () => import('@shared/utils/api'))
vi.mock('@renderer/components/Popups/ApiKeyListPopup', () => ({ ApiKeyListPopup: {} }))
vi.mock('./ApiOptionsSettings/ApiOptionsSettingsPopup', () => ({ default: {} }))
vi.mock('./CustomHeaderPopup', () => ({ default: {} }))
vi.mock('..', () => {
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  return {
    SettingContainer: Container,
    SettingHelpText: Container,
    SettingSubtitle: Container,
    SettingTitle: Container
  }
})

import ProviderSetting from './ProviderSetting'

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.toast = { error: fixture.error } as any
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(ProviderSetting, { providerId: 'fixture' })))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function enterAndBlur(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.blur())
  return input
}

it('saves a normalized address and credentials through ordinary provider inputs', async () => {
  const host = await enterAndBlur('apiHost', 'http://127.0.0.1:18765//v1/v1')
  expect(fixture.updateProvider).toHaveBeenLastCalledWith({ apiHost: 'http://127.0.0.1:18765/v1' })
  expect(host.value).toBe('http://127.0.0.1:18765/v1')
  const key = await enterAndBlur('apiKey', 'fixture-provider-key')
  expect(fixture.updateProvider).toHaveBeenLastCalledWith({ apiKey: 'fixture-provider-key' })
  expect(key.type).toBe('password')
  expect(container.textContent).not.toContain('fixture-provider-key')
})

it('rejects an invalid address without overwriting the saved provider', async () => {
  await enterAndBlur('apiHost', 'invalid')
  expect(fixture.updateProvider).not.toHaveBeenCalled()
  expect(fixture.error).toHaveBeenCalledWith('platform.invalid_address')
})
