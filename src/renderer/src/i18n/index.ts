import 'dayjs/locale/zh-cn'

import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import dayjs from 'dayjs'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCN from './locales/zh-cn.json'

const logger = loggerService.withContext('I18N')

const resources = {
  'zh-CN': { translation: zhCN }
}

const localeLoaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  'en-US': () => import('./locales/en-us.json'),
  'zh-TW': () => import('./locales/zh-tw.json'),
  'de-DE': () => import('./translate/de-de.json'),
  'el-GR': () => import('./translate/el-gr.json'),
  'es-ES': () => import('./translate/es-es.json'),
  'fr-FR': () => import('./translate/fr-fr.json'),
  'ja-JP': () => import('./translate/ja-jp.json'),
  'pt-PT': () => import('./translate/pt-pt.json'),
  'ro-RO': () => import('./translate/ro-ro.json'),
  'ru-RU': () => import('./translate/ru-ru.json')
}

export const getLanguage = () => defaultLanguage

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

const dayjsLocaleMap: Record<string, string> = {
  'en-US': 'en',
  'ja-JP': 'ja',
  'ru-RU': 'ru',
  'zh-CN': 'zh-cn',
  'zh-TW': 'zh-tw',
  'de-DE': 'de',
  'el-GR': 'el',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'pt-PT': 'pt',
  'ro-RO': 'ro'
}

export const setDayjsLocale = (language: string) => {
  const dayjsLocale = dayjsLocaleMap[language] || 'zh-cn'
  dayjs.locale(dayjsLocale)
}

export async function ensureLocaleLoaded(language: string): Promise<void> {
  if (language === 'zh-CN' || i18n.hasResourceBundle(language, 'translation')) {
    return
  }
  const loader = localeLoaders[language]
  if (!loader) {
    return
  }
  const mod = await loader()
  i18n.addResourceBundle(language, 'translation', mod.default, true, true)
}

dayjs.locale('zh-cn')

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: defaultLanguage,
  interpolation: {
    escapeValue: false
  },
  saveMissing: true,
  missingKeyHandler: (_1, _2, key) => {
    logger.error(`Missing key: ${key}`)
  }
})

export default i18n
