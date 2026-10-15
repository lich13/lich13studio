// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pending: [] as string[],
  onChange: undefined as (() => void) | undefined,
  startListener: vi.fn(),
  complete: vi.fn(),
  show: vi.fn(),
  parse: vi.fn(() => ({
    name: 'Fixture provider',
    platform: 'openai',
    type: 'openai-response',
    apiKey: 'fixture-key',
    apiHost: 'https://api.example.invalid/v1',
    models: [],
    model: 'fixture-model'
  })),
  getState: vi.fn(() => ({ llm: { providers: [] } })),
  dispatch: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('@renderer/pages/settings/ProviderSettings/ProviderImportPopup', () => ({
  default: { show: mocks.show }
}))
vi.mock('@renderer/services/ProviderImportQueue', () => ({
  startProviderImportListener: mocks.startListener,
  providerImportQueue: {
    take: () => mocks.pending.shift(),
    complete: mocks.complete,
    subscribe: (callback: () => void) => {
      mocks.onChange = callback
      return () => {
        mocks.onChange = undefined
      }
    }
  }
}))
vi.mock('@renderer/store', () => ({ default: { getState: mocks.getState, dispatch: mocks.dispatch } }))
vi.mock('@renderer/store/llm', () => ({ importPlatformProvider: vi.fn() }))
vi.mock('@renderer/utils', () => ({ uuid: () => 'fixture-provider-id' }))
vi.mock('@shared/providerImport', () => ({
  matchesProviderImport: () => false,
  parseProviderImport: mocks.parse
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))

import ProviderImportHandler from './ProviderImportHandler'

describe('ProviderImportHandler', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  beforeEach(() => {
    mocks.pending.length = 0
    mocks.onChange = undefined
    mocks.startListener.mockClear()
    mocks.complete.mockClear()
    mocks.show.mockReset().mockResolvedValue(undefined)
    mocks.parse.mockClear()
    mocks.getState.mockClear()
    mocks.dispatch.mockClear()
    mocks.navigate.mockClear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    ;(window as any).toast = { error: vi.fn(), success: vi.fn() }
  })

  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    container?.remove()
    root = undefined
    container = undefined
    delete (window as any).toast
    vi.unstubAllGlobals()
  })

  it('completes the queued import without writing or navigating when confirmation is cancelled', async () => {
    const url = 'ccswitch://v1/import?fixture'
    mocks.pending.push(url)
    container = document.createElement('div')
    root = createRoot(container)

    await act(async () => root!.render(createElement(ProviderImportHandler)))
    expect(mocks.startListener).toHaveBeenCalledOnce()
    expect(mocks.onChange).toBeTypeOf('function')

    await act(async () => mocks.onChange!())
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(url))

    expect(mocks.parse).toHaveBeenCalledWith(url)
    expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fixture provider' }))
    expect(mocks.getState).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect((window as any).toast.success).not.toHaveBeenCalled()
    expect((window as any).toast.error).not.toHaveBeenCalled()
  })
})
