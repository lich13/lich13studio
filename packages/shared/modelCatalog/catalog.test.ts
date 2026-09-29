import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  anthropicModelPages,
  applyAnthropicEfforts,
  parseAnthropicModel,
  parseCodexCatalog,
  parseGrokCatalog
} from './parsers'
import { ANTHROPIC_EFFORT, ANTHROPIC_OVERVIEW, fetchPlatformModelCatalog, GROK_CATALOG } from './sources'
import { CATALOG_PARSER_VERSION, type OfficialModel, type PlatformModelCatalogSnapshot, validateCatalog } from './types'

const CODEX_API = 'https://api.github.com/repos/openai/codex'
const RELEASE = 'rust-v0.100.0'
const COMMIT = '12ab'.repeat(10)
const RAW_ROOT = `https://raw.githubusercontent.com/openai/codex/${COMMIT}`
const CODEX_MODELS = `${RAW_ROOT}/codex-rs/models-manager/models.json`
const OLD_CODEX_MODELS = `${RAW_ROOT}/codex-rs/core/models.json`
const CLAUDE_ROOT = 'https://platform.claude.com/docs/en/models'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

type FixtureResponse = string | { body: string; status?: number; headers?: Record<string, string> }

function fixtureFetch(routes: Record<string, FixtureResponse>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    expect(init?.credentials).toBe('omit')
    const headers = new Headers(init?.headers)
    for (const header of ['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cookie']) {
      expect(headers.has(header), `${url} must not send ${header}`).toBe(false)
    }
    expect(new URL(url).username).toBe('')
    expect(new URL(url).password).toBe('')
    expect(init?.body).toBeUndefined()
    if (!Object.hasOwn(routes, url)) throw new Error(`Unexpected fixture URL: ${url}`)
    const response = routes[url]
    return typeof response === 'string'
      ? new Response(response)
      : new Response(response.body, { status: response.status, headers: response.headers })
  })
}

const requestedUrls = (fetcher: ReturnType<typeof fixtureFetch>) => fetcher.mock.calls.map(([url]) => String(url))

function codexModel(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'gpt-fixture-chat',
    display_name: 'Fixture Chat',
    visibility: 'list',
    supported_in_api: true,
    input_modalities: ['text', 'image'],
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }],
    supports_parallel_tool_calls: true,
    ...overrides
  }
}

const codexJson = (models = [codexModel()]) => JSON.stringify({ models })

function codexRoutes(raw = codexJson()): Record<string, FixtureResponse> {
  return {
    [`${CODEX_API}/releases/latest`]: JSON.stringify({ tag_name: RELEASE, draft: false, prerelease: false }),
    [`${CODEX_API}/commits/${RELEASE}`]: JSON.stringify({ sha: COMMIT }),
    [CODEX_MODELS]: raw
  }
}

function grokModel(overrides: Record<string, unknown> = {}) {
  return {
    name: 'grok-4.6',
    aliases: ['grok-fixture-latest'],
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    features: { reasoning: false, functionCalling: true },
    ...overrides
  }
}

function grokHtml(...regions: ReturnType<typeof grokModel>[][]) {
  return `<html><script>globalThis.__XAI_PUBLIC_MODELS__ = ${JSON.stringify({
    clusterConfigs: regions.map((languageModels, index) => ({ region: `fixture-${index}`, languageModels }))
  })};</script></html>`
}

function claudeOverview(current = ['opus-4-8'], legacy = ['haiku-4-5']) {
  const link = (slug: string) => `[${slug}](${CLAUDE_ROOT}/${slug}/overview)`
  return `# Models overview
| Feature | Current model |
| --- | --- |
| Model page | ${current.map(link).join(' | ')} |
Legacy models (still available): ${legacy.map(link).join(', ')}

## Other documentation
${link('unrelated-link')}
[External model](https://example.invalid/models/external/overview)
`
}

interface ClaudeFixture {
  name?: string
  id?: string
  alias?: string
  status?: string
  modality?: string
  thinking?: string
  extraCapabilities?: string
}

