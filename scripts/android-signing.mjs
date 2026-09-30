// Release tooling. Private material stays outside the checkout and is never printed.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const directory = process.env.LICH13_SIGNING_DIR || join(homedir(), '.config', 'lich13studio', 'android-signing')
const properties = join(directory, 'release.properties')
const keystore = join(directory, 'release.p12')
mkdirSync(directory, { recursive: true, mode: 0o700 })
if (!existsSync(properties)) {
  if (existsSync(keystore)) throw new Error('Existing signing key has no properties; refusing to replace it')
  const password = randomBytes(32).toString('hex')
  const result = spawnSync(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storetype',
      'PKCS12',
      '-storepass:env',
      'LICH13_SIGNING_PASSWORD',
      '-keypass:env',
      'LICH13_SIGNING_PASSWORD',
      '-alias',
      'lich13studio-release',
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-validity',
      '10000',
      '-dname',
      'CN=lich13studio, O=lich13'
    ],
    { env: { ...process.env, LICH13_SIGNING_PASSWORD: password }, stdio: 'pipe' }
  )
  if (result.status !== 0) throw new Error('Release signing key creation failed')
  chmodSync(keystore, 0o600)
  writeFileSync(
    properties,
    `storeFile=${keystore}\nstorePassword=${password}\nkeyAlias=lich13studio-release\nkeyPassword=${password}\n`,
    { mode: 0o600, flag: 'wx' }
  )
}
if (!existsSync(keystore)) throw new Error('Release signing key is missing; refusing to replace it')
if (process.argv.includes('--github')) {
  for (const [name, value] of [
    ['LICH13_ANDROID_KEYSTORE', readFileSync(keystore).toString('base64')],
    [
      'LICH13_ANDROID_SIGNING',
      readFileSync(properties, 'utf8').replace(/^storeFile=.*$/m, 'storeFile=/tmp/lich13studio-android-release.p12')
    ]
  ]) {
    const result = spawnSync('gh', ['secret', 'set', name, '--repo', 'lich13/lich13studio'], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    if (result.status !== 0) throw new Error(`Could not store repository secret ${name}`)
  }
  console.log('Android release signing secrets configured')
}
console.log(`LICH13_ANDROID_SIGNING_PROPERTIES=${properties}`)
