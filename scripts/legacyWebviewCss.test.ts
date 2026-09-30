import postcss from 'postcss'
import presetEnv from 'postcss-preset-env'
import { describe, expect, it } from 'vitest'

import { legacyWebviewCss } from './legacyWebviewCss'

const compile = async (css: string) =>
  (
    await postcss([
      presetEnv({ browsers: ['Chrome 91', 'Safari 15'], stage: 2, features: { 'cascade-layers': false } }),
      legacyWebviewCss()
    ]).process(css, { from: undefined })
  ).root

describe('legacy WebView stylesheet', () => {
  it('keeps modern layers while making sizing utilities available below Chromium 99', async () => {
    const root = await compile(
      '@layer theme, utilities; @layer theme { :root { --spacing: .25rem } } @layer utilities { .h-16 { height: calc(var(--spacing) * 16) } }'
    )
    expect(root.toString()).toContain('@layer utilities')
    const legacy: string[] = []
    root.walkAtRules('supports', (node) => {
      if (node.params === 'not (color: revert-layer)') legacy.push(node.toString())
    })
    expect(legacy).toHaveLength(2)
    expect(legacy[0]).toContain('--spacing: .25rem')
    expect(legacy[1]).toContain('.h-16')
    expect(legacy.every((css) => !css.includes('@layer'))).toBe(true)
  })
  it('keeps conditional rules, custom properties and source order without changing runtime selector specificity', async () => {
    const root = await compile(
      '@layer utilities { @media (min-width: 300px) { @layer nested { .model { width: 48px } } } } .model { min-width: 0 }'
    )
    const legacy: string[] = []
    root.walkAtRules('supports', (node) => {
      if (node.params === 'not (color: revert-layer)') legacy.push(node.toString())
    })
    expect(legacy).toHaveLength(1)
    expect(legacy[0]).toContain('@media')
    expect(legacy[0]).toContain('.model')
    expect(legacy[0]).not.toContain('@layer')
    expect(legacy[0]).not.toContain('#')
    expect(root.nodes.at(-1)?.toString()).toContain('min-width: 0')
  })
  it('adds RGB fallbacks for the theme colors used by older WebViews', async () => {
    const root = await compile(':root { --background: oklch(1 0 0); }')
    expect(root.toString()).toMatch(/--background:\s*(?:#fff(?:fff)?|rgb\(255)/)
  })
})
