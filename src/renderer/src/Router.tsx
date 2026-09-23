import '@renderer/databases'

import type { FC } from 'react'
import { useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProviderImportHandler from './components/ProviderImportHandler'
import NavigationHandler from './handler/NavigationHandler'
import { useOnboardingState } from './hooks/useOnboardingState'
import HomePage from './pages/home/HomePage'
import { OnboardingPage } from './pages/onboarding'
import SettingsPage from './pages/settings/SettingsPage'

const Router: FC = () => {
  const { onboardingCompleted, completeOnboarding } = useOnboardingState()

  const routes = useMemo(() => {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    )
  }, [])

  if (!onboardingCompleted) {
    return (
      <HashRouter>
        <OnboardingPage onComplete={completeOnboarding} />
        <ProviderImportHandler />
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      <Sidebar />
      {routes}
      <NavigationHandler />
      <ProviderImportHandler />
    </HashRouter>
  )
}

export default Router
