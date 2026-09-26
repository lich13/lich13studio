import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('direct-only model testing', () => {
  it('has no relay transport, endpoint, selector or localized setting', () => {
    const root = path.resolve(import.meta.dirname, '../..')
    const sources = [path.join(root, 'pages/settings/ModelTestPage.tsx')]
    for (const entry of fs.readdirSync(import.meta.dirname)) {
      if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) sources.push(path.join(import.meta.dirname, entry))
    }
    for (const source of sources) {
      expect(fs.readFileSync(source, 'utf8')).not.toMatch(
        /ModelTestTransport|iq-proxy|iq\.nullatoms\.com|runProxyChallenge|proxyWarning/
      )
    }
    for (const folder of ['locales', 'translate']) {
      const directory = path.join(root, 'i18n', folder)
      for (const entry of fs.readdirSync(directory).filter((file) => file.endsWith('.json'))) {
        const strings = JSON.parse(fs.readFileSync(path.join(directory, entry), 'utf8')).settings.modelTest
        expect(strings).not.toHaveProperty('transport')
        expect(strings).not.toHaveProperty('proxyWarning')
      }
    }
  })
})
