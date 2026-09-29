import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { fetchPlatformModelCatalog } from '../packages/shared/modelCatalog/sources'
import { canonicalModels, catalogDigest, validateCatalog } from '../packages/shared/modelCatalog/types'

async function main() {
  const target = resolve(__dirname, '../packages/shared/modelCatalog/bundled.json')
  const platforms = ['openai', 'grok', 'anthropic'] as const
  if (process.argv.includes('--check')) {
    const catalogs = JSON.parse(await readFile(target, 'utf8'))
    for (const platform of platforms) {
      const snapshot = catalogs[platform]
      validateCatalog(snapshot)
      if (
        snapshot.platform !== platform ||
        (await catalogDigest(JSON.stringify(canonicalModels(snapshot.models)))) !== snapshot.sha256
      )
        throw new Error(`Invalid ${platform} bundled digest`)
    }
    console.log('Three bundled model catalogs verified')
  } else {
    const refIndex = process.argv.indexOf('--openai-ref')
    const ref = refIndex === -1 ? undefined : process.argv[refIndex + 1]
    const entries: [string, Awaited<ReturnType<typeof fetchPlatformModelCatalog>>][] = []
    for (const platform of platforms) {
      const snapshot = await fetchPlatformModelCatalog(platform, fetch, ref)
      entries.push([platform, snapshot])
      console.log(`${platform}: ${snapshot.models.length} models, ${snapshot.revision}`)
    }
    await writeFile(target, JSON.stringify(Object.fromEntries(entries), null, 2) + '\n')
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
