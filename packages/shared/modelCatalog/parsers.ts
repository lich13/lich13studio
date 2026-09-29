import { REASONING_EFFORTS, type ReasoningEffort } from '../reasoning'
import { canonicalModels, ModelCatalogError, type OfficialModel } from './types'

const invalid = (message: string): never => {
  throw new ModelCatalogError('invalid-data', message)
}
const chatCapabilities = { text: true, embedding: false, rerank: false, imageGeneration: false }
const efforts = (values: unknown[]): ReasoningEffort[] => REASONING_EFFORTS.filter((effort) => values.includes(effort))

export function parseCodexCatalog(raw: string): OfficialModel[] {
  const value = JSON.parse(raw)
  if (!Array.isArray(value.models)) return invalid('Codex model list is missing')
  return value.models
    .filter(
      (model) =>
        model.visibility === 'list' &&
        model.supported_in_api === true &&
        (!Array.isArray(model.input_modalities) || model.input_modalities.includes('text'))
    )
    .map((model) => {
      if (
        typeof model.slug !== 'string' ||
        !Array.isArray(model.input_modalities) ||
        !Array.isArray(model.supported_reasoning_levels)
      )
        return invalid('Codex model schema changed')
      const levels = efforts(model.supported_reasoning_levels.map((level) => level.effort))
      return {
        id: model.slug,
        name: model.display_name || model.slug,
        aliases: [],
        input: model.input_modalities,
        output: ['text'],
        capabilities: {
          ...chatCapabilities,
          vision: model.input_modalities.includes('image'),
          reasoning: levels.length > 0,
          ...(model.supports_parallel_tool_calls === true || model.apply_patch_tool_type
            ? { function_calling: true }
            : {})
        },
        efforts: levels
      }
    })
}

