import postcss, { type AtRule, type Document, type Plugin } from 'postcss'

/** Keep modern cascade layers intact and supply ordered rules for older WebViews. */
export function legacyWebviewCss(): Plugin {
  return {
    postcssPlugin: 'lich13studio-legacy-webview-css',
    OnceExit(root) {
      const layers: AtRule[] = []
      root.walkAtRules('layer', (rule) => {
        if (!rule.nodes) return
        let parent: AtRule['parent'] | Document = rule.parent
        while (parent) {
          if (parent.type === 'atrule' && parent.name === 'layer') return
          parent = parent.parent
        }
        layers.push(rule)
      })
      for (const layer of layers) {
        const copy = layer.clone()
        copy.walkAtRules('layer', (nested) => {
          if (nested.nodes) nested.replaceWith(nested.nodes)
          else nested.remove()
        })
        const fallback = postcss.atRule({ name: 'supports', params: 'not (color: revert-layer)' })
        fallback.append(copy.nodes || [])
        layer.after(fallback)
      }
    }
  }
}
