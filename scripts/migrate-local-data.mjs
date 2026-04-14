#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)

const SYSTEM_PROVIDER_IDS = new Set(['openai', 'anthropic', 'gemini'])
const SETTINGS_ALLOWLIST = new Set([
  'showAssistants',
  'showTopics',
  'language',
  'theme',
  'proxyMode',
  'showMessageDivider',
  'messageFont',
  'showInputEstimatedTokens',
  'windowStyle',
  'fontSize',
  'topicPosition',
  'showTopicTime',
  'assistantIconType',
  'pasteLongTextAsFile',
  'pasteLongTextThreshold',
  'clickAssistantToShowTopic',
  'renderInputMessageAsMarkdown',
  'codeShowLineNumbers',
  'codeCollapsible',
  'codeWrappable',
  'mathEngine',
  'messageStyle',
  'foldDisplayMode',
  'gridColumns',
  'gridPopoverTrigger',
  'messageNavigation',
  'skipBackupFile',
  'webdavHost',
  'webdavUser',
  'webdavPass',
  'webdavPath',
  'webdavAutoSync',
  'webdavSyncInterval',
  'webdavMaxBackups',
  'webdavSkipBackupFile',
  'webdavDisableStream',
  'localBackupDir',
  'localBackupAutoSync',
  'localBackupSyncInterval',
  'localBackupMaxBackups',
  'localBackupSkipBackupFile',
  's3'
])

function loadPlaywright() {
  const candidates = ['playwright', '/tmp/webkit-bridge/node_modules/playwright']
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {}
  }
  throw new Error(
    'Playwright module not found. Install it with "npm install playwright" or restore /tmp/webkit-bridge/node_modules/playwright.'
  )
}

const { chromium, webkit } = loadPlaywright()

