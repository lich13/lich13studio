import type { Link, Parent, Text } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

const CJK_AUTOLINK_STOP_PATTERN = /[\u3400-\u9fff\u3000-\u303f\uff00-\uff65]/
const TRAILING_ASCII_PUNCTUATION = /[),.;:!?]+$/

const trimAutolinkUrl = (url: string): string => {
  const cjkIndex = url.search(CJK_AUTOLINK_STOP_PATTERN)
  const withoutCjkSuffix = cjkIndex >= 0 ? url.slice(0, cjkIndex) : url
  return withoutCjkSuffix.replace(TRAILING_ASCII_PUNCTUATION, '')
}

const getSingleTextChild = (node: Link): Text | null => {
  if (node.children.length !== 1) return null
  const child = node.children[0]
  return child.type === 'text' ? child : null
}

const remarkCjkAutolinkLiteral: Plugin<[], any> = () => {
  return (tree) => {
    visit(tree, 'link', (node: Link, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || typeof index !== 'number') return
      if (!node.url.startsWith('http://') && !node.url.startsWith('https://')) return

      const child = getSingleTextChild(node)
      if (!child || child.value !== node.url) return

      const trimmedUrl = trimAutolinkUrl(node.url)
      if (!trimmedUrl || trimmedUrl === node.url) return

      const suffix = node.url.slice(trimmedUrl.length)
      node.url = trimmedUrl
      child.value = trimmedUrl

      parent.children.splice(index + 1, 0, {
        type: 'text',
        value: suffix
      } as Text)
    })
  }
}

export default remarkCjkAutolinkLiteral
