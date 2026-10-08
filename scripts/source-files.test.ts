import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listSourceFiles } from './source-files.mjs'

const temporaryDirectories: string[] = []

function createTemporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'lich13-source-files-'))
  temporaryDirectories.push(root)
  return root
}

function writeFixtureFile(root: string, relative: string, content = 'fixture') {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function git(root: string, ...args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('listSourceFiles', () => {
  it('uses the Git index by default and includes only non-ignored untracked files when requested', () => {
    const root = createTemporaryDirectory()
    writeFixtureFile(root, '.gitignore', 'ignored.txt\n')
    writeFixtureFile(root, 'tracked.txt')
    git(root, 'init', '-q')
    git(root, 'add', '--', 'tracked.txt')
    writeFixtureFile(root, 'untracked.txt')
    writeFixtureFile(root, 'ignored.txt')

    expect(listSourceFiles(root)).toEqual(['tracked.txt'])
    expect(listSourceFiles(root, { includeUntracked: true })).toEqual(['.gitignore', 'tracked.txt', 'untracked.txt'])
  })

  it('propagates Git enumeration errors instead of silently walking a broken checkout', () => {
    const root = createTemporaryDirectory()
    writeFileSync(join(root, '.git'), 'invalid git directory marker')
    writeFixtureFile(root, 'visible-without-git.txt')

    expect(() => listSourceFiles(root)).toThrow()
  })

  it('enumerates mirror root and skill whitelist files without Git while skipping caches and directory links', () => {
    const root = createTemporaryDirectory()
    const external = createTemporaryDirectory()
    writeFixtureFile(root, 'package.json')
    writeFixtureFile(root, '.agents/skills/public-skills.txt')
    writeFixtureFile(root, '.agents/skills/.gitignore')
    writeFixtureFile(root, '.claude/skills/.gitignore')
    writeFixtureFile(root, 'scripts/check.mjs')
    writeFixtureFile(root, 'src/feature.ts')
    writeFixtureFile(external, 'outside-source.ts')

    for (const cacheFile of [
      'node_modules/pkg/index.js',
      '.cache/generated.js',
      '.gradle/generated.js',
      '.yarn/cache/generated.js',
      'coverage/report.json',
      'out/generated.js',
      'dist/generated.js',
      'build/generated.js',
      'src-tauri/target/debug/generated.js'
    ]) {
      writeFixtureFile(root, cacheFile)
    }
    writeFixtureFile(root, '.eslintcache')
    symlinkSync(external, join(root, 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir')

    const files = listSourceFiles(root)
    expect(files).toEqual(
      expect.arrayContaining([
        'package.json',
        '.agents/skills/public-skills.txt',
        '.agents/skills/.gitignore',
        '.claude/skills/.gitignore',
        'scripts/check.mjs',
        'src/feature.ts'
      ])
    )
    for (const cacheFile of [
      'node_modules/pkg/index.js',
      '.cache/generated.js',
      '.gradle/generated.js',
      '.yarn/cache/generated.js',
      'coverage/report.json',
      'out/generated.js',
      'dist/generated.js',
      'build/generated.js',
      'src-tauri/target/debug/generated.js',
      '.eslintcache',
      'linked-source/outside-source.ts'
    ]) {
      expect(files).not.toContain(cacheFile)
    }

    expect(listSourceFiles(root, { roots: ['.agents/skills', '.claude/skills'] })).toEqual(
      expect.arrayContaining(['.agents/skills/public-skills.txt', '.claude/skills/.gitignore'])
    )
  })
})
