import { describe, expect, it } from 'vitest'

import { isolateAnswer, MINIMUM_ANALYSIS_NUMBERS, validateModelTraceOutput } from './outputValidation'

const sample = Array(80).fill('247').join(' ')

describe('ModelTrace analysis eligibility', () => {
  it.each([sample, `[${sample}]`, `\`\`\`text\n${sample}\n\`\`\``, `\`\`\`json\n[${sample}]\n\`\`\``])(
    'accepts complete integer sequences without rewriting their text',
    (text) => {
      expect(validateModelTraceOutput(text, 303)).toMatchObject({ accepted: true, text, usableCount: 80 })
    }
  )
  it.each([80, 299, 332, 500])('accepts %i integers regardless of the requested count', (count) => {
    expect(validateModelTraceOutput(Array(count).fill('7').join(','), 303)).toMatchObject({
      accepted: true,
      parsedCount: count,
      usableCount: count,
      excludedCount: 0
    })
  })
  it('uses the minimum sample boundary, preserving duplicate values and order', () => {
    expect(validateModelTraceOutput(Array(79).fill('3').join(' '), 79)).toMatchObject({
      accepted: false,
      issue: 'insufficient'
    })
    const numbers = [3, 3, 1, 355, ...Array(76).fill(2)]
    expect(validateModelTraceOutput(numbers.join(' '), 999).numbers).toEqual(numbers)
    expect(numbers).toHaveLength(MINIMUM_ANALYSIS_NUMBERS)
  })
  it('retains excluded values in the answer while filtering only the scoring array', () => {
    const text = `0 -1 356 999999999999999999999 ${sample} +355`
    expect(validateModelTraceOutput(text, 303)).toMatchObject({
      accepted: true,
      text,
      numbers: [...Array(80).fill(247), 355],
      parsedCount: 85,
      usableCount: 81,
      excludedCount: 4
    })
  })
  it.each([
    `Need 80 values. ${sample}`,
    `${sample} done`,
    `1. 23\n2. 42 ${sample}`,
    `1.2 ${sample}`,
    `1e2 ${sample}`,
    `[${sample}`,
    `\`\`\`text\n${sample}`,
    `1 2 ... ${sample}`
  ])('does not mine integers from unsupported content', (text) => {
    expect(validateModelTraceOutput(text, 303)).toMatchObject({
      accepted: false,
      issue: 'format',
      numbers: [],
      usableCount: 0
    })
  })
  it('reports empty and entirely excluded samples without inventing numbers', () => {
    expect(validateModelTraceOutput('', 303).issue).toBe('empty')
    expect(validateModelTraceOutput('0 -1 356', 303)).toMatchObject({
      accepted: false,
      issue: 'insufficient',
      usableCount: 0,
      excludedCount: 3
    })
  })
  it('isolates thought content, including nested and split tags', () => {
    expect(isolateAnswer('<thi', false).text).toBe('')
    expect(isolateAnswer('<thinking>secret 303', false).text).toBe('')
    expect(
      validateModelTraceOutput(`<thinking>secret <analysis>123</analysis></thinking>${sample}`, 303)
    ).toMatchObject({
      accepted: true,
      parsedCount: 80,
      numbers: Array(80).fill(247)
    })
    for (const raw of ['<think>123', `<think>123</analysis>${sample}`, `${sample} <think>`]) {
      const result = validateModelTraceOutput(raw, 303)
      expect(result).toMatchObject({ accepted: false, issue: 'reasoning-tag', usableCount: 0 })
      expect(validateModelTraceOutput(result.text, 303).accepted).toBe(false)
    }
  })
})
