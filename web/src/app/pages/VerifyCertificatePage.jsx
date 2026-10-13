import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, CircleSlash, SearchX, ShieldAlert } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { formatCertDate } from '../../lib/certificates/layout.js'
import { formatCertCodeInput, normalizeCertCode } from '../../lib/certificates/code.js'
import { setPageMeta } from '../../lib/meta.js'
import { usePublicVerification } from '../../data/certificates.js'
import '../../nodes/certificates/i18n.js'

const CertificateView = lazy(() => import('../../shared/certificates/CertificateView.jsx'))

const LOOK = {
  valid: { icon: BadgeCheck, tone: 'border-success/50 bg-success/5', iconTone: 'text-success', key: 'valid' },
  revoked: { icon: ShieldAlert, tone: 'border-destructive/50 bg-destructive/5', iconTone: 'text-destructive-text', key: 'revoked' },
  not_found: { icon: SearchX, tone: 'border-border bg-surface', iconTone: 'text-muted-foreground', key: 'notFound' },
}

/**
 * /verify/:code? (public; the as-is /verify-certificate/:code redirects here): type or scan a code and get VALID / REVOKED / NOT FOUND
 * with the name, program and dates only (get_public_certificate_verification: no ids, no contact data, rate limited, switched off per
 * node). For a valid certificate whose node shows it, the certificate itself is drawn in the browser by the same renderer as the
 * downloads (the QR on it points back here). Mobile first, ar / en.
 */
export default function VerifyCertificatePage() {
  const { code: param } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const requested = param ? decodeURIComponent(param) : ''
  const normalized = requested ? normalizeCertCode(requested) : null
  const [value, setValue] = useState(formatCertCodeInput(requested))
  const [formatError, setFormatError] = useState(false)
  const q = usePublicVerification(normalized)

  useEffect(() => { setPageMeta({ title: t('certificates.verify.title'), description: t('certificates.verify.intro') }) }, [t])

  function submit(e) {
    e.preventDefault()
    const code = normalizeCertCode(value)
    if (!code) { setFormatError(true); return }
    setFormatError(false)
    navigate(`/verify/${encodeURIComponent(code)}?lang=${lang}`)
  }

  const result = q.data
  const status = result?.status ?? null
  const look = LOOK[status] ?? null
  const invalidTyped = Boolean(requested) && !normalized

  return (
    <div className="space-y-6 py-4" data-testid="verify-page">
      <header className="space-y-2 text-center">
        <h1 className="font-display text-page-title">{t('certificates.verify.title')}</h1>
        <p className="text-muted-foreground">{t('certificates.verify.intro')}</p>
      </header>

      <form onSubmit={submit} className="panel space-y-3 p-4" noValidate>
        <Field label={t('certificates.verify.code')} value={value} onChange={(e) => { setValue(formatCertCodeInput(e.target.value)); setFormatError(false) }}
          placeholder={t('certificates.verify.placeholder')} dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={14}
          error={formatError || invalidTyped ? t('certificates.verify.invalidFormat') : undefined} inputClassName="font-mono tracking-widest" data-testid="verify-input" />
        <Button type="submit" className="w-full sm:w-auto" loading={q.isFetching && Boolean(normalized)} data-testid="verify-submit">{t('certificates.verify.submit')}</Button>
      </form>

      {normalized && q.isPending && <Loading label={t('certificates.verify.checking')} />}
      {normalized && q.error && <ErrorState error={q.error} onRetry={q.refetch} />}
      {look && (
        <section role="status" aria-live="polite" className={cn('space-y-4 rounded-card border-2 p-5', look.tone)} data-testid="verify-result" data-status={status}>
          <div className="flex items-start gap-3">
            <look.icon className={cn('h-8 w-8 shrink-0', look.iconTone)} aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-display text-section-title" data-testid="verify-status">{t(`certificates.verify.${look.key}`)}</h2>
              <p className="text-sm text-muted-foreground">{t(`certificates.verify.${look.key}.body`)}</p>
            </div>
          </div>
          {status !== 'not_found' && (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="verify-facts">
              <Fact label={t('certificates.verify.awarded')} value={result.participant_name} strong />
              <Fact label={t('certificates.verify.program')} value={result.program_name} />
              {result.project_name && <Fact label={t('certificates.verify.project')} value={result.project_name} />}
              <Fact label={t('certificates.verify.completed')} value={formatCertDate(result.completed_on, lang)} />
              <Fact label={t('certificates.verify.issued')} value={formatCertDate(result.issued_on, lang)} />
              <Fact label={t('certificates.verify.issuer')} value={result.issuer} />
              <Fact label={t('certificates.verify.codeLabel')} value={result.code} mono />
            </dl>
          )}
          {status === 'revoked' && <CircleSlash className="sr-only" aria-hidden="true" />}
        </section>
      )}
      {status === 'valid' && result.render && (
        <Suspense fallback={<Loading />}>
          <CertificateView payload={result.render} label={t('certificates.view.alt', { name: result.participant_name })} />
        </Suspense>
      )}
      {look && (
        <p className="text-center"><Link to={`/verify?lang=${lang}`} className="font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setValue('')}>{t('certificates.verify.another')}</Link></p>
      )}
    </div>
  )
}

function Fact({ label, value, strong = false, mono = false }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('break-words', strong ? 'font-display text-lg font-bold' : 'font-semibold', mono && 'font-mono tracking-wider')} dir={mono ? 'ltr' : 'auto'}>{value}</dd>
    </div>
  )
}
