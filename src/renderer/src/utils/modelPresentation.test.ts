import { describe, expect, it } from 'vitest'

import { getModelPresentation } from './modelPresentation'

describe('model presentation', () => {
  it.each(['GPT-6.1-Sol', ' GPT 6_1 Sol ', 'gpt_6.1_sol', 'gpt.6.1.SOL', 'GPT—6‐1‑Sol', 'ＧＰＴ－６．１－Ｓｏｌ'])(
    'suppresses equivalent identifiers without rewriting them: %s',
    (name) => {
      const id = 'gpt-6.1-sol'
      expect(getModelPresentation({ name, id })).toEqual({
        primary: name.trim(),
        secondary: undefined,
        label: name.trim(),
        id,
        searchText: `${name.trim()} ${id}`
      })
    }
  )

  it.each(['我的常用模型', ' Work model ', 'GPT 6.1 Sol · custom'])(
    'keeps a custom name and its real ID: %s',
    (name) => {
      const id = 'vendor/GPT_6.1-Sol'
      expect(getModelPresentation({ name, id })).toEqual({
        primary: name.trim(),
        secondary: id,
        label: `${name.trim()} · ${id}`,
        id,
        searchText: `${name.trim()} ${id}`
      })
    }
  )

  it.each([
    ['Sol', 'Luna'],
    ['Sol', 'Astra'],
    ['Luna', 'Sol'],
    ['Luna', 'Astra'],
    ['Astra', 'Sol'],
    ['Astra', 'Luna']
  ])('does not merge %s with %s', (displayVariant, requestVariant) => {
    const name = `GPT 6.1 ${displayVariant}`
    const id = `gpt-6.1-${requestVariant.toLowerCase()}`
    const result = getModelPresentation({ name, id })
    expect(result.primary).toBe(name)
    expect(result.secondary).toBe(id)
    expect(result.label).toBe(`${name} · ${id}`)
    expect(result.searchText).toBe(`${name} ${id}`)
  })

  it.each([
    ['openai/gpt-6.1-sol', 'gpt-6.1-sol'],
    ['gpt-6.1-sol', 'openai/gpt-6.1-sol'],
    ['gpt-6.1-sol', 'vendor-gpt-6.1-sol'],
    ['gpt-6.1-sol', 'gpt-6.1-sol-20260930'],
    ['gpt-6.1-sol-20260930', 'gpt-6.1-sol'],
    ['gpt-6.1-sol-20260929', 'gpt-6.1-sol-20260930'],
    ['gpt61sol', 'gpt-6.1-sol']
  ])('preserves meaningful differences between %s and %s', (name, id) => {
    const result = getModelPresentation({ name, id })
    expect(result.secondary).toBe(id)
    expect(result.id).toBe(id)
    expect(result.searchText).toBe(`${name} ${id}`)
  })

  it.each([undefined, '', ' ', '\t\n'])('falls back to the exact ID for an empty name: %s', (name) => {
    const id = 'vendor/GPT_6.1-Sol-20260930'
    expect(getModelPresentation({ name, id })).toEqual({
      primary: id,
      secondary: undefined,
      label: id,
      id,
      searchText: `${id} ${id}`
    })
  })

  it('does not mutate the provider model', () => {
    const model = Object.freeze({ name: ' GPT 6_1 Sol ', id: 'GPT-6.1-Sol' })
    const result = getModelPresentation(model)
    expect(result.id).toBe('GPT-6.1-Sol')
    expect(result.searchText).toBe('GPT 6_1 Sol GPT-6.1-Sol')
    expect(model).toEqual({ name: ' GPT 6_1 Sol ', id: 'GPT-6.1-Sol' })
  })
})
