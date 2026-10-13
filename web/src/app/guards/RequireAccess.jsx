import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext.js'
import { decideAccess } from '../../lib/access.js'
import { Loading, ErrorState } from '../../ui/States.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Layout-route guard. One implementation of the decision table in lib/access.js (design 06 section 8.3). */
export default function RequireAccess({ area, permission }) {
  const { status, roles, reloadRoles } = useAuth()
  const location = useLocation()
  const toast = useToast()
  const { t } = useLanguage()
  const decision = decideAccess({ status, roles, area, permission, location })

  const notify = decision.action === 'redirect' && decision.notify
  useEffect(() => {
    if (notify) toast.info(t('auth.areaRedirected'))
  }, [notify, toast, t])

  switch (decision.action) {
    case 'loading':
      return <Loading fullScreen label={t('auth.checkingSession')} />
    case 'error':
      return (
        <div className="p-6">
          <ErrorState title={t('auth.rolesFailed')} onRetry={reloadRoles} />
        </div>
      )
    case 'allow':
      return <Outlet />
    default:
      return <Navigate to={decision.to} replace state={decision.action === 'no-access' ? { from: location.pathname } : undefined} />
  }
}