function parseArgs(argv) {
  const args = {
    oldRoot: path.join(os.homedir(), 'Documents', 'cherry'),
    appSupport: path.join(os.homedir(), 'Library', 'Application Support', 'lich13studio'),
    webkitRoot: path.join(os.homedir(), 'Library', 'WebKit', 'com.lich13.studio'),
    reportPath: path.resolve(process.cwd(), 'out', 'local-data-migration-report.md'),
    backupRoot: path.join(os.homedir(), 'Library', 'Application Support', 'lich13studio-migration-backups')
  }

  for (const raw of argv) {
    if (!raw.startsWith('--')) continue
    const [key, ...rest] = raw.slice(2).split('=')
    const value = rest.join('=')
    if (!value) continue
    switch (key) {
      case 'old-root':
        args.oldRoot = value
        break
      case 'app-support':
        args.appSupport = value
        break
      case 'webkit-root':
        args.webkitRoot = value
        break
      case 'report-path':
        args.reportPath = value
        break
      case 'backup-root':
        args.backupRoot = value
        break
    }
  }

  return args
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`)
  }
}

function toIsoStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T')
}

function walkFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue
    const stat = fs.statSync(current)
    if (stat.isFile()) {
      files.push(current)
      continue
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      stack.push(path.join(current, entry.name))
    }
  }
  return files
}

function uniqBy(items, keyFn) {
  const result = []
  const seen = new Set()
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function parsePersistSlice(state, key) {
  return state[key] ? JSON.parse(state[key]) : {}
}

function stringifyPersistSlice(value) {
  return JSON.stringify(value)
}

function pickObjectKeys(source, allowlist) {
  const result = {}
  for (const key of allowlist) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  return result
}

function coerceNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function tryGetChromeExecutable() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function ensureAppClosed() {
  const result = spawnSync('pgrep', ['-x', 'lich13studio'], { encoding: 'utf8' })
  if (result.status === 0 && result.stdout.trim()) {
    throw new Error('lich13studio is still running. Close the app before migration to avoid corrupting local data.')
  }
}

function detectCurrentStorage(webkitRoot) {
  const files = walkFiles(webkitRoot).filter((file) => path.basename(file) === 'localstorage.sqlite3')
  for (const file of files) {
    if (fs.statSync(file).size === 0) continue
    try {
      const db = new DatabaseSync(file, { readOnly: true })
      const row = db.prepare('select value from ItemTable where key = ?').get('persist:cherry-studio')
      db.close()
      if (!row?.value) continue
      const originDir = path.dirname(path.dirname(file))
      const indexedDbDir = path.join(originDir, 'IndexedDB')
      return { localStoragePath: file, originDir, indexedDbDir }
    } catch {}
  }
  throw new Error(`Could not find current localstorage.sqlite3 with persist:cherry-studio under ${webkitRoot}`)
}

function readCurrentPersist(localStoragePath) {
  const db = new DatabaseSync(localStoragePath)
  const rows = db.prepare('select key, value from ItemTable').all()
  const keyMap = new Map(rows.map((row) => [row.key, Buffer.from(row.value)]))
  db.close()
  const persistBuffer = keyMap.get('persist:cherry-studio')
  if (!persistBuffer) {
    throw new Error(`persist:cherry-studio missing from ${localStoragePath}`)
  }
  return {
    itemMap: keyMap,
    persistState: JSON.parse(persistBuffer.toString('utf16le'))
  }
}

function writeCurrentPersist(localStoragePath, itemMap, nextPersistState) {
  const db = new DatabaseSync(localStoragePath)
  const encoded = Buffer.from(JSON.stringify(nextPersistState), 'utf16le')
  db.prepare('update ItemTable set value = ? where key = ?').run(encoded, 'persist:cherry-studio')
  for (const [key, value] of itemMap.entries()) {
    if (key === 'persist:cherry-studio') continue
    db.prepare('update ItemTable set value = ? where key = ?').run(value, key)
  }
  db.close()
}

async function exportOldData(oldRoot) {
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lich13studio-old-chrome-'))
  const defaultDir = path.join(tempProfile, 'Default')
  fs.mkdirSync(defaultDir, { recursive: true })

  for (const name of ['IndexedDB', 'Local Storage']) {
    const source = path.join(oldRoot, name)
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(defaultDir, name), { recursive: true })
    }
  }

  const probeFile = path.join(tempProfile, 'probe.html')
  fs.writeFileSync(probeFile, '<!doctype html><title>migrate</title><h1>migrate</h1>\n', 'utf8')

  const chromeExecutable = tryGetChromeExecutable()
  const browser = await chromium.launchPersistentContext(tempProfile, {
    executablePath: chromeExecutable,
    headless: true,
    args: ['--allow-file-access-from-files', '--disable-web-security', '--no-first-run', '--no-default-browser-check']
  })

  try {
    const page = browser.pages()[0] || (await browser.newPage())
    await page.goto(`file://${probeFile}`)
    return await page.evaluate(async () => {
      const output = {
        persist: localStorage.getItem('persist:cherry-studio'),
        stores: {}
      }

      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('CherryStudio')
        request.onerror = () => reject(String(request.error))
        request.onupgradeneeded = () => reject('IndexedDB unexpectedly requested upgrade.')
        request.onsuccess = () => resolve(request.result)
      })

      for (const storeName of Array.from(db.objectStoreNames)) {
        const tx = db.transaction([storeName], 'readonly')
        const store = tx.objectStore(storeName)
        output.stores[storeName] = await new Promise((resolve, reject) => {
          const request = store.getAll()
          request.onerror = () => reject(String(request.error))
          request.onsuccess = () => resolve(request.result)
        })
      }

      return output
    })
  } finally {
    await browser.close()
    fs.rmSync(tempProfile, { recursive: true, force: true })
  }
}

function buildFallbackModel(providers, preferredModels) {
  for (const model of preferredModels) {
    if (model?.provider && providers.some((provider) => provider.id === model.provider)) return model
  }

  for (const provider of providers) {
    if (provider.models?.length) {
      return provider.models[0]
    }
  }

  return null
}

function normalizeModel(model, providers, fallbackModel) {
  if (model?.provider && providers.some((provider) => provider.id === model.provider)) return model
  return fallbackModel
}

function normalizeAssistantModels(assistant, providers, fallbackModel) {
  const normalized = { ...assistant }
  if (assistant.model) {
    normalized.model = normalizeModel(assistant.model, providers, fallbackModel)
  }
  if (assistant.defaultModel) {
    normalized.defaultModel = normalizeModel(assistant.defaultModel, providers, fallbackModel)
  }
  normalized.topics = (assistant.topics || []).map((topic) => ({
    ...topic,
    assistantId: topic.assistantId || assistant.id,
    messages: []
  }))
  return normalized
}

