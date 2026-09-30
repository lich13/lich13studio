type DisplayModel = { id: string; name?: string }

// A presentation key only. Never use it as a provider request ID.
const displayKey = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_.\-‐‑–—]+/gu, '-')

export function getModelPresentation(model: DisplayModel) {
  const primary = model.name?.trim() || model.id
  const secondary = displayKey(primary) === displayKey(model.id) ? undefined : model.id
  return {
    primary,
    secondary,
    label: secondary ? `${primary} · ${secondary}` : primary,
    searchText: `${primary} ${model.id}`,
    id: model.id
  }
}
