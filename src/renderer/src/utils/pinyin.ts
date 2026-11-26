import type * as TinyPinyinModule from 'tiny-pinyin'

type LoadedTinyPinyin = typeof TinyPinyinModule

let loadedPinyin: LoadedTinyPinyin | null = null
let loadingPromise: Promise<LoadedTinyPinyin> | null = null

export function loadTinyPinyin(): Promise<LoadedTinyPinyin> {
  if (loadedPinyin) return Promise.resolve(loadedPinyin)
  loadingPromise ??= import('tiny-pinyin').then((mod) => {
    loadedPinyin = mod
    return mod
  })
  return loadingPromise
}

export function getLoadedTinyPinyin(): LoadedTinyPinyin | null {
  return loadedPinyin
}
