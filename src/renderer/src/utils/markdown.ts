import removeMarkdown from 'remove-markdown'
import type { Point, Position } from 'unist'

/**
 * 更彻底的查找方法，递归搜索所有子元素
 * @param {any} children 子元素
 * @returns {string} 找到的 citation 或 ''
 */
export const findCitationInChildren = (children: any): string => {
  if (!children) return ''

  // 直接搜索子元素
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) {
      return child.props['data-citation']
    }

    // 递归查找更深层次
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return ''
}

// O(N) fast check avoiding regex backtracking on long texts with unclosed delimiters
const hasPotentialLatexDelimiters = (text: string): boolean =>
  (text.includes('\\[') && text.includes('\\]')) || (text.includes('\\(') && text.includes('\\)'))

/**
 * 转换 LaTeX 公式括号 `\[\]` 和 `\(\)` 为 Markdown 格式 `$$...$$` 和 `$...$`
 *
 * remark-math 本身不支持 LaTeX 原生语法，作为替代的一些插件效果也不理想。
 *
 * 目前的实现：
 * - 保护代码块和链接，避免被 remark-math 处理
 * - 支持嵌套括号的平衡匹配
 * - 转义括号 `\\(\\)` 或 `\\[\\]` 不会被处理
 *
 * @see https://github.com/remarkjs/remark-math/issues/39
 * @param text 输入的 Markdown 文本
 * @returns 处理后的字符串
 */
const isEscapedAt = (text: string, index: number): boolean => {
  let backslashes = 0
  for (let pos = index - 1; pos >= 0 && text.charCodeAt(pos) === 92; pos -= 1) {
    backslashes += 1
  }
  return (backslashes & 1) === 1
}

const processMathDelimiters = (content: string, openDelim: string, closeDelim: string, wrapper: string): string => {
  if (!content.includes(openDelim) || !content.includes(closeDelim)) {
    return content
  }

  const openLen = openDelim.length
  const closeLen = closeDelim.length
  const openStack: number[] = []
  const accepted: Array<[number, number]> = []
  let nextOpen = content.indexOf(openDelim, 0)
  let nextClose = content.indexOf(closeDelim, 0)

  while (nextOpen !== -1 || nextClose !== -1) {
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      if (!isEscapedAt(content, nextOpen)) {
        openStack.push(nextOpen)
      }
      nextOpen = content.indexOf(openDelim, nextOpen + openLen)
    } else {
      if (!isEscapedAt(content, nextClose) && openStack.length > 0) {
        const matchedOpen = openStack.pop()!
        while (accepted.length > 0 && accepted[accepted.length - 1][0] > matchedOpen) {
          accepted.pop()
        }
        accepted.push([matchedOpen, nextClose])
      }
      nextClose = content.indexOf(closeDelim, nextClose + closeLen)
    }
  }

  if (accepted.length === 0) {
    return content
  }

  const parts: string[] = []
  let lastAppendPos = 0
  for (const [openIdx, closeIdx] of accepted) {
    parts.push(content.slice(lastAppendPos, openIdx), wrapper, content.slice(openIdx + openLen, closeIdx), wrapper)
    lastAppendPos = closeIdx + closeLen
  }
  if (lastAppendPos < content.length) {
    parts.push(content.slice(lastAppendPos))
  }
  return parts.join('')
}

export const processLatexBrackets = (text: string) => {
  // 没有 LaTeX 模式直接返回
  if (!hasPotentialLatexDelimiters(text)) {
    return text
  }

  // 保护代码块和链接
  const protectedItems: string[] = []
  let processedContent = text

  processedContent = processedContent
    // 保护代码块（包括多行代码块和行内代码）
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })
    // 保护链接 [text](url)
    .replace(/\[([^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\([^)]*?\)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })

  // 先处理块级公式，再处理内联公式
  let result = processMathDelimiters(processedContent, '\\[', '\\]', '$$')
  result = processMathDelimiters(result, '\\(', '\\)', '$')

  // 还原被保护的内容
  result = result.replace(/__CHERRY_STUDIO_PROTECTED_(\d+)__/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10)
    // 添加边界检查，防止数组越界
    if (index >= 0 && index < protectedItems.length) {
      return protectedItems[index]
    }
    // 如果索引无效，保持原始匹配
    return match
  })

  return result
}

/**
 * 转换数学公式格式：
 * - 将 LaTeX 格式的 '\\[' 和 '\\]' 转换为 '$$$$'。
 * - 将 LaTeX 格式的 '\\(' 和 '\\)' 转换为 '$$'。
 * @param {string} input 输入字符串
 * @returns {string} 转换后的字符串
 */
export function convertMathFormula(input: string): string {
  if (!input) return input

  let result = input
  result = result.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$')
  result = result.replaceAll('\\(', '$$').replaceAll('\\)', '$$')
  return result
}

/**
 * 移除 Markdown 文本中每行末尾的两个空格。
 * @param {string} markdown 输入的 Markdown 文本
 * @returns {string} 处理后的文本
 */
export function removeTrailingDoubleSpaces(markdown: string): string {
  // 使用正则表达式匹配末尾的两个空格，并替换为空字符串
  return markdown.replace(/ {2}$/gm, '')
}

