export type OutputIssue = 'empty' | 'reasoning-tag' | 'format' | 'insufficient'
export const MINIMUM_ANALYSIS_NUMBERS = 80

export interface OutputValidation {
  accepted: boolean
  text: string
  numbers: number[]
  parsedCount: number
  usableCount: number
  excludedCount: number
  expectedCount: number
  issue?: OutputIssue
}

/** Only explicit thought tags are removed. Untagged prose is never guessed away. */
export function isolateAnswer(text: string, complete = true, trim = true): { text: string; malformed: boolean } {
  const tags = /<\s*(\/?)\s*(think|thinking|reasoning|analysis|seed:think)\s*>/gi
  const stack: string[] = []
  let answer = ''
  let cursor = 0
  let malformed = false
  for (const match of text.matchAll(tags)) {
    if (stack.length === 0) answer += text.slice(cursor, match.index)
    const tag = match[2].toLowerCase()
    if (match[1]) {
      if (stack.pop() !== tag) malformed = true
      if (stack.length === 0) answer += ' '
    } else {
      stack.push(tag)
    }
    cursor = match.index! + match[0].length
  }
  if (stack.length === 0) answer += text.slice(cursor)
  if (complete) {
    malformed ||= stack.length > 0 || /<\/?\s*(?:think|reason|analysis|seed:)/i.test(answer)
  } else {
    // Hold a partial opening tag until the next delta, rather than showing it.
    const pendingTag = answer.lastIndexOf('<')
    if (pendingTag >= 0 && !answer.slice(pendingTag).includes('>')) answer = answer.slice(0, pendingTag)
  }
  return { text: trim ? answer.trim() : answer, malformed }
}

/** Content eligibility is independent of whether the provider request completed. */
export function validateModelTraceOutput(raw: string, expectedCount: number): OutputValidation {
  const isolated = isolateAnswer(raw)
  // Preserve the answer exactly, including wrappers and excluded values. Only
  // the separate scoring array is filtered; never repair the displayed output.
  const text = (isolated.malformed ? raw : isolated.text).replace(/^\uFEFF/, '').trim()
  let sequence = text
  const result = (issue?: OutputIssue, parsed: number[] = []): OutputValidation => {
    const numbers = parsed.filter((value) => Number.isSafeInteger(value) && value >= 1 && value <= 355)
    return {
      accepted: issue === undefined && numbers.length >= MINIMUM_ANALYSIS_NUMBERS,
      text,
      numbers,
      parsedCount: parsed.length,
      usableCount: numbers.length,
      excludedCount: parsed.length - numbers.length,
      expectedCount,
      issue: issue ?? (numbers.length < MINIMUM_ANALYSIS_NUMBERS ? 'insufficient' : undefined)
    }
  }
  if (isolated.malformed) return result('reasoning-tag')
  if (!text) return result('empty')
  if (sequence.startsWith('```')) {
    const fence = /^```(?:text|txt|json|csv)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(sequence)
    if (!fence) return result('format')
    sequence = fence[1].trim()
  }
  if (sequence.startsWith('[') && sequence.endsWith(']')) sequence = sequence.slice(1, -1).trim()
  // Signs are parsed with the integer, so -1 is excluded rather than scored as 1.
  // Full-string matching still excludes prose, numbering, decimals and exponents.
  if (!/^[+-]?\d+(?:[\s,，、;；]+[+-]?\d+)*[\s,，、;；]*$/u.test(sequence)) return result('format')
  return result(undefined, sequence.match(/[+-]?\d+/g)!.map(Number))
}
