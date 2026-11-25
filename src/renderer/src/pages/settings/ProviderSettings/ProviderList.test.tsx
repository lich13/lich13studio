// @vitest-environment jsdom
import { act, useImperativeHandle } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  android: false,
  scrollToIndex: vi.fn(),
  providers: [
    {
      id: 'openai-1',
      name: 'OpenAI Main',
      type: 'openai-response',
      platform: 'openai',
      apiHost: 'https://api.openai.com/v1',
      apiKey: '',
      models: [],
      enabled: true,
      isSystem: true
    },
    {
      id: 'claude-1',
      name: 'Claude Primary',
      type: 'anthropic',
      platform: 'anthropic',
      apiHost: 'https://api.anthropic.com',
      apiKey: '',
      models: [],
      enabled: true,
      isSystem: false
    },
    {
      id: 'claude-2',
      name: 'Claude Imported',
      type: 'anthropic',
      platform: 'anthropic',
      apiHost: 'https://claude.example.invalid',
      apiKey: '',
      models: [],
      enabled: true,
      isSystem: false
    }
  ] as any[]
}))

vi.mock('@renderer/services/mobile/runtime', () => ({
  runtimeCapabilities: {
    get android() {
      return mocks.android
    }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useAllProviders: () => mocks.providers,
  useProviders: () => ({
    updateProviders: vi.fn(),
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    updateProvider: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, fn: () => void) => fn()
  })
}))

vi.mock('@renderer/services/ImageStorage', () => ({
  default: {
    get: vi.fn(async () => ''),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {})
  }
}))

vi.mock('@renderer/components/DraggableList', () => ({
  DraggableVirtualList: function MockList({ list, children, ref }: any) {
    useImperativeHandle(ref, () => ({ scrollToIndex: mocks.scrollToIndex }))
    return (
      <div data-testid="provider-virtual-list">
        {list.map((item: any) => (
          <div key={item.id}>{children(item)}</div>
        ))}
      </div>
    )
  },
  useDraggableReorder: () => ({
    onDragEnd: vi.fn(),
    itemKey: (item: any) => item.id
  })
}))

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatar: () => <span data-testid="avatar" />
}))

vi.mock('./AddProviderPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('./ModelNotesPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('./PlatformSettings', () => ({ default: () => <div data-testid="platform-settings" /> }))
vi.mock('./ProviderSetting', () => ({
  default: ({ providerId }: { providerId: string }) => <div data-testid="provider-setting">{providerId}</div>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))

import ProviderList from './ProviderList'

describe('ProviderList', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const defaultProviders = [...mocks.providers]

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.android = false
    mocks.providers = [...defaultProviders]
    mocks.scrollToIndex.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('selects ?id= provider within its platform list without rendering legacy agent filter UI', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings/provider?filter=agent&id=claude-2']}>
          <ProviderList />
        </MemoryRouter>
      )
    })

    expect(container.querySelector('[data-testid="provider-setting"]')?.textContent).toBe('claude-2')
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, { align: 'center' })
    expect(container.querySelector('svg.lucide-filter')).toBeNull()
    expect(container.textContent).not.toContain('settings.provider.filter')
  })

  it('clears active searchText and replaces history entry when ?id= selects a provider', async () => {
    let navigateFn!: ReturnType<typeof useNavigate>
    let latestSearch = ''
    let latestPathname = ''

    function Probe() {
      navigateFn = useNavigate()
      const loc = useLocation()
      latestPathname = loc.pathname
      latestSearch = loc.search
      return null
    }

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/', '/settings/provider']}>
          <ProviderList />
          <Probe />
        </MemoryRouter>
      )
    })

    const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(searchInput).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(searchInput, 'unmatched-keyword')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(searchInput.value).toBe('unmatched-keyword')

    await act(async () => {
      navigateFn('/settings/provider?id=claude-2')
    })

    expect(searchInput.value).toBe('')
    expect(container.querySelector('[data-testid="provider-virtual-list"]')?.textContent).toContain('Claude Imported')
    expect(container.querySelector('[data-testid="provider-setting"]')?.textContent).toBe('claude-2')
    expect(latestSearch).toBe('')

    // Navigating back (-1) returns to /settings/provider (prior entry) rather than re-triggering ?id=claude-2.
    await act(async () => {
      navigateFn(-1)
    })
    expect(latestPathname).toBe('/settings/provider')
    expect(latestSearch).toBe('')
  })

  it('keeps Android list visible when ?id= is missing and providers list is empty', async () => {
    mocks.android = true
    mocks.providers = []

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings/provider?id=nonexistent']}>
          <ProviderList />
        </MemoryRouter>
      )
    })

    expect(container.querySelector('.mobile-detail-header')).toBeNull()
    expect(container.textContent).toContain('settings.provider.import_link')
  })
})