function mergePersistState(currentState, oldState, appSupport) {
  const currentAssistants = parsePersistSlice(currentState, 'assistants')
  const currentLlm = parsePersistSlice(currentState, 'llm')
  const currentSettings = parsePersistSlice(currentState, 'settings')
  const currentBackup = parsePersistSlice(currentState, 'backup')
  const currentMcp = parsePersistSlice(currentState, 'mcp')
  const currentWebsearch = parsePersistSlice(currentState, 'websearch')
  const currentNote = parsePersistSlice(currentState, 'note')

  const oldAssistants = parsePersistSlice(oldState, 'assistants')
  const oldLlm = parsePersistSlice(oldState, 'llm')
  const oldSettings = parsePersistSlice(oldState, 'settings')
  const oldBackup = parsePersistSlice(oldState, 'backup')
  const oldMcp = parsePersistSlice(oldState, 'mcp')
  const oldWebsearch = parsePersistSlice(oldState, 'websearch')
  const oldNote = parsePersistSlice(oldState, 'note')

  const oldProviderMap = new Map((oldLlm.providers || []).map((provider) => [provider.id, provider]))
  const currentSystemProviders = (currentLlm.providers || [])
    .filter((provider) => SYSTEM_PROVIDER_IDS.has(provider.id))
    .map((provider) => {
      const oldProvider = oldProviderMap.get(provider.id)
      return oldProvider
        ? {
            ...provider,
            ...oldProvider,
            id: provider.id,
            isSystem: true,
            models: provider.models
          }
        : provider
    })

  const currentCustomProviders = (currentLlm.providers || []).filter(
    (provider) => !SYSTEM_PROVIDER_IDS.has(provider.id)
  )
  const oldCustomProviders = (oldLlm.providers || []).filter(
    (provider) => !provider.isSystem && !SYSTEM_PROVIDER_IDS.has(provider.id)
  )

  const mergedCustomProviders = uniqBy([...oldCustomProviders, ...currentCustomProviders], (provider) => provider.id)
  const mergedProviders = [...mergedCustomProviders, ...currentSystemProviders]
  const fallbackModel = buildFallbackModel(mergedProviders, [
    oldLlm.defaultModel,
    currentLlm.defaultModel,
    oldLlm.quickModel,
    currentLlm.quickModel
  ])

  const mergedAssistants = {
    ...currentAssistants,
    ...oldAssistants,
    assistants: (oldAssistants.assistants || []).map((assistant) =>
      normalizeAssistantModels(assistant, mergedProviders, fallbackModel)
    ),
    defaultAssistant: normalizeAssistantModels(
      oldAssistants.defaultAssistant || currentAssistants.defaultAssistant,
      mergedProviders,
      fallbackModel
    )
  }

  const mergedLlm = {
    ...currentLlm,
    providers: mergedProviders,
    defaultModel: normalizeModel(oldLlm.defaultModel || currentLlm.defaultModel, mergedProviders, fallbackModel),
    topicNamingModel: normalizeModel(
      oldLlm.topicNamingModel || currentLlm.topicNamingModel,
      mergedProviders,
      fallbackModel
    ),
    quickModel: normalizeModel(oldLlm.quickModel || currentLlm.quickModel, mergedProviders, fallbackModel),
    translateModel: normalizeModel(currentLlm.translateModel, mergedProviders, fallbackModel)
  }

  const mergedSettings = {
    ...currentSettings,
    ...pickObjectKeys(oldSettings, SETTINGS_ALLOWLIST)
  }

  if (currentSettings.s3 || oldSettings.s3) {
    mergedSettings.s3 = {
      ...(currentSettings.s3 || {}),
      ...(oldSettings.s3 || {})
    }
    mergedSettings.s3.syncInterval = coerceNumber(mergedSettings.s3.syncInterval, currentSettings.s3?.syncInterval || 0)
    mergedSettings.s3.maxBackups = coerceNumber(mergedSettings.s3.maxBackups, currentSettings.s3?.maxBackups || 0)
  }

  mergedSettings.webdavSyncInterval = coerceNumber(
    mergedSettings.webdavSyncInterval,
    currentSettings.webdavSyncInterval || 0
  )
  mergedSettings.webdavMaxBackups = coerceNumber(mergedSettings.webdavMaxBackups, currentSettings.webdavMaxBackups || 0)
  mergedSettings.localBackupSyncInterval = coerceNumber(
    mergedSettings.localBackupSyncInterval,
    currentSettings.localBackupSyncInterval || 0
  )
  mergedSettings.localBackupMaxBackups = coerceNumber(
    mergedSettings.localBackupMaxBackups,
    currentSettings.localBackupMaxBackups || 0
  )

  const mergedWebsearch = {
    ...currentWebsearch,
    searchWithTime: oldWebsearch.searchWithTime ?? currentWebsearch.searchWithTime,
    maxResults: oldWebsearch.maxResults ?? currentWebsearch.maxResults,
    excludeDomains: oldWebsearch.excludeDomains ?? currentWebsearch.excludeDomains,
    overwrite: oldWebsearch.overwrite ?? currentWebsearch.overwrite,
    compressionConfig: oldWebsearch.compressionConfig ?? currentWebsearch.compressionConfig,
    defaultProvider: 'local-google',
    providers: currentWebsearch.providers || []
  }

  const mergedNote = {
    ...currentNote,
    ...oldNote,
    settings: {
      ...(currentNote.settings || {}),
      ...(oldNote.settings || {})
    },
    notesPath: path.join(appSupport, 'Data', 'Notes')
  }

  const mergedMcp = {
    ...currentMcp,
    servers: uniqBy([...(oldMcp.servers || []), ...(currentMcp.servers || [])], (server) => server.id)
  }

  const mergedBackup = {
    ...currentBackup,
    ...oldBackup
  }

  const nextState = { ...currentState }
  nextState.assistants = stringifyPersistSlice(mergedAssistants)
  nextState.llm = stringifyPersistSlice(mergedLlm)
  nextState.settings = stringifyPersistSlice(mergedSettings)
  nextState.backup = stringifyPersistSlice(mergedBackup)
  nextState.mcp = stringifyPersistSlice(mergedMcp)
  nextState.websearch = stringifyPersistSlice(mergedWebsearch)
  nextState.note = stringifyPersistSlice(mergedNote)

  return {
    nextState,
    mergedSlices: {
      assistants: mergedAssistants,
      llm: mergedLlm,
      settings: mergedSettings,
      backup: mergedBackup,
      mcp: mergedMcp,
      websearch: mergedWebsearch,
      note: mergedNote
    }
  }
}

