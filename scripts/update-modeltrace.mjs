// Import a reviewed, immutable upstream revision. Runtime updates never execute downloaded code.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const revision = '94afa3bbecd10fc4a3796c6ef3cc9156015e6dfa'
const repository = 'Hanmo123/ModelTrace'
const branch = 'hanmo'
const root = new URL('../src/renderer/src/services/modelTrace/', import.meta.url)
const paths = {
  bank: 'data/unified_bank.json',
  core: 'static/fingerprint-core.js',
  challenge: 'static/challenge-browser.js'
}
const sources = Object.fromEntries(
  await Promise.all(
    [...Object.entries(paths), ['license', 'LICENSE']].map(async ([key, path]) => {
      const response = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`)
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
      return [key, Buffer.from(await response.arrayBuffer())]
    })
  )
)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const manifest = {
  repository,
  branch,
  revision,
  analyzerVersion: 1,
  files: Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [
      key,
      { path, sha256: sha256(sources[key]), gitBlob: gitBlob(sources[key]) }
    ])
  )
}
const files = new Map([
  ['data/unified_bank.json', sources.bank],
  ['data/upstream-fingerprint-core.mjs', sources.core],
  ['data/upstream-challenge.mjs', sources.challenge],
  ['data/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ['MODELTRACE-LICENSE.txt', sources.license]
])
for (const [path, bytes] of files) {
  const target = new URL(path, root)
  if (process.argv.includes('--check')) {
    if (!bytes.equals(await readFile(target))) throw new Error(`Snapshot differs: ${path}`)
  } else {
    await mkdir(new URL('.', target), { recursive: true })
    await writeFile(target, bytes)
  }
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Updated'} ${path}`)
}