/**
 * 根据代码块节点的起始位置生成 ID
 * @param start 代码块节点的起始位置
 * @returns 代码块在 Markdown 字符串中的 ID
 */
export function getCodeBlockId(start?: Point): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

/**
 * 更新Markdown字符串中的代码块内容。
 *
 * 由于使用了remark-stringify，所以会有一些默认格式化操作，例如：
 * - 代码块前后会补充换行符。
 * - 有些空格会被trimmed。
 * - 文档末尾会补充一个换行符。
 *
 * @param raw 原始Markdown字符串
 * @param id 代码块ID，按位置生成
 * @param newContent 修改后的代码内容
 * @returns 替换后的Markdown字符串
 */
export async function updateCodeBlock(raw: string, id: string, newContent: string): Promise<string> {
  const [{ unified }, { default: remarkParse }, { default: remarkStringify }, { visit }] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-stringify'),
    import('unist-util-visit')
  ])
  const tree = unified().use(remarkParse).parse(raw)
  visit(tree, 'code', (node) => {
    const startIndex = getCodeBlockId(node.position?.start)
    if (startIndex && id && startIndex === id) {
      node.value = newContent
    }
  })

  return unified().use(remarkStringify).stringify(tree)
}

/**
 * 检查代码块是否包含 open fence。
 * 限制：
 * - 语言名不能包含空格，因为 remark-math 无法处理，会导致 end.offset 过长。
 *
 * 这个算法基于 remark/micromark 解析代码块的原理，所有参数实际上都可以从 node 中获取。
 * 一个代码块的 node.position 包含 fences，而 children 不包含 fences，通过它们之间的
 * 差值就可以判断有没有 closed fence。
 *
 * @param codeLength 代码长度（不包含语言信息）
 * @param metaLength 元数据长度（```之后的语言信息）
 * @param position 位置（unist 节点位置）
 * @returns 是否为 open fence 代码块
 */
export function isOpenFenceBlock(codeLength?: number, metaLength?: number, position?: Position): boolean {
  const contentLength = (codeLength ?? 0) + (metaLength ?? 0)
  const start = position?.start?.offset ?? 0
  const end = position?.end?.offset ?? 0
  // 余量至少是 fence (3) + newlines (2)
  return end - start <= contentLength + 5
}

/**
 * 检查代码是否具有HTML特征
 * @param code 输入的代码字符串
 * @returns 是HTML代码 true，否则 false
 */
export function isHtmlCode(code: string | null): boolean {
  if (!code || !code.trim()) {
    return false
  }

  const trimmedCode = code.trim().toLowerCase()

  // 1. 检查是否包含完整的HTML文档结构
  if (
    trimmedCode.includes('<!doctype html>') ||
    trimmedCode.includes('<html') ||
    trimmedCode.includes('</html>') ||
    trimmedCode.includes('<head') ||
    trimmedCode.includes('</head>') ||
    trimmedCode.includes('<body') ||
    trimmedCode.includes('</body>')
  ) {
    return true
  }

  // 2. 检查是否包含常见的HTML/SVG标签
  const commonTags = [
    '<div',
    '<span',
    '<p',
    '<a',
    '<img',
    '<svg',
    '<table',
    '<ul',
    '<ol',
    '<section',
    '<header',
    '<footer',
    '<nav',
    '<article',
    '<button',
    '<form',
    '<input'
  ]
  if (commonTags.some((tag) => trimmedCode.includes(tag))) {
    return true
  }

  // 3. 检查是否存在至少一个闭合的HTML标签
  // 这个正则表达式查找 <tag>...</tag> 或 <tag .../> 结构
  const pairedTagPattern = /<([a-z0-9]+)([^>]*?)>(.*?)<\/\1>|<([a-z0-9]+)([^>]*?)\/>/
  if (pairedTagPattern.test(trimmedCode)) {
    return true
  }

  return false
}

/**
 * 将 Markdown 字符串转换为纯文本。
 * @param markdown Markdown 字符串。
 * @returns 纯文本字符串。
 */
export const markdownToPlainText = (markdown: string): string => {
  if (!markdown) {
    return ''
  }
  // 直接用 remove-markdown 库，使用默认的 removeMarkdown 参数
  return removeMarkdown(markdown)
}

/**
 * 清理 Markdown 中的 base64 图片链接
 *
 * 将 Markdown 中的 base64 格式图片链接替换为普通链接格式。
 *
 * @param {string} markdown - 包含图片链接的 Markdown 文本
 * @returns {string} 处理后的 Markdown 文本，所有 base64 图片链接都被替换为普通链接
 * @example
 * - 输入: `![image](data:image/png;base64,iVBORw0...)`
 * - 输出: `![image](image_url)`
 */
export const purifyMarkdownImages = (markdown: string): string => {
  return markdown.replace(
    /(!\[[^\]]*\]\()\s*data:image\/[\w+.-]+;base64\s*,[\w+/=]+(?:\s*[\w+/=]+)*\s*\)/gi,
    '$1image_url)'
  )
}
