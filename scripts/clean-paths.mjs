import fs from 'node:fs'
import path from 'node:path'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('Usage: node scripts/clean-paths.mjs <path> [more paths...]')
  process.exit(1)
}

for (const target of targets) {
  const resolvedPath = path.resolve(process.cwd(), target)
  fs.rmSync(resolvedPath, { force: true, recursive: true })
}
