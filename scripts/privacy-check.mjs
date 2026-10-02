import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', cwd: root })
  .split('\n')
  .filter(Boolean)

const scanRoots = ['src', 'packages', 'scripts', 'docs', 'package.json', 'pnpm-lock.yaml']
const files = new Set()
for (const entry of scanRoots) {
  const path = join(root, entry)
  if (statSafe(path)?.isFile()) files.add(entry)
  else collect(path, entry, files)
}
for (const file of tracked) {
  if (/^(out|dist|build|src-tauri\/target)\//.test(file)) continue
  if (existsSync(join(root, file))) files.add(file)
}

const forbidden = [
  ['application analytics service', /AnalyticsService|Analytics_TrackTokenUsage|trackTokenUsage/],
  ['telemetry plugin injection', /createTelemetryPlugin|experimental_telemetry/],
  ['hidden marketplace reporting', /reportInstall|api\.claude-plugins\.dev/]
]
const secretPatterns = [
  /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9]{24,})/,
  /(?:^|[^A-Za-z0-9])(gh[pousr]_[A-Za-z0-9]{20,})/,
  /(?:^|[^A-Za-z0-9])(AIza[0-9A-Za-z_-]{30,})/
]
const failures = []
for (const file of files) {
  if (file === 'scripts/privacy-check.mjs') continue
  const absolute = join(root, file)
  if (!existsSync(absolute) || !statSafe(absolute)?.isFile()) continue
  const text = readFileSync(absolute, 'utf8')
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) failures.push(`${label}: ${file}`)
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(`possible secret: ${file}`)
  }
}

if (failures.length) {
  console.error('Privacy check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`Privacy check passed (${files.size} files scanned)`)

function statSafe(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function collect(path, relative, target) {
  const info = statSafe(path)
  if (!info) return
  if (info.isFile()) {
    target.add(relative)
    return
  }
  if (!info.isDirectory() || /(?:^|\/)node_modules(?:\/|$)|(?:^|\/)\.git(?:\/|$)/.test(relative)) return
  for (const child of readdirSync(path)) collect(join(path, child), join(relative, child), target)
}