function normalizeIndexedDbStores(oldData, mergedProviders, appSupport) {
  const mergedProviderIds = new Set(mergedProviders.map((provider) => provider.id))
  const targetFilesDir = path.join(appSupport, 'Data', 'Files')

  const files = (oldData.stores.files || []).map((file) => ({
    ...file,
    path: path.join(targetFilesDir, file.name || path.basename(String(file.path || '').replace(/\\/g, '/')))
  }))

  const topics = cloneJson(oldData.stores.topics || [])
  const messageBlocks = cloneJson(oldData.stores.message_blocks || [])
  const quickPhrases = cloneJson(oldData.stores.quick_phrases || [])
  const settings = (oldData.stores.settings || []).filter((item) => {
    if (!item.id?.startsWith('image://provider-')) return false
    const providerId = item.id.slice('image://provider-'.length)
    return mergedProviderIds.has(providerId)
  })

  return {
    files,
    topics,
    settings,
    knowledge_notes: [],
    translate_history: [],
    translate_languages: [],
    quick_phrases: quickPhrases,
    message_blocks: messageBlocks
  }
}

function createWebKitPayloadPageHtml() {
  return '<!doctype html><title>lich13studio migrate</title><h1>lich13studio migrate</h1>\n'
}

function createWebKitServer(payloadPath) {
  const server = http.createServer((req, res) => {
    if (!req.url || req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(createWebKitPayloadPageHtml())
      return
    }
    if (req.url === '/payload.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(fs.readFileSync(payloadPath))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  return server
}

async function buildWebKitIndexedDb(stores) {
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lich13studio-webkit-'))
  const payloadPath = path.join(tempProfile, 'payload.json')
  fs.writeFileSync(payloadPath, JSON.stringify(stores))

  const server = createWebKitServer(payloadPath)
  await new Promise((resolve) => server.listen(8123, '127.0.0.1', resolve))

  try {
    const browser = await webkit.launchPersistentContext(tempProfile, { headless: true })
    try {
      const page = browser.pages()[0] || (await browser.newPage())
      await page.goto('http://127.0.0.1:8123/')
      const counts = await page.evaluate(async () => {
        const payload = await fetch('/payload.json').then((response) => response.json())

        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('CherryStudio', 10)
          request.onerror = () => reject(String(request.error))
          request.onupgradeneeded = () => {
            const db = request.result

            const files = db.createObjectStore('files', { keyPath: 'id' })
            files.createIndex('name', 'name')
            files.createIndex('origin_name', 'origin_name')
            files.createIndex('path', 'path')
            files.createIndex('size', 'size')
            files.createIndex('ext', 'ext')
            files.createIndex('type', 'type')
            files.createIndex('created_at', 'created_at')
            files.createIndex('count', 'count')

            db.createObjectStore('topics', { keyPath: 'id' })

            const settings = db.createObjectStore('settings', { keyPath: 'id' })
            settings.createIndex('value', 'value')

            const knowledgeNotes = db.createObjectStore('knowledge_notes', { keyPath: 'id' })
            knowledgeNotes.createIndex('baseId', 'baseId')
            knowledgeNotes.createIndex('type', 'type')
            knowledgeNotes.createIndex('content', 'content')
            knowledgeNotes.createIndex('created_at', 'created_at')
            knowledgeNotes.createIndex('updated_at', 'updated_at')

            const translateHistory = db.createObjectStore('translate_history', { keyPath: 'id' })
            translateHistory.createIndex('sourceText', 'sourceText')
            translateHistory.createIndex('targetText', 'targetText')
            translateHistory.createIndex('sourceLanguage', 'sourceLanguage')
            translateHistory.createIndex('targetLanguage', 'targetLanguage')
            translateHistory.createIndex('createdAt', 'createdAt')

            const translateLanguages = db.createObjectStore('translate_languages', { keyPath: 'id' })
            translateLanguages.createIndex('langCode', 'langCode')

            db.createObjectStore('quick_phrases', { keyPath: 'id' })

            const messageBlocks = db.createObjectStore('message_blocks', { keyPath: 'id' })
            messageBlocks.createIndex('messageId', 'messageId')
            messageBlocks.createIndex('file.id', 'file.id')
          }
          request.onsuccess = () => resolve(request.result)
        })

        const storeNames = Object.keys(payload)
        for (const storeName of storeNames) {
          const rows = payload[storeName] || []
          await new Promise((resolve, reject) => {
            const tx = database.transaction([storeName], 'readwrite')
            const store = tx.objectStore(storeName)
            for (const row of rows) {
              store.put(row)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(String(tx.error))
            tx.onabort = () => reject(String(tx.error || 'transaction aborted'))
          })
        }

        const counts = {}
        for (const storeName of storeNames) {
          counts[storeName] = await new Promise((resolve, reject) => {
            const tx = database.transaction([storeName], 'readonly')
            const request = tx.objectStore(storeName).count()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(String(request.error))
          })
        }

        return counts
      })
      return { counts, profilePath: tempProfile }
    } finally {
      await browser.close()
    }
  } finally {
    server.close()
  }
}

function locateGeneratedIndexedDb(profilePath) {
  const indexedDbRoot = path.join(profilePath, 'IndexedDB', 'v1')
  const candidates = walkFiles(indexedDbRoot).filter((file) => path.basename(file) === 'IndexedDB.sqlite3')
  if (candidates.length === 0) {
    throw new Error(`Generated IndexedDB.sqlite3 not found under ${indexedDbRoot}`)
  }
  return path.dirname(path.dirname(candidates[0]))
}

function copyDirectoryIfExists(source, target) {
  if (!fs.existsSync(source)) return false
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, preserveTimestamps: true })
  return true
}

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true })
}

