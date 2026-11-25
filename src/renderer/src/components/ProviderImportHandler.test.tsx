// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  llmState: null as any,
  dispatched: [] as any[],
  flushed: 0,
  assertCalls: 0,
  persistError: null as Error | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  popupShow: vi.fn()
}))

vi.mock('@renderer/services/mobile/credentials', () => ({
  assertPersistCommitted: vi.fn(async () => {
    mocks.assertCalls += 1
    if (mocks.persistError) {
      throw mocks.persistError
    }
  })
}))

vi.mock('@renderer/store', async () => {
  const llmModule = await import('@renderer/store/llm')
  return {
    default: {
      getState: () => ({ llm: mocks.llmState }),
      dispatch: (action: any) => {
        mocks.dispatched.push(action)
        mocks.llmState = llmModule.default(mocks.llmState, action)
        return action
      }
    },
    persistor: {
      flush: vi.fn(async () => {
        mocks.flushed += 1
      })
    }
  }
})

vi.mock('@renderer/pages/settings/ProviderSettings/ProviderImportPopup', () => ({
  default: {
    show: (...args: any[]) => mocks.popupShow(...args)
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))

import TopViewContainer, { TopView } from '@renderer/components/TopView'
import { useOnboardingState } from '@renderer/hooks/useOnboardingState'
import {
  enqueueProviderImports,
  resetProviderImportQueueForTests,
  submitProviderImportText
} from '@renderer/services/ProviderImportQueue'
import { initialState as initialLlmState } from '@renderer/store/llm'
import { PROVIDER_IMPORT_MAX_QUEUE } from '@shared/providerImport'

import ProviderImportHandler from './ProviderImportHandler'

vi.mock('@renderer/hooks/useAppInit', () => ({ useAppInit: () => {} }))
vi.mock('@renderer/hooks/useShortcuts', () => ({ useShortcuts: () => ({ shortcuts: [] }) }))

function Harness({ onState }: { onState: (completed: boolean) => void }) {
  const { onboardingCompleted } = useOnboardingState()
  onState(onboardingCompleted)
  return <ProviderImportHandler />
}

describe('ProviderImportHandler & ProviderImportQueue', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mocks.llmState = structuredClone({
      ...initialLlmState,
      providers: []
    })
    mocks.dispatched = []
    mocks.flushed = 0
    mocks.assertCalls = 0
    mocks.persistError = null
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.popupShow.mockReset()
    resetProviderImportQueueForTests()
    ;(window as any).toast = {
      success: mocks.toastSuccess,
      error: mocks.toastError
    }
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

  it('imports a valid ccswitch link, flushes keystore state, completes onboarding, and detects duplicates', async () => {
    let onboardingDone = false
    mocks.popupShow.mockImplementation(async (incoming: any) => incoming)

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Harness onState={(done) => (onboardingDone = done)} />
        </MemoryRouter>
      )
    })
    expect(onboardingDone).toBe(false)

    const validUrl =
      'ccswitch://v1/import?resource=provider&app=codex&name=MyRelay&endpoint=https%3A%2F%2Frelay.example.invalid&apiKey=sk-secret-test-key&model=gpt-6-astra'

    await act(async () => {
      submitProviderImportText(`从微信复制：${validUrl}`)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.popupShow).toHaveBeenCalledTimes(1)
    expect(mocks.dispatched).toHaveLength(1)
    expect(mocks.dispatched[0].payload.provider).toMatchObject({
      name: 'MyRelay',
      platform: 'openai',
      type: 'openai-response',
      apiHost: 'https://relay.example.invalid/v1',
      apiKey: 'sk-secret-test-key'
    })
    expect(mocks.flushed).toBe(1)
    expect(onboardingDone).toBe(true)
    expect(localStorage.getItem('onboarding-completed')).toBe('true')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.provider.import_success')

    // Re-importing the exact same provider reports duplicate instead of creating a second record
    await act(async () => {
      enqueueProviderImports([validUrl])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.llmState.providers).toHaveLength(1)
    expect(mocks.toastSuccess).toHaveBeenLastCalledWith('settings.provider.import_duplicate')
  })

  it('surfaces limit and invalid notices without leaking credentials when links overflow or fail validation', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProviderImportHandler />
        </MemoryRouter>
      )
    })

    const secret = 'sk-never-leak-this-secret'
    await act(async () => {
      submitProviderImportText(
        `ccswitch://v1/import?resource=provider&app=gemini&endpoint=https%3A%2F%2Fa.example.invalid&apiKey=${secret}`
      )
      await Promise.resolve()
    })

    expect(mocks.toastError).toHaveBeenCalledWith('settings.provider.import_invalid')
    expect(JSON.stringify(mocks.toastError.mock.calls)).not.toContain(secret)

    // Overflow queue (> PROVIDER_IMPORT_MAX_QUEUE)
    mocks.popupShow.mockResolvedValue(undefined)
    const many = Array.from({ length: PROVIDER_IMPORT_MAX_QUEUE + 2 }, (_, idx) => {
      return `ccswitch://v1/import?resource=provider&app=codex&name=N${idx}&endpoint=https%3A%2F%2Fn${idx}.example.invalid&apiKey=sk-${idx}`
    })
    await act(async () => {
      enqueueProviderImports(many)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.toastError).toHaveBeenCalledWith('settings.provider.import_too_large')
  })

  it('unwinds TopView stack via TopView.back() and invokes onCancel so popup promises resolve without deadlocking', async () => {
    await act(async () => {
      root.render(
        <TopViewContainer>
          <div>base</div>
        </TopViewContainer>
      )
    })

    let resolvedValue: string | undefined = 'pending'
    await act(async () => {
      const p = new Promise<string | undefined>((resolve) => {
        TopView.show(<div id="test-popup">popup</div>, 'TestPopup', () => {
          TopView.hide('TestPopup')
          resolve(undefined)
        })
      })
      void p.then((val) => {
        resolvedValue = val
      })
    })

    expect(container.querySelector('#test-popup')).not.toBeNull()
    expect(TopView.peekId()).toBe('TestPopup')

    let handled = false
    await act(async () => {
      handled = TopView.back()
      await Promise.resolve()
    })

    expect(handled).toBe(true)
    expect(resolvedValue).toBeUndefined()
    expect(container.querySelector('#test-popup')).toBeNull()
    expect(TopView.back()).toBe(false)
  })

  it('rolls back full pre-import llm snapshot for both new and existing providers when Keystore persistence fails', async () => {
    let onboardingDone = false
    mocks.popupShow.mockImplementation(async (incoming: any) => incoming)
    mocks.persistError = new Error('Keystore write failed')
    mocks.llmState.modelCatalogExclusions.openai = ['custom-relay-model-x1']
    expect(mocks.llmState.platformModels.openai.some((m: any) => m.id === 'custom-relay-model-x1')).toBe(false)
    const beforeNewSnapshot = structuredClone(mocks.llmState)

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Harness onState={(done) => (onboardingDone = done)} />
        </MemoryRouter>
      )
    })

    const validUrl =
      'ccswitch://v1/import?resource=provider&app=codex&name=FailVault&endpoint=https%3A%2F%2Frelay.example.invalid&apiKey=sk-secret-vault-fail&model=custom-relay-model-x1'

    await act(async () => {
      submitProviderImportText(validUrl)
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    expect(onboardingDone).toBe(false)
    expect(localStorage.getItem('onboarding-completed')).toBeNull()
    expect(mocks.llmState).toEqual(beforeNewSnapshot)
    expect(mocks.llmState.platformModels.openai.some((m: any) => m.id === 'custom-relay-model-x1')).toBe(false)
    expect(mocks.llmState.modelCatalogExclusions.openai).toEqual(['custom-relay-model-x1'])
    expect(mocks.assertCalls).toBe(2)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('settings.provider.import_save_failed')

    // Case 2: Existing provider already in store (`existing` is truthy), importing a new model + clearing exclusion + setting defaultModel
    mocks.toastError.mockClear()
    mocks.llmState = structuredClone({
      ...initialLlmState,
      providers: [
        {
          id: 'existing-relay-id',
          name: 'ExistingRelay',
          platform: 'openai',
          type: 'openai-response',
          apiKey: 'sk-secret-vault-fail',
          apiHost: 'https://relay.example.invalid/v1',
          enabled: true,
          isSystem: false
        }
      ],
      modelCatalogExclusions: {
        ...initialLlmState.modelCatalogExclusions,
        openai: ['custom-relay-model-x2']
      },
      defaultModel: undefined
    })
    expect(mocks.llmState.platformModels.openai.some((m: any) => m.id === 'custom-relay-model-x2')).toBe(false)
    const beforeExistingSnapshot = structuredClone(mocks.llmState)

    const existingUrlWithNewModel =
      'ccswitch://v1/import?resource=provider&app=codex&name=ExistingRelay&endpoint=https%3A%2F%2Frelay.example.invalid&apiKey=sk-secret-vault-fail&model=custom-relay-model-x2'

    await act(async () => {
      submitProviderImportText(existingUrlWithNewModel)
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    expect(mocks.llmState).toEqual(beforeExistingSnapshot)
    expect(mocks.llmState.platformModels.openai.some((m: any) => m.id === 'custom-relay-model-x2')).toBe(false)
    expect(mocks.llmState.modelCatalogExclusions.openai).toEqual(['custom-relay-model-x2'])
    expect(mocks.llmState.defaultModel).toBeUndefined()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('settings.provider.import_save_failed')
  })
})
