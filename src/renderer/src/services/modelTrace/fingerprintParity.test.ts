import { describe, expect, it } from 'vitest'

import bank from './data/unified_bank.json'
import { analyzeGlobalOutputs as analyzeUpstream } from './data/upstream-fingerprint-core.mjs'
import { analyzeGlobalOutputs } from './fingerprintCore'

const expectedCounts = [303, 317, 329]
const sampleSets = [
  {
    name: 'full-range cycles',
    numbers: expectedCounts.map((count, group) =>
      Array.from({ length: count }, (_, index) => ((index * 37 + group * 113) % 355) + 1)
    )
  },
  {
    name: 'repeated boundary values',
    numbers: expectedCounts.map((count, group) =>
      Array.from({ length: count }, (_, index) => [1, 355, 10, 100, 200, 354][(index + group) % 6])
    )
  },
  {
    name: 'ordered blocks at the shared eligibility threshold',
    numbers: expectedCounts.map((count, group) =>
      Array.from({ length: Math.max(80, Math.ceil(count * 0.55)) }, (_, index) =>
        Math.min(355, 1 + Math.floor(index / 43) * 89 + group * 3)
      )
    )
  }
]

describe.each(sampleSets)('bundled upstream fingerprint parity: $name', ({ numbers }) => {
  it.each([1, 2, 3])('preserves scores and probabilities for %i legal groups', (count) => {
    const outputs = numbers.slice(0, count).map((values, index) => {
      expect(values.length).toBeGreaterThanOrEqual(Math.max(80, Math.ceil(expectedCounts[index] * 0.55)))
      expect(values.every((value) => Number.isInteger(value) && value >= 1 && value <= 355)).toBe(true)
      return { expected_count: expectedCounts[index], text: values.join(' '), status: 'completed' }
    })
    const expected = analyzeUpstream(outputs, bank)
    const actual = analyzeGlobalOutputs(outputs, bank)!

    expect(actual).toBeDefined()
    expect(actual.used_outputs).toBe(count)
    expect(actual.used_outputs).toBe(expected.used_outputs)
    expect(actual.prediction).toBe(expected.prediction)
    expect(actual.prediction_name).toBe(expected.prediction_name)
    expect(actual.probability).toBeCloseTo(expected.probability, 12)
    expect(actual.calibration).toEqual(expected.calibration)
    expect(actual.calibration.queries).toBe(String(count))
    expect(actual.results.map((entry) => entry.model)).toEqual(expected.results.map((entry) => entry.model))
    expect(actual.results).toHaveLength(bank.models.length)
    actual.results.forEach((entry, index) => {
      const reference = expected.results[index]
      expect(entry.display_name).toBe(reference.display_name)
      expect(entry.family).toBe(reference.family)
      expect(entry.score).toBeCloseTo(reference.score, 12)
      expect(entry.probability).toBeCloseTo(reference.probability, 12)
      expect(entry.conditional_probability).toBeCloseTo(reference.conditional_probability, 12)
      expect(entry.profile_similarity).toBeCloseTo(reference.profile_similarity, 12)
    })
    expect(actual.results.reduce((sum, entry) => sum + entry.probability, 0)).toBeCloseTo(1, 12)
    expect(actual.family_prediction).toBe(expected.family_prediction)
    expect(actual.family_prediction_name).toBe(expected.family_prediction_name)
    expect(actual.family_probability).toBeCloseTo(expected.family_probability, 12)
    expect(actual.family_probabilities.map((entry) => entry.family)).toEqual(
      expected.family_probabilities.map((entry) => entry.family)
    )
    actual.family_probabilities.forEach((entry, index) => {
      expect(entry.probability).toBeCloseTo(expected.family_probabilities[index].probability, 12)
    })
  })
})
