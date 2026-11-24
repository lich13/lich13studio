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

export const getLanguage = () => defaultLanguage

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

export const setDayjsLocale = () => {
  dayjs.locale('zh-cn')
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
