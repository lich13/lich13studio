import type { ProviderPlatform } from '../platforms'
import {
  anthropicModelPages,
  applyAnthropicEfforts,
  parseAnthropicModel,
  parseCodexCatalog,
  parseGrokCatalog
} from './parsers'
import {
  canonicalModels,
  CATALOG_PARSER_VERSION,
  catalogDigest,
  ModelCatalogError,
  type PlatformModelCatalogSnapshot,
  validateCatalog
} from './types'

const MAX_BYTES = 8 * 1024 * 1024
const CODEX_API = 'https://api.github.com/repos/openai/codex'
export const ANTHROPIC_OVERVIEW = 'https://platform.claude.com/docs/en/models/overview.md'
export const ANTHROPIC_EFFORT = 'https://platform.claude.com/docs/en/build-with-claude/effort.md'
export const GROK_CATALOG = 'https://docs.x.ai/developers/models'

export async function fetchPlatformModelCatalog(
  platform: ProviderPlatform,
  fetcher: typeof fetch = fetch,
  openaiRef?: string
): Promise<PlatformModelCatalogSnapshot> {
  const sources: PlatformModelCatalogSnapshot['sources'] = []
  const read = async (url: string, accept = 'application/json'): Promise<string> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: accept, 'User-Agent': 'lich13studio-model-catalog' }
      })
      if (!response.ok) throw new ModelCatalogError('network', `HTTP ${response.status}: ${new URL(url).hostname}`)
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES)
        throw new ModelCatalogError('invalid-data', 'Catalog response too large')
      const reader = response.body?.getReader()
      if (!reader) throw new ModelCatalogError('invalid-data', 'Empty catalog response')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let text = '',
        bytes = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          bytes += value.length
          if (bytes > MAX_BYTES) throw new ModelCatalogError('invalid-data', 'Catalog response too large')
          text += decoder.decode(value, { stream: true })
        }
        text += decoder.decode()
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      sources.push({ url, sha256: await catalogDigest(text) })
      return text
    } catch (error) {
      controller.abort()
      if (error instanceof ModelCatalogError) throw error
      throw new ModelCatalogError('network', error instanceof Error ? error.message : 'Catalog download failed')
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    let models: PlatformModelCatalogSnapshot['models'], revision: string, release: string | undefined
    if (platform === 'openai') {
      const metadata = JSON.parse(
        await read(`${CODEX_API}/releases/${openaiRef ? `tags/${encodeURIComponent(openaiRef)}` : 'latest'}`)
      )
      if (metadata.draft || metadata.prerelease || !/^rust-v\d+\.\d+\.\d+$/.test(metadata.tag_name))
        throw new ModelCatalogError('invalid-data', 'Codex release is not stable')
      release = metadata.tag_name
      const commit = JSON.parse(await read(`${CODEX_API}/commits/${encodeURIComponent(release!)}`))
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new ModelCatalogError('invalid-data', 'Invalid Codex commit')
      revision = commit.sha
      const root = `https://raw.githubusercontent.com/openai/codex/${revision}`
      let raw: string
      try {
        raw = await read(`${root}/codex-rs/models-manager/models.json`)
      } catch (error) {
        if (!(error instanceof ModelCatalogError) || !error.message.startsWith('HTTP 404:')) throw error
        raw = await read(`${root}/codex-rs/core/models.json`)
      }
      models = parseCodexCatalog(raw)
    } else if (platform === 'grok') {
      models = parseGrokCatalog(await read(GROK_CATALOG, 'text/html'))
      revision = await catalogDigest(JSON.stringify(canonicalModels(models)))
    } else {
      const overview = await read(ANTHROPIC_OVERVIEW, 'text/markdown')
      const pages = anthropicModelPages(overview)
      models = []
      // Bounded downloads; finish every batch before publishing a whole snapshot.
      for (let index = 0; index < pages.length; index += 4) {
        const batch = await Promise.allSettled(
          pages
            .slice(index, index + 4)
            .map(async (url) => parseAnthropicModel(await read(`${url}.md`, 'text/markdown')))
        )
        const failed = batch.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
        for (const result of batch) if (result.status === 'fulfilled') models.push(result.value)
      }
      models = applyAnthropicEfforts(models, await read(ANTHROPIC_EFFORT, 'text/markdown'))
      revision = await catalogDigest(JSON.stringify(canonicalModels(models)))
    }
    models = canonicalModels(models)
    const snapshot = {
      parserVersion: CATALOG_PARSER_VERSION,
      platform,
      revision,
      ...(release ? { release } : {}),
      sha256: await catalogDigest(JSON.stringify(models)),
      sources: sources.sort((a, b) => a.url.localeCompare(b.url, 'en')),
      models
    }
    validateCatalog(snapshot)
    return snapshot
  } catch (error) {
    if (error instanceof ModelCatalogError) throw error
    throw new ModelCatalogError('invalid-data', error instanceof Error ? error.message : 'Invalid model catalog')
  }
}
