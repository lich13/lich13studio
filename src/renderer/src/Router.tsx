import '@renderer/databases'

import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { FC } from 'react'
import { useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import MobileNavigation from './components/app/MobileNavigation'
import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProviderImportHandler from './components/ProviderImportHandler'
import NavigationHandler from './handler/NavigationHandler'
import { useOnboardingState } from './hooks/useOnboardingState'
import HomePage from './pages/home/HomePage'
import ModelTestPage from './pages/model-test/ModelTestPage'
import { OnboardingPage } from './pages/onboarding'
import SettingsPage from './pages/settings/SettingsPage'
import { LEGACY_MODEL_TEST_PATH, MODEL_TEST_PATH } from './services/modelTrace/routes'

const Router: FC = () => {
  const { onboardingCompleted, completeOnboarding } = useOnboardingState()

  const routes = useMemo(() => {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path={MODEL_TEST_PATH} element={<ModelTestPage />} />
          <Route path={LEGACY_MODEL_TEST_PATH} element={<Navigate to={MODEL_TEST_PATH} replace />} />
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
      {!runtimeCapabilities.android && <Sidebar />}
      {routes}
      {runtimeCapabilities.android && <MobileNavigation />}
      <NavigationHandler />
      <ProviderImportHandler />
    </HashRouter>
  )
}

export default Router
