import { useMobileBack } from '@renderer/services/mobile/back'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { FC } from 'react'
import { useState } from 'react'

import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

export type OnboardingStep = 'welcome' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void
}

const OnboardingPage: FC<OnboardingPageProps> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [, setProviderConfigured] = useState(false)
  useMobileBack(runtimeCapabilities.android && step === 'select-model', () => setStep('welcome'))

  return (
    <div className="flex h-screen w-screen flex-col">
      {!runtimeCapabilities.android && (
        <div
          className="drag flex w-full shrink-0 items-center justify-end"
          style={{ height: 'var(--navbar-height)' }}
        />
      )}
      <div className={`flex flex-1 px-2 pb-2 ${runtimeCapabilities.android ? 'pt-2' : ''}`}>
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-(--color-background)">
          <SkipButton onSkip={onComplete} />
          {step === 'welcome' && <WelcomePage setStep={setStep} setProviderConfigured={setProviderConfigured} />}
          {step === 'select-model' && <SelectModelPage setStep={setStep} onComplete={onComplete} />}
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
