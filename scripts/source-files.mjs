import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Git checkouts use the index; execution mirrors enumerate the source files
 * they actually received. Never follow directory symlinks out of the source.
 * @param {string} root
 * @param {{ roots?: string[], includeUntracked?: boolean }} options
 * @returns {string[]}
 */
export function listSourceFiles(root, { roots = [], includeUntracked = false } = {}) {
  if (existsSync(join(root, '.git'))) {
    return execFileSync(
      'git',
      ['ls-files', '-z', ...(includeUntracked ? ['-co', '--exclude-standard'] : []), '--', ...roots],
      { encoding: 'utf8', cwd: root }
    )
      .split('\0')
      .filter(Boolean)
      .sort()
  }

  const files = []
  const ignoredDirectories = new Set(['.git', 'node_modules', '.cache', '.gradle', '.yarn', 'coverage'])
  const walk = (relative) => {
    if (!existsSync(join(root, relative))) return
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (/^(?:out|dist|build|src-tauri\/target)(?:\/|$)/.test(name) || entry.name === '.eslintcache') continue
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(name)
      } else files.push(name)
    }
  }
  for (const relative of roots.length ? roots : ['']) walk(relative)
  return files.sort()
}
