import { describe, expect, it } from 'vitest'

import { countVisibleNumericTokens, isolateAnswer, validateModelTraceOutput } from './outputValidation'

describe('strict ModelTrace admission', () => {
  it.each(['1 2 2 355', '1, 2; 2，355', '[1, 2, 2, 355]', '```text\n1 2 2 355\n```', '```json\n[1,2,2,355]\n```'])(
    'accepts only complete numeric answers: %s',
    (text) => {
      expect(validateModelTraceOutput(text, 4)).toMatchObject({ accepted: true, numbers: [1, 2, 2, 355] })
    }
  )
  it.each([
    'Need 4 values. 1 2 2 355',
    '1 2 2 355 done',
    '1. 23\n2. 42',
    '-1 2 3 4',
    '1.2 2 3 4',
    '1e2 2 3 4',
    '[1 2 3',
    '```text\n1 2 3',
    '1 2 ... 4'
  ])('rejects contaminated formats: %s', (text) => expect(validateModelTraceOutput(text, 4).accepted).toBe(false))
  it.each(['0 1 2 3', '1 2 3 356', '999999999999999999999 2 3 4'])(
    'does not silently discard out of range numbers: %s',
    (text) => {
      expect(validateModelTraceOutput(text, 4)).toMatchObject({ accepted: false, issue: 'range', parsedCount: 4 })
    }
  )
  it('requires an exact count, preserving repeated values and their order', () => {
    expect(validateModelTraceOutput('3 3 1', 4).issue).toBe('count')
    expect(validateModelTraceOutput('3 3 1 2 2', 4).issue).toBe('count')
    expect(validateModelTraceOutput('3 3 1 2', 4).numbers).toEqual([3, 3, 1, 2])
  })
  it('shows an honest diagnostic count for invalid prose while excluding tagged thought content', () => {
    expect(validateModelTraceOutput('Need 4 values: 1 2 3 4', 4)).toMatchObject({
      accepted: false,
      issue: 'format',
      parsedCount: 5
    })
    expect(countVisibleNumericTokens('<think>999 888</think>1 2 3')).toBe(3)
    expect(validateModelTraceOutput('<think>999 888</think>1 2 3', 4).parsedCount).toBe(3)
  })
  it('rejects the cumulative-prefix corruption from v0.1.19', () => {
    const numbers = Array.from({ length: 303 }, (_, i) => String((i % 355) + 1))
    const corrupted = numbers.map((_, i) => numbers.slice(0, i + 1).join(', ')).join('')
    expect(validateModelTraceOutput(corrupted, 303).accepted).toBe(false)
  })
  it('isolates only explicitly delimited reasoning, including nested and split tags', () => {
    expect(isolateAnswer('<thi', false).text).toBe('')
    expect(isolateAnswer('<thinking>secret 303', false).text).toBe('')
    expect(validateModelTraceOutput('<thinking>secret <analysis>123</analysis></thinking>1 2 3', 3)).toMatchObject({
      accepted: true,
      numbers: [1, 2, 3]
    })
    expect(validateModelTraceOutput('<think>123', 3).issue).toBe('reasoning-tag')
    expect(validateModelTraceOutput('<think>123</analysis>1 2 3', 3).issue).toBe('reasoning-tag')
    expect(validateModelTraceOutput('1 2 3 <think>', 3).issue).toBe('reasoning-tag')
    const incomplete = validateModelTraceOutput('1 2 3 <think>', 3)
    expect(validateModelTraceOutput(incomplete.text, 3).accepted).toBe(false)
  })
})
