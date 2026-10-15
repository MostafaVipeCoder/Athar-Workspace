import { Link } from 'react-router-dom'
import '../../../shared/outbox/i18n.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { EmailHealthPanel } from '../../../shared/outbox/EmailHealthPanel.jsx'
import { staffPath } from '../../../lib/links.js'

/**
 * /admin/email (super_admin; the route guard checks `staff:manage`, get_email_health re-checks server-side): the health of the whole e-mail queue (m62): the worker and the
 * scheduler, what is waiting and held back, each sender against its limits, the last 24 hours.
 */
export default function EmailHealthPage() {
  const { t } = useLanguage()
  return (
    <div className="space-y-4" data-testid="email-health-page">
      <div>
        <p className="text-xs text-muted-foreground"><Link to={staffPath.staff()} className="inline-flex min-h-11 items-center hover:underline">{t('nav.staff')}</Link></p>
        <h1 className="text-section-title">{t('outbox.health.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('outbox.health.hint')}</p>
      </div>
      <EmailHealthPanel />
    </div>
  )
}
