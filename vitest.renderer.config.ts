import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: true
  },
  resolve: {
    alias: {
      '@logger': path.resolve(__dirname, 'src/renderer/src/services/LoggerService'),
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
      '@types': path.resolve(__dirname, 'src/renderer/src/types/index.ts'),
      '@shared': path.resolve(__dirname, 'packages/shared'),
      '@cherrystudio/ai-core/provider': path.resolve(__dirname, 'packages/aiCore/src/core/providers'),
      '@cherrystudio/ai-core/built-in/plugins': path.resolve(__dirname, 'packages/aiCore/src/core/plugins/built-in'),
      '@cherrystudio/ai-core': path.resolve(__dirname, 'packages/aiCore/src'),
      '@cherrystudio/ai-sdk-provider': path.resolve(__dirname, 'packages/ai-sdk-provider/src/index.ts')
    }
  },
  esbuild: {
    target: 'node20'
  }
})
