import { resolve } from 'node:path'

import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import postcssPresetEnv from 'postcss-preset-env'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

import { legacyWebviewCss } from './scripts/legacyWebviewCss'
const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'
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
    ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []), // 只在开发环境下启用 CodeInspectorPlugin
    ...(process.env.VISUALIZER_RENDERER ? [visualizer({ open: true })] : [])
  ],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('packages/shared'),
      '@types': resolve('src/renderer/src/types'),
      '@logger': resolve('src/renderer/src/services/LoggerService'),
      '@trace/trace-core': resolve('packages/trace/trace-core'),
      '@trace/trace-web': resolve('packages/trace/trace-web'),
      '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
      '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
      '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
      '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
      '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src')
    }
  },
  optimizeDeps: {
    exclude: ['pyodide'],
    esbuildOptions: {
      target: 'esnext' // for dev
    }
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome91',
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
  },
  esbuild: isProd ? { legalComments: 'none' } : {}
})
