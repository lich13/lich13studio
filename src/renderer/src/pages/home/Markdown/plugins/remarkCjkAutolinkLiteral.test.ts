import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import remarkCjkAutolinkLiteral from './remarkCjkAutolinkLiteral'

const getLinks = (markdown: string) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkCjkFriendly)
    .use(remarkCjkAutolinkLiteral)
  const tree = processor.runSync(processor.parse(markdown))

  const links: Array<{ url: string; text: string }> = []

  const visit = (node: any) => {
    if (node?.type === 'link') {
      links.push({
        url: node.url,
        text: node.children?.map((child: any) => child.value ?? '').join('') ?? ''
      })
    }
    for (const child of node?.children ?? []) {
      visit(child)
    }
  }

  visit(tree)
  return links
}

describe('remarkCjkAutolinkLiteral', () => {
  it('stops bare URLs before Chinese parentheses text', () => {
    expect(getLinks('下载地址：https://cyberduck.io/（官方提供）')).toEqual([
      { url: 'https://cyberduck.io/', text: 'https://cyberduck.io/' }
    ])
  })

  it('stops bare URLs before full-width punctuation after a closing parenthesis', () => {
    expect(getLinks('FileZilla（https://filezilla-project.org/）。')).toEqual([
      { url: 'https://filezilla-project.org/', text: 'https://filezilla-project.org/' }
    ])
  })

  it('stops bare URLs before following Chinese text', () => {
    expect(getLinks('https://example.com/path?a=1&b=2中文')).toEqual([
      { url: 'https://example.com/path?a=1&b=2', text: 'https://example.com/path?a=1&b=2' }
    ])
  })

  it('keeps GitHub release paths and stops before Chinese suffix text', () => {
    expect(getLinks('下载：https://github.com/electerm/electerm/releases（GitHub）')).toEqual([
      {
        url: 'https://github.com/electerm/electerm/releases',
        text: 'https://github.com/electerm/electerm/releases'
      }
    ])
  })

  it('keeps explicit markdown links unchanged', () => {
    expect(getLinks('[官网](https://cyberduck.io/)')).toEqual([{ url: 'https://cyberduck.io/', text: '官网' }])
  })
})
