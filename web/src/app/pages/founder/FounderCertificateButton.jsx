import { Medal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMyCertificates } from '../../../data/certificates.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { formatCertDate } from '../../../lib/certificates/layout.js'
import CertificateActions from '../../../shared/certificates/CertificateActions.jsx'
import '../../../nodes/certificates/i18n.js'

/**
 * Founder exposure of the Certificates node (docs/13 section 12, design 01 section 3.10, decision 01-11): the "My certificate" block of
 * the founder Program page. It lists the certificates of the signed-in founder for ONE project (`list_my_certificates`: issued, not
 * revoked, the participant attended, the project is completed and the node is shown to participants - all decided by the DB) and
 * renders nothing otherwise: no "locked" teaser. Preview / PNG / PDF render in the browser on demand (the template is fetched with a
 * short-lived signed URL the owner's storage rule allows). The step-8 founder Program page embeds this component.
 */
export default function FounderCertificateButton({ projectId, items, className, showHeading = true }) {
  const { t, lang } = useLanguage()
  // `items` = the rows the Program page already holds (get_founder_program_page): no second request
  const q = useMyCertificates(projectId, { enabled: Boolean(projectId) && !items })
  const list = items ?? q.data ?? []
  if (!list.length) return null
  return (
    <section className={className} aria-label={t('certificates.founder.title')} data-testid="founder-certificates">
      <ul className="space-y-3">
        {list.map((c) => (
          <li key={c.certificate_id} className="space-y-3 rounded-card border border-border bg-card p-4" data-testid="founder-certificate">
            <div className="flex items-start gap-3">
              <Medal className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                {showHeading && <h3 className="font-display text-lg font-bold">{t('certificates.founder.title')}</h3>}
                <p className="text-sm text-muted-foreground">{t('certificates.founder.body')}</p>
                <p className="break-words text-sm font-semibold" dir="auto">{t('certificates.founder.for', { name: c.participant_name, program: c.program_name })}</p>
                <p className="text-xs text-muted-foreground">
                  <span dir="ltr" className="font-mono">{t('certificates.founder.code', { code: c.code })}</span>
                  {' · '}{t('certificates.founder.issued', { date: formatCertDate(c.issued_at, lang === 'ar' ? 'ar' : 'en') })}
                </p>
              </div>
            </div>
            <CertificateActions certificateId={c.certificate_id} name={c.participant_name} />
            <Link to={`/verify/${encodeURIComponent(c.code)}?lang=${lang}`} className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">{t('certificates.founder.verify')}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
