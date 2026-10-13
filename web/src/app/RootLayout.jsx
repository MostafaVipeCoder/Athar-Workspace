import { Suspense, useEffect } from 'react'
import { Outlet, useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { LanguageProvider, useLanguage } from '../i18n/LanguageProvider.jsx'
import { ToastProvider, useToast } from '../ui/Toast.jsx'
import { ConfirmProvider } from '../ui/ConfirmDialog.jsx'
import { ErrorBoundary } from '../ui/ErrorBoundary.jsx'
import { Loading } from '../ui/States.jsx'
import { Button } from '../ui/Button.jsx'
import { buttonClass } from '../ui/buttonStyles.js'
import { setGlobalErrorListener } from '../data/queryClient.js'
import AuthProvider from './AuthProvider.jsx'
import EnvBanner from './EnvBanner.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export function CrashScreen({ onReload }) {
  const { t } = useLanguage()
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <h1 className="text-section-title">{t('errors.boundaryTitle')}</h1>
      <p className="text-base text-muted-foreground">{t('errors.boundaryBody')}</p>
      <div className="flex gap-2">
        <Button onClick={onReload ?? (() => window.location.reload())}>{t('common.reload')}</Button>
        <a href="/" className={buttonClass({ variant: 'outline' })}>{t('common.goHome')}</a>
      </div>
    </main>
  )
}

/** Route-level errorElement: 404s render NotFound, anything else the crash screen (the shell above it survives). */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  return <CrashScreen />
}

function GlobalErrorToasts() {
  const toast = useToast()
  const { t } = useLanguage()
  useEffect(() => {
    setGlobalErrorListener((e) => toast.error(t(e.messageKey)))
    return () => setGlobalErrorListener(null)
  }, [toast, t])
  return null
}

/** Root route element: providers (language, toast, confirm, auth), env banner, root error boundary, Suspense. */
export default function RootLayout() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <ConfirmProvider>
          <GlobalErrorToasts />
          <AuthProvider>
            <EnvBanner />
            <ErrorBoundary name="root" fallback={() => <CrashScreen />}>
              <Suspense fallback={<Loading fullScreen />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </LanguageProvider>
  )
}
