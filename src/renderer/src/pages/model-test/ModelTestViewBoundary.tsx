import { loggerService } from '@logger'
import { Alert, Button } from 'antd'
import { type ReactNode, useEffect, useRef } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ModelTestViewBoundary')

function RecoveryView({
  resetErrorBoundary,
  recoveries
}: Pick<FallbackProps, 'resetErrorBoundary'> & { recoveries: { current: number } }) {
  const { t } = useTranslation()
  useEffect(() => {
    if (recoveries.current > 0) return
    // Recover outside the failing React commit. The session outlives this view.
    const timer = setTimeout(() => {
      recoveries.current += 1
      resetErrorBoundary()
    }, 0)
    return () => clearTimeout(timer)
  }, [recoveries, resetErrorBoundary])
  return (
    <Alert
      style={{ margin: 20 }}
      type="warning"
      showIcon
      message={t('settings.modelTest.viewError')}
      action={<Button onClick={() => resetErrorBoundary()}>{t('settings.modelTest.restoreView')}</Button>}
    />
  )
}

export default function ModelTestViewBoundary({ children }: { children: ReactNode }) {
  const recoveries = useRef(0)
  return (
    <ErrorBoundary
      onError={() => logger.warn('Model test view failed; background session retained')}
      fallbackRender={(props) => <RecoveryView {...props} recoveries={recoveries} />}>
      {children}
    </ErrorBoundary>
  )
}
