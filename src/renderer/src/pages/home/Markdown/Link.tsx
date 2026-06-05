import { parseJSON } from '@renderer/utils/json'
import { findCitationInChildren } from '@renderer/utils/markdown'
import { isEmpty, omit } from 'lodash'
import React, { useMemo } from 'react'
import type { Node } from 'unist'

import CitationTooltip, { CitationSchema } from './CitationTooltip'
import Hyperlink from './Hyperlink'

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: Omit<Node, 'type'>
}

export const normalizeMarkdownHref = (href: string | undefined) => {
  const trimmedHref = href?.trim()
  if (!trimmedHref) return trimmedHref
  if (/^(?:https?:|mailto:|tel:|#)/i.test(trimmedHref)) {
    return trimmedHref
  }
  if (/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?::\d+)?(?:[/?#].*)?$/i.test(trimmedHref)) {
    return `https://${trimmedHref}`
  }
  return trimmedHref
}

export const openMarkdownLinkExternally = (href: string | undefined, event: React.MouseEvent<HTMLAnchorElement>) => {
  const normalizedHref = normalizeMarkdownHref(href)
  if (!normalizedHref || normalizedHref.startsWith('#')) return
  event.preventDefault()
  event.stopPropagation()
  window.api.shell.openExternal(normalizedHref).catch(() => undefined)
}

const Link: React.FC<LinkProps> = (props) => {
  const citationData = useMemo(() => {
    const raw = parseJSON(findCitationInChildren(props.children))
    const parsed = CitationSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [props.children])

  // 处理内部链接
  if (props.href?.startsWith('#')) {
    return <span className="link">{props.children}</span>
  }

  // 包含<sup>标签表示是一个引用链接
  const isCitation = React.Children.toArray(props.children).some((child) => {
    if (typeof child === 'object' && 'type' in child) {
      return child.type === 'sup'
    }
    return false
  })

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && citationData) {
    return (
      <CitationTooltip citation={citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          href={isEmpty(props.href) ? undefined : props.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => openMarkdownLinkExternally(props.href, e)}
        />
      </CitationTooltip>
    )
  }

  // 普通链接
  return (
    <Hyperlink href={props.href || ''}>
      <a
        {...omit(props, ['node', 'citationData'])}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => openMarkdownLinkExternally(props.href, e)}
      />
    </Hyperlink>
  )
}

export default Link
