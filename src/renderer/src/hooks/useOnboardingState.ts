import { useCallback, useEffect, useState } from 'react'

const ONBOARDING_COMPLETED_KEY = 'onboarding-completed'
const onboardingListeners = new Set<(completed: boolean) => void>()

export function markOnboardingCompleted(): void {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  onboardingListeners.forEach((listener) => listener(true))
}

export function useOnboardingState() {
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    () => localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
  )

  useEffect(() => {
    onboardingListeners.add(setOnboardingCompleted)
    return () => {
      onboardingListeners.delete(setOnboardingCompleted)
    }
  }, [])

  const completeOnboarding = useCallback(() => {
    markOnboardingCompleted()
  }, [])

  return {
    onboardingCompleted,
    completeOnboarding
  }
}