/** Decode exactly one JSON value from the public assignment. Never evaluate JavaScript. */
export function parseGrokCatalog(html: string): OfficialModel[] {
  const marker = /globalThis\.__XAI_PUBLIC_MODELS__\s*=\s*/.exec(html)
  if (!marker) return invalid('xAI public model data is missing')
  const start = marker.index + marker[0].length
  let quoted = false,
    escaped = false,
    depth = 0,
    end = -1
  if (html[start] !== '{') return invalid('Invalid xAI model data')
  for (let i = start; i < html.length; i++) {
    const char = html[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth++
    else if ((char === '}' || char === ']') && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end < 0) return invalid('Incomplete xAI model data')
  const value = JSON.parse(html.slice(start, end))
  if (!Array.isArray(value.clusterConfigs)) return invalid('xAI model schema changed')
  const models = new Map<string, OfficialModel>()
  for (const cluster of value.clusterConfigs) {
    if (cluster.languageModels !== undefined && !Array.isArray(cluster.languageModels))
      return invalid('Invalid xAI language models')
    for (const model of cluster.languageModels ?? []) {
      if (!Array.isArray(model.inputModalities) || !Array.isArray(model.outputModalities) || !model.features)
        return invalid('Incomplete xAI model capabilities')
      for (const field of ['reasoning', 'functionCalling'])
        if (model.features[field] !== undefined && typeof model.features[field] !== 'boolean')
          return invalid(`Invalid xAI capability: ${field}`)
      if (!model.outputModalities.includes('TEXT') || !model.inputModalities.includes('TEXT')) continue
      if (/beta|experimental|preview/i.test(model.name)) continue
      const entry: OfficialModel = {
        id: model.name,
        name: model.name,
        aliases: model.aliases ?? [],
        input: model.inputModalities.map((mode: string) => mode.toLowerCase()),
        output: model.outputModalities.map((mode: string) => mode.toLowerCase()),
        capabilities: {
          ...chatCapabilities,
          vision: model.inputModalities.includes('IMAGE'),
          ...(typeof model.features.reasoning === 'boolean' ? { reasoning: model.features.reasoning } : {}),
          ...(typeof model.features.functionCalling === 'boolean'
            ? { function_calling: model.features.functionCalling }
            : {})
        },
        ...(model.features.reasoningEffortOptions
          ? { efforts: efforts(model.features.reasoningEffortOptions.supportedEfforts) }
          : {})
      }
      const old = models.get(entry.id)
      if (old) {
        if (
          JSON.stringify(canonicalModels([{ ...old, aliases: [] }])) !==
          JSON.stringify(canonicalModels([{ ...entry, aliases: [] }]))
        )
          return invalid(`Conflicting xAI regions: ${entry.id}`)
        old.aliases = [...new Set([...old.aliases, ...entry.aliases])]
      } else models.set(entry.id, entry)
    }
  }
  return canonicalModels([...models.values()])
}

const plain = (cell: string) =>
  cell
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim()
function rows(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().slice(1, -1).split('|').map(plain))
}
function section(markdown: string, title: string): string {
  const heading = new RegExp(`^#{2,3} ${title}\\s*$`, 'm').exec(markdown)
  if (!heading) return invalid(`Claude ${title} section is missing`)
  const rest = markdown.slice(heading.index + heading[0].length)
  return rest.split(/\n#{1,3} /, 1)[0]
}

/** Only the comparison's model-page row and explicit still-available legacy list are authoritative. */
export function anthropicModelPages(markdown: string): string[] {
  const comparison = markdown.split(/\r?\n/).find((line) => /^\|\s*Model page\s*\|/.test(line))
  const legacy = markdown.split(/\r?\n/).find((line) => /^Legacy models \(still available\):/.test(line))
  if (!comparison || !legacy) return invalid('Claude model overview schema changed')
  const links = [
    ...`${comparison}\n${legacy}`.matchAll(/https:\/\/platform\.claude\.com\/docs\/en\/models\/([a-z0-9-]+)\/overview/g)
  ].map((match) => match[0])
  if (!links.length || links.length > 64) return invalid('Invalid Claude model pages')
  return [...new Set(links)]
}

export function parseAnthropicModel(markdown: string): OfficialModel {
  const ids = rows(section(markdown, 'Model IDs'))
  const id = ids.find((row) => row[0] === 'Claude API')?.[1]
  if (!id || !/^claude-[a-z0-9-]+$/.test(id)) return invalid('Claude API model ID is missing')
  const availability = rows(section(markdown, 'Availability'))
  if (!/^Active\b/.test(availability.find((row) => row[0] === 'Status')?.[1] ?? ''))
    return invalid(`Claude model is no longer active: ${id}`)
  const caps = rows(section(markdown, 'Capabilities'))
  const modality = caps.find((row) => row[0] === 'Input → output')?.[1]
  const defaultEffort = caps.find((row) => row[0] === 'Default effort')?.[1]
  const thinking = caps.find((row) => row[0] === 'Thinking')?.[1]
  if (
    !modality ||
    !/^Text(?: and images)? → text$/.test(modality) ||
    !thinking ||
    !/^(Adaptive|Extended|Not supported|None)/.test(thinking)
  )
    return invalid(`Claude capability schema changed: ${id}`)
  const name = markdown.match(/^# (.+)$/m)?.[1] ?? id
  return {
    id,
    name,
    aliases: ids.filter((row) => row[0] === 'Claude API alias').map((row) => row[1]),
    input: modality.includes('images') ? ['text', 'image'] : ['text'],
    output: ['text'],
    capabilities: {
      ...chatCapabilities,
      vision: modality.includes('images'),
      reasoning: /^(Adaptive|Extended)/.test(thinking),
      function_calling: true
    },
    ...(REASONING_EFFORTS.includes(defaultEffort as ReasoningEffort)
      ? { efforts: ['low', 'medium', 'high'] as ReasoningEffort[] }
      : {}),
    ...(/^(Adaptive|Extended)/.test(thinking)
      ? { thinking: thinking.startsWith('Adaptive') ? ('adaptive' as const) : ('budget' as const) }
      : {})
  }
}

/** Effort docs enumerate the models for max/xhigh; absence is not inferred from a name prefix. */
export function applyAnthropicEfforts(models: OfficialModel[], markdown: string): OfficialModel[] {
  const table = rows(section(markdown, 'Effort levels'))
  const levels = new Map(
    table.filter((row) => REASONING_EFFORTS.includes(row[0] as ReasoningEffort)).map((row) => [row[0], row[1]])
  )
  if (levels.size !== 5) return invalid('Claude effort table changed')
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const named = (text: string, name: string) =>
    [...text.matchAll(/Claude (?:Fable|Mythos|Opus|Sonnet|Haiku) (?:Preview|\d+(?:\.\d+)?)/g)].some(
      (match) => key(match[0]) === key(name)
    )
  return models.map((model) => {
    if (model.thinking === 'adaptive')
      return {
        ...model,
        efforts: REASONING_EFFORTS.filter(
          (level) => !['max', 'xhigh'].includes(level) || named(levels.get(level)!, model.name)
        )
      }
    // Earlier budget models expose effort only when their specification explicitly lists a default.
    return model
  })
}
