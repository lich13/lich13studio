import { describe, expect, it } from 'vitest'

import { createPlatformModels } from '../platforms'
import { migrateModelCatalogState, sanitizePersistedState } from '../stateMigration'
import { mergeCatalogModels, recordCatalogEdits } from './merge'
import { bundledModelCatalogs, findOfficialModel, installModelCatalog } from './runtime'

describe('official directory preservation and migration 222', () => {
  it('adds new releases but preserves edits, order and deleted old seeds', () => {
    const custom = {
      id: 'gpt-6-sol',
      name: 'My Sol',
      group: 'Custom',
      capabilities: [{ type: 'vision', isUserSelected: false }],
      pricing: { input: 12 }
    }
    const state = {
      llm: {
        platformModels: {
          ...createPlatformModels(),
          openai: [custom, { id: 'private-model', name: 'Private', group: '' }]
        }
      },
      chats: [{ id: 1, text: 'Keep history' }]
    }
    const before = structuredClone(state)
    const next = migrateModelCatalogState(state)
    expect(next.llm.platformModels.openai.slice(0, 2)).toEqual(before.llm.platformModels.openai)
    expect(next.llm.platformModels.openai.map((m) => m.id)).toEqual(['gpt-6-sol', 'private-model', 'gpt-6.1-sol'])
    expect(next.chats).toEqual(before.chats)
    expect(migrateModelCatalogState(structuredClone(next))).toEqual(next)
  })
  it('respects empty directories and manual re-additions after sync', () => {
    const previous = createPlatformModels().openai
    const removed = recordCatalogEdits(previous, [], [])
    expect(mergeCatalogModels([], bundledModelCatalogs.openai.models, removed, 'openai')).toEqual([])
    const added = [{ id: 'gpt-6.1-sol', name: 'Restored', group: 'OpenAI' }]
    expect(recordCatalogEdits([], added, removed)).not.toContain('gpt-6.1-sol')
  })
  it('restores old backups idempotently without modifying preserved slices', () => {
    const value = {
      _persist: { version: 221 },
      llm: {
        providers: [
          {
            id: 'p',
            type: 'openai-response',
            platform: 'openai',
            apiHost: 'https://example.org/v1',
            apiKey: 'test-only'
          }
        ],
        platformModels: createPlatformModels()
      },
      messages: { keep: 'original' }
    }
    value.llm.platformModels.openai = value.llm.platformModels.openai.filter((m) => m.id !== 'gpt-6.1-sol')
    const raw = JSON.stringify(
      Object.fromEntries(Object.entries(value).map(([key, val]) => [key, JSON.stringify(val)]))
    )
    const restored = sanitizePersistedState(raw)
    expect(sanitizePersistedState(restored)).toBe(restored)
    const decoded = JSON.parse(restored)
    expect(JSON.parse(decoded.llm).platformModels.openai.some((m) => m.id === 'gpt-6.1-sol')).toBe(true)
    expect(decoded.messages).toBe(JSON.stringify(value.messages))
    expect(JSON.parse(decoded.llm).providers[0].apiKey).toBe('test-only')
  })
  it('normalizes metadata lookup without changing original IDs or treating labels as facts', () => {
    expect(findOfficialModel('VENDOR/GPT_6.1_SOL')?.id).toBe('gpt-6.1-sol')
    expect(findOfficialModel('gpt-6.1-sol-20260930')?.capabilities.vision).toBe(true)
    expect(findOfficialModel('gpt-99-unknown')).toBeUndefined()
    expect(findOfficialModel('claude-opus-4-5')?.id).toBe('claude-opus-4-5-20251101')
    expect(findOfficialModel('grok-code-fast-1')?.id).toBe('grok-build-0.1')
  })
  it('installs new metadata without mutating the source snapshot', () => {
    const next = structuredClone(bundledModelCatalogs.openai)
    next.models.find((m) => m.id === 'gpt-6.1-sol')!.capabilities.vision = false
    installModelCatalog(next)
    expect(findOfficialModel('gpt-6.1-sol')!.capabilities.vision).toBe(false)
    next.models.find((m) => m.id === 'gpt-6.1-sol')!.capabilities.vision = true
    expect(findOfficialModel('gpt-6.1-sol')!.capabilities.vision).toBe(false)
    installModelCatalog(bundledModelCatalogs.openai)
  })
})