function claudeMarkdown({
  name = 'Claude Opus 4.8',
  id = 'claude-opus-4-8',
  alias = 'claude-opus-fixture-latest',
  status = 'Active',
  modality = 'Text and images → text',
  thinking = 'Adaptive thinking',
  extraCapabilities = ''
}: ClaudeFixture = {}) {
  return `# ${name}

## Model IDs
| Platform | Model ID |
| --- | --- |
| Amazon Bedrock | \`anthropic.${id}-v1:0\` |
| Vertex AI | \`${id}@20260101\` |
| Claude API | \`${id}\` |
| Claude API alias | \`${alias}\` |

## Availability
| Property | Value |
| --- | --- |
| Status | ${status} |

### Capabilities
| Property | Value |
| --- | --- |
| Input → output | ${modality} |
| Thinking | ${thinking} |
${extraCapabilities}
`
}

const EFFORT_MARKDOWN = `# Effort
## Effort levels
| Effort | Description |
| --- | --- |
| low | Lowest effort |
| medium | Balanced effort |
| high | High effort |
| xhigh | Available for Claude Sonnet 5.0 and Claude Opus 4.7 |
| max | Available for Claude Opus 4.8 and Claude Opus 4.7 |
`

function claudeRoutes(): Record<string, FixtureResponse> {
  return {
    [ANTHROPIC_OVERVIEW]: claudeOverview(),
    [`${CLAUDE_ROOT}/opus-4-8/overview.md`]: claudeMarkdown(),
    [`${CLAUDE_ROOT}/haiku-4-5/overview.md`]: claudeMarkdown({
      name: 'Claude Haiku 4.5',
      id: 'claude-haiku-4-5-20251001',
      alias: 'claude-haiku-4-5',
      thinking: 'Extended thinking'
    }),
    [ANTHROPIC_EFFORT]: EFFORT_MARKDOWN
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Codex stable release source', () => {
  it('resolves a stable release to a commit and downloads only the immutable catalog URL', async () => {
    const routes = codexRoutes()
    const fetcher = fixtureFetch(routes)
    const snapshot = await fetchPlatformModelCatalog('openai', fetcher)

    expect(requestedUrls(fetcher)).toEqual([
      `${CODEX_API}/releases/latest`,
      `${CODEX_API}/commits/${RELEASE}`,
      CODEX_MODELS
    ])
    expect(snapshot).toMatchObject({
      parserVersion: CATALOG_PARSER_VERSION,
      platform: 'openai',
      release: RELEASE,
      revision: COMMIT
    })
    expect(snapshot.models.map((model) => model.id)).toEqual(['gpt-fixture-chat'])
    expect(snapshot.sha256).toBe(sha256(JSON.stringify(snapshot.models)))
    expect(snapshot.sources).toHaveLength(3)
    for (const source of snapshot.sources) expect(source.sha256).toBe(sha256(routes[source.url] as string))
  })

  it('resolves an explicitly selected release through release metadata before its commit', async () => {
    const routes = codexRoutes()
    routes[`${CODEX_API}/releases/tags/${RELEASE}`] = routes[`${CODEX_API}/releases/latest`]
    delete routes[`${CODEX_API}/releases/latest`]
    const fetcher = fixtureFetch(routes)

    await expect(fetchPlatformModelCatalog('openai', fetcher, RELEASE)).resolves.toMatchObject({
      release: RELEASE,
      revision: COMMIT
    })
    expect(requestedUrls(fetcher)[0]).toBe(`${CODEX_API}/releases/tags/${RELEASE}`)
    expect(requestedUrls(fetcher).at(-1)).toBe(CODEX_MODELS)
  })

  it.each([
    { tag_name: RELEASE, draft: true, prerelease: false },
    { tag_name: RELEASE, draft: false, prerelease: true },
    { tag_name: 'rust-v0.100.0-alpha.1', draft: false, prerelease: false },
    { tag_name: 'main', draft: false, prerelease: false },
    {}
  ])('rejects non-stable or malformed release metadata: %j', async (metadata) => {
    const fetcher = fixtureFetch({ [`${CODEX_API}/releases/latest`]: JSON.stringify(metadata) })
    await expect(fetchPlatformModelCatalog('openai', fetcher)).rejects.toMatchObject({ code: 'invalid-data' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['main', '1234567', '', 'x'.repeat(40)])('rejects an invalid commit SHA: %s', async (sha) => {
    const routes = codexRoutes()
    routes[`${CODEX_API}/commits/${RELEASE}`] = JSON.stringify({ sha })
    const fetcher = fixtureFetch(routes)
    await expect(fetchPlatformModelCatalog('openai', fetcher)).rejects.toMatchObject({ code: 'invalid-data' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses the legacy path only after a 404 and retains the same immutable commit', async () => {
    const routes = codexRoutes()
    routes[CODEX_MODELS] = { body: 'Not found', status: 404 }
    routes[OLD_CODEX_MODELS] = codexJson()
    const fetcher = fixtureFetch(routes)
    const snapshot = await fetchPlatformModelCatalog('openai', fetcher)

    expect(requestedUrls(fetcher).slice(-2)).toEqual([CODEX_MODELS, OLD_CODEX_MODELS])
    expect(snapshot.revision).toBe(COMMIT)
    expect(snapshot.sources.map((source) => source.url)).toContain(OLD_CODEX_MODELS)
    expect(snapshot.sources.map((source) => source.url)).not.toContain(CODEX_MODELS)
  })

  it('does not hide a source failure behind the legacy path', async () => {
    const routes = codexRoutes()
    routes[CODEX_MODELS] = { body: 'Unavailable', status: 503 }
    const fetcher = fixtureFetch(routes)
    await expect(fetchPlatformModelCatalog('openai', fetcher)).rejects.toMatchObject({ code: 'network' })
    expect(requestedUrls(fetcher)).not.toContain(OLD_CODEX_MODELS)
  })
})

describe('Codex chat capabilities', () => {
  it('includes only visible, API-supported models accepting text', () => {
    const models = parseCodexCatalog(
      codexJson([
        codexModel(),
        codexModel({ slug: 'hidden-chat', visibility: 'hide' }),
        codexModel({ slug: 'not-in-api', supported_in_api: false }),
        codexModel({ slug: 'string-api-flag', supported_in_api: 'true' }),
        codexModel({ slug: 'image-only', input_modalities: ['image'] }),
        codexModel({ slug: 'no-input', input_modalities: [] })
      ])
    )

    expect(models.map((model) => model.id)).toEqual(['gpt-fixture-chat'])
    expect(models[0]).toMatchObject({
      name: 'Fixture Chat',
      input: ['text', 'image'],
      output: ['text'],
      capabilities: { text: true, vision: true, reasoning: true, function_calling: true },
      efforts: ['low', 'medium', 'high', 'xhigh']
    })
  })

  it('keeps explicit absence of reasoning and vision instead of inferring from a model name', () => {
    const [model] = parseCodexCatalog(
      codexJson([codexModel({ slug: 'gpt-6', input_modalities: ['text'], supported_reasoning_levels: [] })])
    )
    expect(model.capabilities).toMatchObject({ text: true, vision: false, reasoning: false })
    expect(model.efforts).toEqual([])
  })

  it.each(['', '{broken', '{}', '{"models":[]}', codexJson([codexModel({ visibility: 'hide' })])])(
    'rejects empty, broken or fully filtered catalogs: %s',
    async (raw) => {
      await expect(fetchPlatformModelCatalog('openai', fixtureFetch(codexRoutes(raw)))).rejects.toMatchObject({
        code: 'invalid-data'
      })
    }
  )
})

describe('xAI public embedded data', () => {
  it('leaves undeclared capabilities available for fallback and rejects invalid declarations', () => {
    const [model] = parseGrokCatalog(grokHtml([grokModel({ features: {} })]))
    expect(model.capabilities.reasoning).toBeUndefined()
    expect(model.capabilities.function_calling).toBeUndefined()
    expect(() => parseGrokCatalog(grokHtml([grokModel({ features: { reasoning: 'false' } })]))).toThrow(
      'Invalid xAI capability'
    )
  })
  it('decodes JSON strings safely without executing surrounding JavaScript', () => {
    const executionProbe = vi.fn()
    vi.stubGlobal('__catalogExecutionProbe', executionProbe)
    const fixture = grokHtml([grokModel({ aliases: ['escaped-quote-"-brace-}-bracket-]'] })]).replace(
      '</script>',
      'globalThis.__catalogExecutionProbe();</script>'
    )

    const [model] = parseGrokCatalog(fixture)
    expect(model.aliases).toEqual(['escaped-quote-"-brace-}-bracket-]'])
    expect(executionProbe).not.toHaveBeenCalled()
  })

  it.each([
    '<html>No public assignment</html>',
    'globalThis.__XAI_PUBLIC_MODELS__ = {"clusterConfigs":',
    'globalThis.__XAI_PUBLIC_MODELS__ = (() => { globalThis.__catalogExecutionProbe(); return {}; })();',
    'globalThis.__XAI_PUBLIC_MODELS__ = {"clusterConfigs": globalThis.__catalogExecutionProbe()};'
  ])('rejects missing, truncated or executable assignments without evaluating them', (fixture) => {
    const executionProbe = vi.fn()
    vi.stubGlobal('__catalogExecutionProbe', executionProbe)
    expect(() => parseGrokCatalog(fixture)).toThrow()
    expect(executionProbe).not.toHaveBeenCalled()
  })

  it('deduplicates regions and merges aliases when capabilities agree', () => {
    const models = parseGrokCatalog(
      grokHtml(
        [grokModel({ aliases: ['grok-common', 'grok-us'] })],
        [grokModel({ aliases: ['grok-eu', 'grok-common'], inputModalities: ['IMAGE', 'TEXT'] })]
      )
    )

    expect(models).toHaveLength(1)
    expect(models[0].aliases).toEqual(['grok-common', 'grok-eu', 'grok-us'])
    expect(models[0].capabilities).toMatchObject({ text: true, vision: true, reasoning: false, function_calling: true })
  })

  it.each([
    { inputModalities: ['TEXT'] },
    { features: { reasoning: true, functionCalling: true } },
    { features: { reasoning: false, functionCalling: false } }
  ])('fails the whole catalog when regional specifications conflict: %j', async (overrides) => {
    const fetcher = fixtureFetch({ [GROK_CATALOG]: grokHtml([grokModel()], [grokModel(overrides)]) })
    await expect(fetchPlatformModelCatalog('grok', fetcher)).rejects.toMatchObject({ code: 'invalid-data' })
  })

  it('filters preview variants and models without text input or output', () => {
    const models = parseGrokCatalog(
      grokHtml([
        grokModel(),
        grokModel({ name: 'grok-preview' }),
        grokModel({ name: 'grok-beta' }),
        grokModel({ name: 'grok-experimental' }),
        grokModel({ name: 'grok-image', outputModalities: ['IMAGE'] }),
        grokModel({ name: 'grok-audio', inputModalities: ['AUDIO'] }),
        grokModel({ name: 'grok-embedding', outputModalities: ['EMBEDDING'] })
      ])
    )
    expect(models.map((model) => model.id)).toEqual(['grok-4.6'])
  })

  it('reads reasoning effort options while preserving explicit reasoning false', () => {
    const models = parseGrokCatalog(
      grokHtml([
        grokModel(),
        grokModel({
          name: 'grok-fixture-reasoner',
          aliases: [],
          features: {
            reasoning: true,
            functionCalling: true,
            reasoningEffortOptions: { supportedEfforts: ['high', 'low', 'medium'] }
          }
        })
      ])
    )
    expect(models.find((model) => model.id === 'grok-4.6')?.capabilities.reasoning).toBe(false)
    expect(models.find((model) => model.id === 'grok-fixture-reasoner')?.efforts).toEqual(['low', 'medium', 'high'])
  })

  it.each([
    grokHtml([]),
    grokHtml([grokModel({ name: 'grok-preview' })]),
    grokHtml([grokModel({ inputModalities: null })]),
    grokHtml([grokModel({ features: null })]),
    'globalThis.__XAI_PUBLIC_MODELS__ = {"clusterConfigs":[{"languageModels":null}]};'
  ])('rejects empty or damaged model data', async (html) => {
    await expect(fetchPlatformModelCatalog('grok', fixtureFetch({ [GROK_CATALOG]: html }))).rejects.toMatchObject({
      code: 'invalid-data'
    })
  })

  it('rejects aliases that identify different models across regions', async () => {
    const html = grokHtml(
      [grokModel({ aliases: ['grok-shared'] })],
      [grokModel({ name: 'grok-another', aliases: ['grok-shared'] })]
    )
    await expect(fetchPlatformModelCatalog('grok', fixtureFetch({ [GROK_CATALOG]: html }))).rejects.toMatchObject({
      code: 'invalid-data'
    })
  })
})

describe('Claude official documentation', () => {
  it('takes model pages only from the comparison row and explicit available legacy list', () => {
    const pages = anthropicModelPages(claudeOverview(['opus-4-8', 'opus-4-8'], ['haiku-4-5', 'opus-4-8']))
    expect(pages).toEqual([`${CLAUDE_ROOT}/opus-4-8/overview`, `${CLAUDE_ROOT}/haiku-4-5/overview`])
  })

  it('uses Claude API IDs and aliases while ignoring Bedrock and Vertex identifiers', () => {
    expect(parseAnthropicModel(claudeMarkdown())).toMatchObject({
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      aliases: ['claude-opus-fixture-latest'],
      input: ['text', 'image'],
      output: ['text'],
      capabilities: { text: true, vision: true, reasoning: true, function_calling: true },
      thinking: 'adaptive'
    })
  })

  it('does not fall back to a cloud-provider ID when the Claude API row is absent', () => {
    const markdown = claudeMarkdown().replace(/^\| Claude API \|.*\n/m, '')
    expect(() => parseAnthropicModel(markdown)).toThrow('Claude API model ID is missing')
  })

  it.each([
    ['Extended thinking', 'budget', true],
    ['Not supported', undefined, false],
    ['None', undefined, false]
  ])('reads thinking mode %s and text-only modality from the specification', (thinking, mode, reasoning) => {
    const model = parseAnthropicModel(claudeMarkdown({ modality: 'Text → text', thinking: String(thinking) }))
    expect(model.thinking).toBe(mode)
    expect(model.capabilities).toMatchObject({ text: true, vision: false, reasoning })
  })

  it('takes max and xhigh support from documented model names without using family prefixes', () => {
    const input = [
      parseAnthropicModel(claudeMarkdown()),
      parseAnthropicModel(claudeMarkdown({ name: 'Claude Sonnet 5.0', id: 'claude-sonnet-5-0' })),
      parseAnthropicModel(claudeMarkdown({ name: 'Claude Opus 5.1', id: 'claude-opus-5-1' })),
      parseAnthropicModel(claudeMarkdown({ name: 'Claude Haiku 4.5', id: 'claude-haiku-4-5', thinking: 'None' }))
    ]
    const output = applyAnthropicEfforts(input, EFFORT_MARKDOWN)

    expect(output[0].efforts).toEqual(['low', 'medium', 'high', 'max'])
    expect(output[1].efforts).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(output[2].efforts).toEqual(['low', 'medium', 'high'])
    expect(output[3].efforts).toBeUndefined()
  })

  it.each(['high', '`high`'])('reads an explicit Extended model default effort: %s', (value) => {
    const model = parseAnthropicModel(
      claudeMarkdown({
        name: 'Claude Opus 4.5',
        id: 'claude-opus-4-5-20251101',
        thinking: 'Extended thinking',
        extraCapabilities: `| [Default effort](https://platform.claude.com/docs/en/build-with-claude/effort) | ${value} |`
      })
    )
    expect(model.thinking).toBe('budget')
    expect(applyAnthropicEfforts([model], EFFORT_MARKDOWN)[0].efforts).toEqual(['low', 'medium', 'high'])
  })

  it.each(['Not supported', '—'])('does not infer effort support from an unsupported default: %s', (value) => {
    const model = parseAnthropicModel(
      claudeMarkdown({
        name: 'Claude Sonnet 4.5',
        id: 'claude-sonnet-4-5-20250929',
        thinking: 'Extended thinking',
        extraCapabilities: `| [Default effort](https://platform.claude.com/docs/en/build-with-claude/effort) | ${value} |`
      })
    )
    expect(applyAnthropicEfforts([model], EFFORT_MARKDOWN)[0].efforts).toBeUndefined()
  })

  it('fetches the complete current and legacy set before returning a verified snapshot', async () => {
    const fetcher = fixtureFetch(claudeRoutes())
    const snapshot = await fetchPlatformModelCatalog('anthropic', fetcher)

    expect(new Set(requestedUrls(fetcher))).toEqual(
      new Set([
        ANTHROPIC_OVERVIEW,
        `${CLAUDE_ROOT}/opus-4-8/overview.md`,
        `${CLAUDE_ROOT}/haiku-4-5/overview.md`,
        ANTHROPIC_EFFORT
      ])
    )
    expect(snapshot.models.map((model) => model.id)).toEqual(['claude-haiku-4-5-20251001', 'claude-opus-4-8'])
    expect(snapshot.models.find((model) => model.id === 'claude-opus-4-8')?.efforts).toEqual([
      'low',
      'medium',
      'high',
      'max'
    ])
    expect(snapshot.sha256).toBe(sha256(JSON.stringify(snapshot.models)))
  })

  it.each([
    { status: 'Retired' },
    { modality: 'Text → image' },
    { thinking: 'Unknown mode' },
    { id: 'anthropic.claude-opus-4-8-v1:0' }
  ])('rejects an inactive or damaged individual model page: %j', (options) => {
    expect(() => parseAnthropicModel(claudeMarkdown(options))).toThrow()
  })

  it('fails instead of returning a partial set when a legacy model page cannot be loaded', async () => {
    const routes = claudeRoutes()
    routes[`${CLAUDE_ROOT}/haiku-4-5/overview.md`] = { body: 'Unavailable', status: 503 }
    const fetcher = fixtureFetch(routes)
    await expect(fetchPlatformModelCatalog('anthropic', fetcher)).rejects.toMatchObject({ code: 'network' })
    expect(requestedUrls(fetcher)).not.toContain(ANTHROPIC_EFFORT)
  })

  it.each([
    ['', 'overview'],
    [claudeOverview().replace(/^\| Model page.*\n/m, ''), 'overview'],
    [claudeOverview().replace(/^Legacy models.*\n/m, ''), 'overview'],
    ['', 'model'],
    [EFFORT_MARKDOWN.replace(/^\| max.*\n/m, ''), 'effort']
  ])(
    'rejects missing required documentation instead of publishing incomplete capabilities',
    async (markdown, source) => {
      const routes = claudeRoutes()
      const url =
        source === 'overview'
          ? ANTHROPIC_OVERVIEW
          : source === 'effort'
            ? ANTHROPIC_EFFORT
            : `${CLAUDE_ROOT}/opus-4-8/overview.md`
      routes[url] = markdown
      await expect(fetchPlatformModelCatalog('anthropic', fixtureFetch(routes))).rejects.toMatchObject({
        code: 'invalid-data'
      })
    }
  )

  it('rejects conflicting aliases between distinct Claude models', async () => {
    const routes = claudeRoutes()
    routes[`${CLAUDE_ROOT}/haiku-4-5/overview.md`] = claudeMarkdown({
      name: 'Claude Haiku 4.5',
      id: 'claude-haiku-4-5'
    })
    await expect(fetchPlatformModelCatalog('anthropic', fixtureFetch(routes))).rejects.toMatchObject({
      code: 'invalid-data'
    })
  })
})

describe('catalog boundary validation', () => {
  function snapshot(models: OfficialModel[] = [parseAnthropicModel(claudeMarkdown())]): PlatformModelCatalogSnapshot {
    return {
      parserVersion: CATALOG_PARSER_VERSION,
      platform: 'anthropic',
      revision: 'fixture-revision',
      sha256: 'a'.repeat(64),
      sources: [{ url: ANTHROPIC_OVERVIEW, sha256: 'b'.repeat(64) }],
      models
    }
  }

  it('rejects duplicate IDs and normalized alias collisions', () => {
    const model = parseAnthropicModel(claudeMarkdown())
    expect(() => validateCatalog(snapshot([model, model]))).toThrow()
    expect(() =>
      validateCatalog(
        snapshot([
          { ...model, aliases: ['vendor/claude-shared-4.8'] },
          { ...model, id: 'claude-different', aliases: ['claude-shared-4-8'] }
        ])
      )
    ).toThrow()
  })

  it.each([
    { models: [] },
    { sources: [] },
    { parserVersion: 999 },
    { sha256: 'broken' },
    { sources: [{ url: 'http://example.invalid/catalog', sha256: 'b'.repeat(64) }] }
  ])('rejects incomplete or incompatible snapshots: %j', (invalid) => {
    expect(() => validateCatalog({ ...snapshot(), ...invalid })).toThrow()
  })
})
