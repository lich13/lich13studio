import bank from '@renderer/services/modelTrace/data/unified_bank.json'
import { analyzeGlobalOutputs, parseNumbers } from '@renderer/services/modelTrace/fingerprintCore'
import { describe, expect, it } from 'vitest'

describe('ModelTrace local analyzer', () => {
  it('parses number runs and separates prose by letter boundaries', () => {
    expect(parseNumbers('说明 1 2 3 done 4 5')).toEqual([1, 2, 3])
  })

  it('accepts complete challenge outputs and reports diagnostics', () => {
    const text = Array.from({ length: 310 }, (_, index) => String((index % 355) + 1)).join(' ')
    const result = analyzeGlobalOutputs(
      [
        { expected_count: 310, text },
        { expected_count: 310, text },
        { expected_count: 310, text }
      ],
      bank
    )
    expect(result.used_outputs).toBe(3)
    expect(result.diagnostics.every((item) => item.accepted)).toBe(true)
    expect(result.results.length).toBe(bank.models.length)
  })

  it('rejects outputs that are too short to analyze', () => {
    expect(() => analyzeGlobalOutputs([{ expected_count: 310, text: '1 2 3' }], bank)).toThrow()
  })
})
