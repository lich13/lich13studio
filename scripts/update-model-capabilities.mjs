// Release-time import only. No provider credentials or runtime model-list requests.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const revision = '5846b0e6b71adfd46baf094259823e1519e3afd6'
const root = new URL('../', import.meta.url)
const base = `https://raw.githubusercontent.com/CherryHQ/cherry-studio/${revision}/`
const allowed = new Set([
  'image-recognition',
  'image-generation',
  'file-input',
  'reasoning',
  'function-call',
  'embedding',
  'rerank'
])
const registryPath = 'packages/provider-registry/data/models.json'
async function get(path) {
  const response = await fetch(base + path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const source = await get(registryPath)
const registry = JSON.parse(source)
const models = registry.models
  .filter((model) => model.capabilities.length || model.inputModalities?.length || model.outputModalities?.length)
  .map((model) => ({
    id: model.id,
    input: model.inputModalities ?? [],
    output: model.outputModalities ?? [],
    capabilities: model.capabilities.filter((capability) => allowed.has(capability)).sort()
  }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const files = new Map([
  [
    'src/renderer/src/config/models/registry/cherry-capabilities.json',
    Buffer.from(
      JSON.stringify(
        {
          source: `https://github.com/CherryHQ/cherry-studio/blob/${revision}/${registryPath}`,
          revision,
          sourceSha256: createHash('sha256').update(source).digest('hex'),
          models
        },
        null,
        2
      ) + '\n'
    )
  ],
  ['src/renderer/src/config/models/registry/CHERRY-STUDIO-LICENSE.txt', await get('LICENSE')],
  [
    'src/renderer/src/assets/images/models/cherry/openai-light.svg',
    await get('packages/ui/icons/models/light/openai.svg')
  ],
  [
    'src/renderer/src/assets/images/models/cherry/openai-dark.svg',
    await get('packages/ui/icons/models/dark/openai.svg')
  ]
])
for (const [path, bytes] of files) {
  const data = path.endsWith('.json')
    ? execFileSync(
        process.execPath,
        [fileURLToPath(new URL('node_modules/@biomejs/biome/bin/biome', root)), 'format', '--stdin-file-path', path],
        { input: bytes, cwd: root }
      )
    : bytes
  const target = new URL(path, root)
  if (process.argv.includes('--check')) {
    if (!data.equals(await readFile(target))) throw new Error(`Snapshot differs: ${path}`)
  } else {
    await mkdir(new URL('.', target), { recursive: true })
    await writeFile(target, data)
  }
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Updated'} ${fileURLToPath(target)}`)
}
import { execFileSync } from 'node:child_process'
