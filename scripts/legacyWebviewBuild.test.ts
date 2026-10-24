import { runInNewContext } from 'node:vm'

import { build, type Rollup } from 'vite'
import { expect, it } from 'vitest'

import config from '../vite.config'

it('preserves RegExp feature detection for WebViews without Unicode sets support', async () => {
  // Syntax highlighters use this probe before constructing Unicode set expressions.
  // Incorrectly folding the constructor to a no-op makes the entire app fail to load.
  const source = `
    const supported = (() => {
      try { new RegExp('[[]]', 'v') } catch { return false }
      return true
    })()
    globalThis.supported = supported
    if (supported) new RegExp('[[^a]]', 'v').test('a')
  `
  const result = (await build({
    ...config,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'feature-detection-fixture',
        resolveId: (id) => (id === 'fixture' ? '\0fixture' : null),
        load: (id) => (id === '\0fixture' ? source : null)
      }
    ],
    build: { ...config.build, write: false, rollupOptions: { input: 'fixture' } }
  })) as Rollup.RollupOutput
  const chunk = result.output.find((output) => output.type === 'chunk')!
  function LegacyRegExp(pattern: string, flags?: string) {
    if (flags?.includes('v')) throw new SyntaxError('Unsupported RegExp flag')
    return new RegExp(pattern, flags)
  }
  const legacy = { RegExp: LegacyRegExp, supported: undefined }
  expect(() => runInNewContext(chunk.code, legacy)).not.toThrow()
  expect(legacy.supported).toBe(false)
  const modern = { supported: undefined }
  expect(() => runInNewContext(chunk.code, modern)).not.toThrow()
  expect(modern.supported).toBe(true)
})
