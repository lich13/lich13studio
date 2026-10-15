// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  language: 'en-US',
  dispatch: vi.fn(),
  setTimeoutTimer: vi.fn(),
  navigate: vi.fn(),
  showErrorDetailPopup: vi.fn(),
  getProviderById: vi.fn(),
  diagnoseError: vi.fn(),
  fetch: vi.fn()
}))

vi.mock('@ant-design/icons', () => ({ SettingOutlined: () => null }))
vi.mock('@renderer/components/ErrorDetailModal', () => ({ showErrorDetailPopup: mocks.showErrorDetailPopup }))
vi.mock('@renderer/hooks/useTimer', () => ({ useTimer: () => ({ setTimeoutTimer: mocks.setTimeoutTimer }) }))
vi.mock('@renderer/i18n/label', () => ({
  getHttpMessageLabel: (code: string) => code,
  getProviderLabel: (id: string) => id
}))
vi.mock('@renderer/services/ErrorDiagnosisService', () => ({ diagnoseError: mocks.diagnoseError }))
vi.mock('@renderer/services/ProviderService', () => ({ getProviderById: mocks.getProviderById }))
vi.mock('@renderer/store', () => ({ useAppDispatch: () => mocks.dispatch }))
vi.mock('@renderer/store/thunk/messageThunk', () => ({ removeBlocksThunk: vi.fn() }))
vi.mock('antd', () => ({ Button: ({ children }: { children: unknown }) => children }))
vi.mock('react-i18next', () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useTranslation: () => ({
    t: (key: string) => `${mocks.language}:${key}`,
    i18n: { language: mocks.language, exists: () => false }
  })
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => mocks.navigate
}))

import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'

import ErrorBlock from './ErrorBlock'

const block = {
  id: 'block-fixture',
  messageId: 'message-fixture',
  type: 'error',
  createdAt: '2026-10-15T00:00:00.000Z',
  status: 'error',
  error: { name: 'FixtureError', message: 'Unclassified fixture failure', stack: null }
} as ErrorMessageBlock

const message = {
  id: 'message-fixture',
  role: 'assistant',
  assistantId: 'assistant-fixture',
  topicId: 'topic-fixture',
  createdAt: '2026-10-15T00:00:00.000Z',
  status: 'error',
  blocks: [block.id]
} as Message

const roots: ReturnType<typeof createRoot>[] = []

async function renderBlock(element: HTMLElement) {
  const root = createRoot(element)
  roots.push(root)
  await act(async () => root.render(createElement(ErrorBlock, { block, message })))
  return root
}

describe('ErrorBlock', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.language = 'en-US'
    mocks.dispatch.mockReset()
    mocks.setTimeoutTimer.mockReset()
    mocks.navigate.mockReset()
    mocks.showErrorDetailPopup.mockReset()
    mocks.getProviderById.mockReset()
    mocks.diagnoseError.mockReset()
    mocks.fetch.mockReset()
  })

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    vi.unstubAllGlobals()
  })

  it('renders an unknown error without requesting model diagnosis or making a network call', async () => {
    const element = document.createElement('div')

    await renderBlock(element)

    expect(element.textContent).toContain('en-US:error.diagnosis.unknown')
    expect(element.textContent).toContain('Unclassified fixture failure')
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.getProviderById).not.toHaveBeenCalled()
  })

  it('does not request model diagnosis when rerendered after a language change', async () => {
    const element = document.createElement('div')
    const root = await renderBlock(element)

    mocks.language = 'zh-CN'
    await act(async () => root.render(createElement(ErrorBlock, { block: { ...block }, message })))

    expect(element.textContent).toContain('zh-CN:error.diagnosis.unknown')
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.getProviderById).not.toHaveBeenCalled()
  })
})
