import { loggerService } from '@logger'
import AppLogo from '@renderer/assets/images/logo.png'
import { useAppStore } from '@renderer/store'
import { Button, Divider } from 'antd'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { OnboardingStep } from '../OnboardingPage'
import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

interface WelcomePageProps {
  setStep: (step: OnboardingStep) => void
  setProviderConfigured: (configured: boolean) => void
}

const WelcomePage: FC<WelcomePageProps> = ({ setStep, setProviderConfigured }) => {
  const { t } = useTranslation()
  const store = useAppStore()

  const handleConfigureProviders = useCallback(async () => {
    try {
      await ProviderPopup.show()
      const hasAvailableProvider = store.getState().llm.providers.some((provider) => provider.enabled && provider.models.length > 0)
      if (hasAvailableProvider) {
        setProviderConfigured(true)
        window.toast.success(t('onboarding.toast.connected'))
        setStep('select-model')
      }
    } catch (error) {
      logger.error('Provider onboarding failed:', error as Error)
    }
  }, [setProviderConfigured, setStep, store, t])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <img src={AppLogo} alt="lich13studio" className="h-16 w-16 rounded-xl" />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">{t('onboarding.welcome.title')}</h1>
          <p className="m-0 text-(--color-text-2) text-sm">{t('onboarding.welcome.subtitle')}</p>
        </div>

        <div className="mt-2 flex w-100 flex-col gap-3">
          <Button type="primary" size="large" block className="h-12 rounded-lg" onClick={handleConfigureProviders}>
            {t('onboarding.welcome.login_cherryin')}
          </Button>

          <Divider className="my-1!">
            <span className="text-(--color-text-3) text-xs">{t('onboarding.welcome.or_continue_with')}</span>
          </Divider>

          <Button size="large" block className="h-12 rounded-lg" onClick={handleConfigureProviders}>
            {t('onboarding.welcome.other_provider')}
          </Button>
        </div>

        <p className="mt-1 text-(--color-text-3) text-xs">{t('onboarding.welcome.setup_hint')}</p>
      </div>
    </div>
  )
}

export default WelcomePage