function copyChildren(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return 0
  ensureDirectory(targetDir)
  let copied = 0
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name)
    const target = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true, force: true, preserveTimestamps: true })
    } else {
      fs.copyFileSync(source, target)
    }
    copied += 1
  }
  return copied
}

function summarizeState(state) {
  const assistants = parsePersistSlice(state, 'assistants')
  const llm = parsePersistSlice(state, 'llm')
  const mcp = parsePersistSlice(state, 'mcp')
  return {
    assistants: assistants.assistants?.length || 0,
    topics: (assistants.assistants || []).reduce((sum, assistant) => sum + (assistant.topics?.length || 0), 0),
    providers: llm.providers?.length || 0,
    defaultModel: llm.defaultModel?.id || null,
    mcpServers: mcp.servers?.length || 0
  }
}

function renderReport(report) {
  const lines = [
    '# Local Data Migration Report',
    '',
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Backup root: ${report.backupPath}`,
    `- Old root: ${report.oldRoot}`,
    `- Target app support: ${report.appSupport}`,
    `- Target WebKit root: ${report.webkitRoot}`,
    '',
    '## Migrated State',
    '',
    `- Assistants: ${report.after.assistants}`,
    `- Topics: ${report.after.topics}`,
    `- Providers: ${report.after.providers}`,
    `- Default model: ${report.after.defaultModel}`,
    `- MCP servers: ${report.after.mcpServers}`,
    '',
    '## Migrated IndexedDB Stores',
    '',
    `- Files: ${report.indexedDbCounts.files}`,
    `- Topics: ${report.indexedDbCounts.topics}`,
    `- Message blocks: ${report.indexedDbCounts.message_blocks}`,
    `- Quick phrases: ${report.indexedDbCounts.quick_phrases}`,
    `- Provider image settings: ${report.indexedDbCounts.settings}`,
    '',
    '## Copied Local Data',
    '',
    `- Data/Files children copied: ${report.copiedFiles}`,
    `- Data/Notes children copied: ${report.copiedNotes}`,
    '',
    '## Touched Paths',
    '',
    `- LocalStorage: ${report.localStoragePath}`,
    `- IndexedDB dir: ${report.indexedDbPath}`,
    `- Files dir: ${report.filesDir}`,
    `- Notes dir: ${report.notesDir}`,
    ''
  ]
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureAppClosed()
  ensureExists(args.oldRoot, 'Old Cherry data root')
  ensureExists(path.join(args.oldRoot, 'Local Storage'), 'Old Local Storage')
  ensureExists(path.join(args.oldRoot, 'IndexedDB'), 'Old IndexedDB')

  const { localStoragePath, indexedDbDir } = detectCurrentStorage(args.webkitRoot)
  const startedAt = new Date().toISOString()
  const backupPath = path.join(args.backupRoot, toIsoStamp(new Date()))

  ensureDirectory(backupPath)
  copyDirectoryIfExists(args.appSupport, path.join(backupPath, 'app-support'))
  copyDirectoryIfExists(args.webkitRoot, path.join(backupPath, 'webkit'))

  const oldData = await exportOldData(args.oldRoot)
  const { itemMap, persistState: currentPersistState } = readCurrentPersist(localStoragePath)
  const oldPersistState = JSON.parse(oldData.persist)

  const { nextState, mergedSlices } = mergePersistState(currentPersistState, oldPersistState, args.appSupport)
  writeCurrentPersist(localStoragePath, itemMap, nextState)

  ensureDirectory(path.join(args.appSupport, 'Data', 'Files'))
  ensureDirectory(path.join(args.appSupport, 'Data', 'Notes'))

  const copiedFiles = copyChildren(
    path.join(args.oldRoot, 'Data', 'Files'),
    path.join(args.appSupport, 'Data', 'Files')
  )
  const copiedNotes = copyChildren(
    path.join(args.oldRoot, 'Data', 'Notes'),
    path.join(args.appSupport, 'Data', 'Notes')
  )

  const normalizedStores = normalizeIndexedDbStores(oldData, mergedSlices.llm.providers || [], args.appSupport)
  const { counts: indexedDbCounts, profilePath: generatedProfile } = await buildWebKitIndexedDb(normalizedStores)
  const generatedIndexedDbDir = locateGeneratedIndexedDb(generatedProfile)
  fs.rmSync(indexedDbDir, { recursive: true, force: true })
  fs.mkdirSync(indexedDbDir, { recursive: true })
  for (const entry of fs.readdirSync(generatedIndexedDbDir, { withFileTypes: true })) {
    fs.cpSync(path.join(generatedIndexedDbDir, entry.name), path.join(indexedDbDir, entry.name), {
      recursive: true,
      force: true,
      preserveTimestamps: true
    })
  }
  fs.rmSync(generatedProfile, { recursive: true, force: true })

  const { persistState: verifiedState } = readCurrentPersist(localStoragePath)
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    backupPath,
    oldRoot: args.oldRoot,
    appSupport: args.appSupport,
    webkitRoot: args.webkitRoot,
    localStoragePath,
    indexedDbPath: indexedDbDir,
    filesDir: path.join(args.appSupport, 'Data', 'Files'),
    notesDir: path.join(args.appSupport, 'Data', 'Notes'),
    copiedFiles,
    copiedNotes,
    before: summarizeState(currentPersistState),
    after: summarizeState(verifiedState),
    indexedDbCounts
  }

  ensureDirectory(path.dirname(args.reportPath))
  fs.writeFileSync(args.reportPath, renderReport(report), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
