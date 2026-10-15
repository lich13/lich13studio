import type { SerializedError } from '@renderer/types/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import { t } from 'i18next'

export interface DiagnosisStep {
  text: string
}

export interface DiagnosisResult {
  summary: string
  category: string
  explanation: string
  steps: DiagnosisStep[]
}

export interface DiagnosisContext {
  errorSource?: string
  providerName?: string
  modelId?: string
}

/** Use the same local rules as the error card; diagnostics never call a model. */
export function diagnoseError(
  error: SerializedError,
  language: string,
  context?: DiagnosisContext
): Promise<DiagnosisResult> {
  const classification = classifyError(error, context?.providerName)
  const summary = t(classification.i18nKey, { lng: language })
  return Promise.resolve({
    summary,
    category: classification.category,
    explanation: summary,
    steps: classification.navTarget ? [{ text: t('error.diagnosis.go_to_settings', { lng: language }) }] : []
  })
}
