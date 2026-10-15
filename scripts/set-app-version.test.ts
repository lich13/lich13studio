import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(new URL('./set-app-version.mjs', import.meta.url))
const temporaryDirectories: string[] = []
const trackedFiles = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']

const packageJson = [
  '{',
  '  "name": "lich13studio",',
  '  "version": "1.2.3",',
  '  "metadata": { "version": "7.8.9" }',
  '}',
  ''
].join('\n')

const tauriConfig = [
  '{',
  '  "version": "1.2.3",',
  '  "bundle": { "icon": ["one.png", "two.png"], "targets": ["app", "dmg"] },',
  '  "metadata": { "version": "7.8.9" }',
  '}',
  ''
].join('\r\n')

const cargoToml = [
  '[package]',
  'name = "lich13studio"',
  'version = "1.2.3"',
  '',
  '[dependencies]',
  'fixture-dependency = "7.8.9"',
  ''
].join('\r\n')

const cargoLock = [
  'version = 3',
  '',
  '[[package]]',
  'name = "fixture-dependency"',
  'version = "7.8.9"',
  '',
  '[[package]]',
  'name = "lich13studio"',
  'version = "1.2.3"',
  'dependencies = [',
  ' "fixture-dependency",',
  ']',
  ''
].join('\r\n')

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'lich13-version-script-'))
  temporaryDirectories.push(root)

  const contents = {
    'package.json': packageJson,
    'src-tauri/tauri.conf.json': tauriConfig,
    'src-tauri/Cargo.toml': cargoToml,
    'src-tauri/Cargo.lock': cargoLock
  }

  for (const [relativePath, content] of Object.entries(contents)) {
    const filePath = join(root, relativePath)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  return root
}

function readTrackedFiles(root: string) {
  return Object.fromEntries(trackedFiles.map((relativePath) => [relativePath, readFileSync(join(root, relativePath))]))
}

function runVersionScript(root: string, version: string) {
  return spawnSync(process.execPath, [scriptPath, '--version', version], {
    cwd: root,
    encoding: 'utf8'
  })
}

afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('set-app-version script', () => {
  it('keeps all file bytes unchanged across repeated runs for the current version', () => {
    const root = createFixture()
    const before = readTrackedFiles(root)

    expect(runVersionScript(root, '1.2.3').status).toBe(0)
    expect(runVersionScript(root, '1.2.3').status).toBe(0)

    const after = readTrackedFiles(root)
    for (const relativePath of trackedFiles) {
      expect(after[relativePath], relativePath).toEqual(before[relativePath])
    }
  })

  it('changes only the four target versions while preserving JSON formatting and other package versions', () => {
    const root = createFixture()

    expect(runVersionScript(root, '2.3.4').status).toBe(0)

    const after = readTrackedFiles(root)
    expect(after['package.json'].toString()).toBe(packageJson.replace('"version": "1.2.3"', '"version": "2.3.4"'))
    expect(after['src-tauri/tauri.conf.json'].toString()).toBe(
      tauriConfig.replace('"version": "1.2.3"', '"version": "2.3.4"')
    )
    expect(after['src-tauri/Cargo.toml'].toString()).toBe(cargoToml.replace('version = "1.2.3"', 'version = "2.3.4"'))
    expect(after['src-tauri/Cargo.lock'].toString()).toBe(
      cargoLock.replace('name = "lich13studio"\r\nversion = "1.2.3"', 'name = "lich13studio"\r\nversion = "2.3.4"')
    )
    expect(JSON.parse(after['package.json'].toString())).toMatchObject({
      version: '2.3.4',
      metadata: { version: '7.8.9' }
    })
    expect(JSON.parse(after['src-tauri/tauri.conf.json'].toString())).toMatchObject({
      version: '2.3.4',
      bundle: { icon: ['one.png', 'two.png'], targets: ['app', 'dmg'] },
      metadata: { version: '7.8.9' }
    })
  })

  it('rejects an invalid version without changing any file', () => {
    const root = createFixture()
    const before = readTrackedFiles(root)

    expect(runVersionScript(root, 'not-a-version').status).not.toBe(0)

    const after = readTrackedFiles(root)
    for (const relativePath of trackedFiles) {
      expect(after[relativePath], relativePath).toEqual(before[relativePath])
    }
  })
})
