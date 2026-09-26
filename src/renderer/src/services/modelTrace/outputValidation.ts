export type OutputIssue = 'empty' | 'reasoning-tag' | 'format' | 'range' | 'count' | 'incomplete'

export interface OutputValidation {
  accepted: boolean
  text: string
  numbers: number[]
  parsedCount: number
  expectedCount: number
  issue?: OutputIssue
}

/** Only explicit thought tags are removed. Untagged prose is never guessed away. */
export function isolateAnswer(text: string, complete = true): { text: string; malformed: boolean } {
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
  return { text: answer.trim(), malformed }
}

export function validateModelTraceOutput(raw: string, expectedCount: number): OutputValidation {
  const isolated = isolateAnswer(raw)
  let text = isolated.text.replace(/^\uFEFF/, '').trim()
  const result = (issue?: OutputIssue, numbers: number[] = []): OutputValidation => ({
    accepted: issue === undefined,
    text,
    numbers,
    parsedCount: numbers.length,
    expectedCount,
    issue
  })
  if (isolated.malformed) {
    // Preserve invalid delimiters so revalidating the displayed result cannot
    // turn an incomplete thought block into an apparently valid answer.
    text = raw.trim()
    return result('reasoning-tag')
  }
  if (!text) return result('empty')

  if (text.startsWith('```')) {
    const fence = /^```(?:text|txt|json|csv)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text)
    if (!fence) return result('format')
    text = fence[1].trim()
  }
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim()
  // Full-string matching prevents prose, list numbering, decimals and signs from becoming numbers.
  if (!/^\d+(?:[\s,，、;；]+\d+)*[\s,，、;；]*$/u.test(text)) return result('format')
  const numbers = text.match(/\d+/g)!.map(Number)
  if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1 || number > 355))
    return result('range', numbers)
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || numbers.length !== expectedCount)
    return result('count', numbers)
  return result(undefined, numbers)
}
