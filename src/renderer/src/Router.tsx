import '@renderer/databases'

import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { FC } from 'react'
import { lazy, Suspense, useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import MobileNavigation from './components/app/MobileNavigation'
import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import NavigationHandler from './handler/NavigationHandler'
import { useOnboardingState } from './hooks/useOnboardingState'
import HomePage from './pages/home/HomePage'

const OnboardingPage = lazy(() => import('./pages/onboarding').then((mod) => ({ default: mod.OnboardingPage })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))

const Router: FC = () => {
  const { onboardingCompleted, completeOnboarding } = useOnboardingState()

  const routes = useMemo(() => {
    return (
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    )
  }, [])

  if (!onboardingCompleted) {
    return (
      <HashRouter>
        <Suspense fallback={null}>
          <OnboardingPage onComplete={completeOnboarding} />
        </Suspense>
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      {!runtimeCapabilities.android && <Sidebar />}
      {routes}
      {runtimeCapabilities.android && <MobileNavigation />}
      <NavigationHandler />
    </HashRouter>
  )
}

export default Router
