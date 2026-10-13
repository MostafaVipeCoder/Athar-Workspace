import { Link, Navigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../AuthContext.js'
import { Button } from '../../ui/Button.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Authenticated but without permission / without any role (replaces "role-less user lands on the dashboard"). */
export default function NoAccessPage() {
  const { t } = useLanguage()
  const { status, roles, signOut } = useAuth()
  if (status === 'anon') return <Navigate to="/login" replace />
  const noRole = status === 'authed' && roles.length === 0
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-hero-pattern bg-cover bg-center p-6">
      <div className="panel flex w-full max-w-md flex-col items-center gap-4 p-6 text-center shadow-dropdown sm:p-panel-pad">
        <ShieldOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-section-title">{t('auth.noAccessTitle')}</h1>
        <p className="text-base text-muted-foreground">{noRole ? t('auth.noAccessNoRole') : t('auth.noAccessForbidden')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!noRole && (
            <Link to="/" className={buttonClass()}>
              {t('common.goHome')}
            </Link>
          )}
          {status === 'authed' && (
            <Button variant="outline" onClick={() => signOut()}>
              {t('common.signOut')}
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
