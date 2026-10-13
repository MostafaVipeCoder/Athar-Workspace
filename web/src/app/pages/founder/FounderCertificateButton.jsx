import { Medal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMyCertificates } from '../../../data/certificates.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { formatCertDate } from '../../../lib/certificates/layout.js'
import CertificateActions from '../../../shared/certificates/CertificateActions.jsx'
import '../../../nodes/certificates/i18n.js'

/**
 * Founder exposure of the Certificates node (docs/13 section 12, design 01 section 3.10, decisions 01-11 + 08 section 17.2): the "My certificate"
 * block of the founder Program page. A certificate belongs to the SIGNED-IN founder ACCOUNT: it carries HIS name and the company name, and the
 * company's other founders each download their own from their own account (a founder never sees a co-founder's certificate).
 *
 * `list_my_certificates` decides everything in the DB (issued to MY account, not revoked, the participant attended, the project is completed,
 * the node is shown to participants) and renders nothing otherwise: no "locked" teaser. Opening the block also CLAIMS the founder's own
 * certificate on demand: a founder who linked to the company after the PM issued gets hers right here (the same call, server side, idempotent).
 * Preview / PNG / PDF render in the browser on demand (the template is fetched with a short-lived signed URL the owner's storage rule allows).
 */
export default function FounderCertificateButton({ projectId, items, className, showHeading = true }) {
  const { t, lang } = useLanguage()
  // `items` = the rows the Program page already holds (get_founder_program_page claims first): no second request
  const q = useMyCertificates(projectId, { enabled: Boolean(projectId) && !items })
  const list = items ?? q.data ?? []
  if (!list.length) return null
  return (
    <section className={className} aria-label={t('certificates.founder.title')} data-testid="founder-certificates">
      <ul className="space-y-3">
        {list.map((c) => {
          const person = c.person_name ?? c.participant_name
          return (
            <li key={c.certificate_id} className="space-y-3 rounded-card border border-border bg-card p-4" data-testid="founder-certificate">
              <div className="flex items-start gap-3">
                <Medal className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  {showHeading && <h3 className="font-display text-lg font-bold">{t('certificates.founder.title')}</h3>}
                  <p className="text-sm text-muted-foreground">{t('certificates.founder.body')}</p>
                  <p className="break-words text-base font-semibold" dir="auto" data-testid="founder-certificate-person">{person}</p>
                  {c.company_name && <p className="break-words text-sm text-muted-foreground" dir="auto" data-testid="founder-certificate-company">{c.company_name}</p>}
                  <p className="break-words text-sm" dir="auto">{c.program_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('certificates.founder.code')}{' '}<span dir="ltr" className="font-mono" data-testid="founder-certificate-code">{c.code}</span>
                    {' · '}{t('certificates.founder.issued', { date: formatCertDate(c.issued_at, lang === 'ar' ? 'ar' : 'en') })}
                  </p>
                </div>
              </div>
              <CertificateActions certificateId={c.certificate_id} name={person} />
              <Link to={`/verify/${encodeURIComponent(c.code)}?lang=${lang}`} className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">{t('certificates.founder.verify')}</Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
