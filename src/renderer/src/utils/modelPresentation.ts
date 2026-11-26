type DisplayModel = { id: string; name?: string }

export interface ModelPresentation {
  primary: string
  secondary: string | undefined
  label: string
  searchText: string
  id: string
}

const MAX_MODEL_PRESENTATION_CACHE = 512
const modelPresentationCache = new Map<string, ModelPresentation>()

// A presentation key only. Never use it as a provider request ID.
const displayKey = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_.\-‐‑–—]+/gu, '-')

export function getModelPresentation(model: DisplayModel): ModelPresentation {
  const cacheKey = `${model.id}\u0000${model.name ?? ''}`
  const cached = modelPresentationCache.get(cacheKey)
  if (cached) {
    modelPresentationCache.delete(cacheKey)
    modelPresentationCache.set(cacheKey, cached)
    return cached
  }

  const primary = model.name?.trim() || model.id
  const secondary = displayKey(primary) === displayKey(model.id) ? undefined : model.id
  const presentation: ModelPresentation = {
    primary,
    secondary,
    label: secondary ? `${primary} · ${secondary}` : primary,
    searchText: `${primary} ${model.id}`,
    id: model.id
  }

  if (modelPresentationCache.size >= MAX_MODEL_PRESENTATION_CACHE) {
    const oldestKey = modelPresentationCache.keys().next().value
    if (oldestKey !== undefined) {
      modelPresentationCache.delete(oldestKey)
    }
  }
  modelPresentationCache.set(cacheKey, presentation)
  return presentation
}
