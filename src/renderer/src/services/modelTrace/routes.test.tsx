// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@renderer/databases', () => ({}))
vi.mock('@renderer/hooks/useOnboardingState', () => ({ useOnboardingState: () => ({ onboardingCompleted: true }) }))
vi.mock('@renderer/components/app/Sidebar', () => ({ default: () => null }))
vi.mock('@renderer/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: any) => children }))
vi.mock('@renderer/components/ProviderImportHandler', () => ({ default: () => null }))
vi.mock('@renderer/handler/NavigationHandler', () => ({ default: () => null }))
vi.mock('@renderer/pages/onboarding', () => ({ OnboardingPage: () => null }))
vi.mock('@renderer/pages/settings/SettingsPage', () => ({ default: () => 'settings' }))
vi.mock('@renderer/pages/model-test/ModelTestPage', () => ({ default: () => 'model test full page' }))
vi.mock('@renderer/pages/home/HomePage', async () => ({
  default: (await import('@renderer/pages/home/components/ModelTestButton')).default
}))
vi.mock('antd', () => ({ Button: ({ children, onClick }: any) => createElement('button', { onClick }, children) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import Router from '@renderer/Router'

afterEach(() => vi.unstubAllGlobals())

it('opens the top-level test page from home and redirects the legacy settings path', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.history.replaceState(null, '', '#/')
  const container = document.createElement('div')
  let root = createRoot(container)
  await act(async () => {
    root.render(createElement(Router))
  })
  expect(container.textContent).toBe('settings.modelTest.title')
  await act(async () => {
    container.querySelector('button')!.click()
  })
  expect(window.location.hash).toBe('#/model-test')
  expect(container.textContent).toBe('model test full page')
  await act(async () => {
    root.unmount()
  })
  window.history.replaceState(null, '', '#/settings/model-test')
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(Router))
  })
  expect(window.location.hash).toBe('#/model-test')
  expect(container.textContent).toBe('model test full page')
  await act(async () => {
    root.unmount()
  })
})
