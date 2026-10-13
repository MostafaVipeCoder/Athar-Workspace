import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.js'
import { AREA_HOME, roleHome } from '../../lib/permissions.js'
import { Loading, ErrorState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { readLastArea } from '../lastArea.js'

/** Route `/`: anonymous -> /login; no roles -> /no-access; one area -> its home; several -> remembered area or chooser. */
export default function RoleHome() {
  const { status, roles, areas, reloadRoles } = useAuth()
  const { t } = useLanguage()

  if (status === 'loading') return <Loading fullScreen label={t('auth.checkingSession')} />
  if (status === 'error') return <div className="p-6"><ErrorState title={t('auth.rolesFailed')} onRetry={reloadRoles} /></div>
  if (status === 'anon') return <Navigate to="/login" replace />

  const target = roleHome(roles, readLastArea())
  if (target) return <Navigate to={target} replace />

  // several areas and nothing remembered: small chooser
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="text-section-title">{t('nav.area')}</h1>
      {areas.map((a) => (
        <Link key={a} to={AREA_HOME[a]} className="panel tap-target flex items-center p-4 font-semibold transition-colors duration-300 hover:border-foreground/40 hover:text-primary">
          {t(`area.${a}`)}
        </Link>
      ))}
    </main>
  )
}
