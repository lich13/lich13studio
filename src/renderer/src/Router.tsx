import '@renderer/databases'

import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { FC } from 'react'
import { lazy, Suspense, useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import MobileNavigation, { MobileBackHandler } from './components/app/MobileNavigation'
import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import NavigationHandler from './handler/NavigationHandler'
import { useOnboardingState } from './hooks/useOnboardingState'

const HomePage = lazy(() => import('./pages/home/HomePage'))
const OnboardingPage = lazy(() => import('./pages/onboarding').then((mod) => ({ default: mod.OnboardingPage })))
const ProviderImportHandler = lazy(() => import('./components/ProviderImportHandler'))
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

  return (
    <HashRouter>
      {runtimeCapabilities.android && <MobileBackHandler />}
      {runtimeCapabilities.android && (
        <Suspense fallback={null}>
          <ProviderImportHandler />
        </Suspense>
      )}
      {onboardingCompleted ? (
        <>
          {!runtimeCapabilities.android && <Sidebar />}
          {routes}
          {runtimeCapabilities.android && <MobileNavigation />}
          <NavigationHandler />
        </>
      ) : (
        <Suspense fallback={null}>
          <OnboardingPage onComplete={completeOnboarding} />
        </Suspense>
      )}
    </HashRouter>
  )
}

export default Router
