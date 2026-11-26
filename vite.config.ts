import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import postcssPresetEnv from 'postcss-preset-env'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type Plugin } from 'vite'

import { legacyWebviewCss } from './scripts/legacyWebviewCss'

const isDev = process.env.NODE_ENV === 'development'
const rootRequire = createRequire(resolve(__dirname, 'package.json'))

function lazyCodeMirrorChunks(): Plugin {
  const themesPkgPath = rootRequire.resolve('@uiw/codemirror-themes-all/package.json')
  const themesDir = dirname(themesPkgPath)
  const virtualThemesId = resolve(themesDir, '__virtual_cm_themes__.mjs')

  const langsPkgPath = rootRequire.resolve('@uiw/codemirror-extensions-langs/package.json')
  const langsDir = dirname(langsPkgPath)
  const virtualLangsId = resolve(langsDir, '__virtual_cm_langs__.mjs')

  let cachedThemesCode: string | null = null
  let cachedLangsCode: string | null = null

  return {
    name: 'lazy-codemirror-chunks',
    resolveId(id) {
      if (id === 'virtual:cm-themes') return virtualThemesId
      if (id === 'virtual:cm-langs') return virtualLangsId
      return null
    },
    load(id) {
      if (id === virtualThemesId) {
        if (cachedThemesCode) return cachedThemesCode
        const themesReq = createRequire(themesPkgPath)
        const themesPkg = JSON.parse(readFileSync(themesPkgPath, 'utf8')) as {
          dependencies?: Record<string, string>
        }
        const entries: string[] = []
        const seen = new Set<string>()
        for (const dep of Object.keys(themesPkg.dependencies || {})) {
          if (!dep.startsWith('@uiw/codemirror-theme-')) continue
          const mod = themesReq(dep) as Record<string, unknown>
          for (const key of Object.keys(mod)) {
            if (key === 'default' || key === '__esModule' || seen.has(key)) continue
            seen.add(key)
            entries.push(
              `  ${JSON.stringify(key)}: () => import(${JSON.stringify(dep)}).then((m) => m[${JSON.stringify(key)}])`
            )
          }
        }
        cachedThemesCode = `const loaders = {\n${entries.join(',\n')}\n};\nexport async function loadCmTheme(name) {\n  return loaders[name] ? await loaders[name]() : null;\n}\n`
        return cachedThemesCode
      }

      if (id === virtualLangsId) {
        if (cachedLangsCode) return cachedLangsCode
        const src = readFileSync(resolve(langsDir, 'esm/index.js'), 'utf8')
        const identMap = new Map<string, { spec: string; orig: string }>()
        for (const line of src.split('\n')) {
          const named = line.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];/)
          if (named) {
            const spec = named[2]
            for (const part of named[1].split(',')) {
              const [orig, alias] = part.trim().split(/\s+as\s+/)
              identMap.set((alias || orig).trim(), { spec, orig: orig.trim() })
            }
          }
          const ns = line.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];/)
          if (ns) {
            identMap.set(ns[1], { spec: ns[2], orig: '*' })
          }
        }

        const bodyMatch = src.match(/export var langs = \{\n([\s\S]*?)\n\};/)
        const body = bodyMatch ? bodyMatch[1] : ''
        const rawEntries = body.split(/,\n(?=  ")/)
        const asyncEntries: string[] = []

        for (const entry of rawEntries) {
          const match = entry.match(/^  ("[^"]+"):\s*\(\)\s*=>\s*([\s\S]+)$/)
          if (!match) continue
          const [, extLiteral, expr] = match
          const usedTokens = new Set(expr.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [])
          const bySpec = new Map<string, Array<{ local: string; orig: string }>>()
          for (const token of usedTokens) {
            const info = identMap.get(token)
            if (!info) continue
            const list = bySpec.get(info.spec) || []
            list.push({ local: token, orig: info.orig })
            bySpec.set(info.spec, list)
          }
          const statements: string[] = []
          for (const [spec, bindings] of bySpec.entries()) {
            const nsBinding = bindings.find((b) => b.orig === '*')
            if (nsBinding) {
              statements.push(`const ${nsBinding.local} = await import(${JSON.stringify(spec)});`)
            } else {
              const destructure = bindings
                .map((b) => (b.orig === b.local ? b.orig : `${b.orig}: ${b.local}`))
                .join(', ')
              statements.push(`const { ${destructure} } = await import(${JSON.stringify(spec)});`)
            }
          }
          statements.push(`return ${expr.trim()};`)
          asyncEntries.push(`  ${extLiteral}: async () => {\n    ${statements.join('\n    ')}\n  }`)
        }

        cachedLangsCode = `const langs = {\n${asyncEntries.join(',\n')}\n};\nexport async function loadLanguageAsync(name) {\n  return langs[name] ? await langs[name]() : null;\n}\n`
        return cachedLangsCode
      }

      return null
    }
  }
}

function pruneLegacyKatexFonts(): Plugin {
  return {
    name: 'prune-legacy-katex-fonts',
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'asset' && /(?:^|\/)KaTeX_.*\.(?:ttf|woff)$/i.test(fileName)) {
          delete bundle[fileName]
          continue
        }
        if (item.type === 'asset' && fileName.endsWith('.css') && typeof item.source === 'string') {
          item.source = item.source.replace(
            /,\s*url\([^)]*KaTeX_[^)]*\.(?:woff|ttf)\)\s*format\(["']?(?:woff|truetype)["']?\)/gi,
            ''
          )
        }
      }
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') },

  css: {
    postcss: {
      plugins: [
        postcssPresetEnv({ browsers: ['Chrome 91', 'Safari 15'], stage: 2, features: { 'cascade-layers': false } }),
        legacyWebviewCss()
      ]
    }
  },
  plugins: [
    (async () => (await import('@tailwindcss/vite')).default())(),
    react({
      tsDecorators: true
    }),
    lazyCodeMirrorChunks(),
    pruneLegacyKatexFonts(),
    ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []),
    ...(process.env.VISUALIZER_RENDERER ? [visualizer({ open: true })] : [])
  ],
  resolve: {
    alias: [
      { find: /^katex$/, replacement: resolve(__dirname, 'node_modules/katex/dist/katex.mjs') },
      { find: '@renderer', replacement: resolve('src/renderer/src') },
      { find: '@shared', replacement: resolve('packages/shared') },
      { find: '@types', replacement: resolve('src/renderer/src/types') },
      { find: '@logger', replacement: resolve('src/renderer/src/services/LoggerService') },
      { find: '@cherrystudio/ai-core', replacement: resolve('packages/aiCore/src') }
    ]
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome91',
    // Use esbuild instead of oxc so RegExp Unicode-set feature probes inside try/catch are preserved.
    minify: 'esbuild',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        miniWindow: resolve(__dirname, 'src/renderer/miniWindow.html')
      },
      onwarn(warning, warn) {
        if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
        warn(warning)
      }
    }
  }
})
