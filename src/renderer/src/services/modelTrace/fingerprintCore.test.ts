import bank from '@renderer/services/modelTrace/data/unified_bank.json'
import { analyzeGlobalOutputs, parseNumbers } from '@renderer/services/modelTrace/fingerprintCore'
import { MINIMUM_ANALYSIS_NUMBERS } from '@renderer/services/modelTrace/outputValidation'
import { describe, expect, it } from 'vitest'

const text = Array.from({ length: 310 }, (_, index) => String((index % 355) + 1)).join(' ')
const good = { expected_count: 303, text }

describe('ModelTrace local analyzer', () => {
  it('never mines numeric runs out of prose', () => {
    expect(parseNumbers('说明 1 2 3 done 4 5')).toEqual([])
    expect(parseNumbers('1 2 3')).toEqual([1, 2, 3])
    expect(parseNumbers('-1 0 356 3 3')).toEqual([3, 3])
    expect(MINIMUM_ANALYSIS_NUMBERS).toBe(bank.minimum_valid_numbers)
  })

  it.each([1, 2, 3])('uses existing calibration for %i available groups', (count) => {
    const result = analyzeGlobalOutputs(Array(count).fill(good), bank)!
    expect(result.used_outputs).toBe(count)
    expect(result.calibration.queries).toBe(String(count))
    expect(result.calibration.beta).toBe(bank.calibration[String(count)].beta)
    expect(result.results).toHaveLength(bank.models.length)
    expect(result.results.every((entry) => Number.isFinite(entry.probability))).toBe(true)
    expect(result.results.reduce((sum, entry) => sum + entry.probability, 0)).toBeCloseTo(1)
  })

  it('keeps scoring unchanged when only the target count or excluded values differ', () => {
    const result = analyzeGlobalOutputs([{ expected_count: 999, text: `-1 0 999 ${text} 356` }], bank)!
    expect(result.results).toEqual(analyzeGlobalOutputs([good], bank)!.results)
    expect(result.diagnostics[0]).toMatchObject({
      accepted: true,
      parsed_numbers: 314,
      usable_numbers: 310,
      excluded_numbers: 4,
      expected_numbers: 999
    })
  })

  it('uses only completed eligible groups and preserves original diagnostic indices', () => {
    const result = analyzeGlobalOutputs(
      [
        { ...good, status: 'error' },
        { ...good, status: 'completed' },
        { ...good, text: '1 2 3', status: 'completed' }
      ],
      bank
    )!
    expect(result.used_outputs).toBe(1)
    expect(result.diagnostics.map((entry) => entry.accepted)).toEqual([false, true, false])
    expect(result.diagnostics[1].index).toBe(1)
  })

  it('returns no report for missing, contaminated or insufficient samples', () => {
    expect(analyzeGlobalOutputs([], bank)).toBeUndefined()
    expect(analyzeGlobalOutputs([{ ...good, text: '1 2 3' }], bank)).toBeUndefined()
    expect(analyzeGlobalOutputs([{ ...good, text: `Explanation ${text}` }], bank)).toBeUndefined()
  })
})
