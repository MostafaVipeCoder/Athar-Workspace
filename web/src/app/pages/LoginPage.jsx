import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../AuthContext.js'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { canOpenPath, safeNext } from '../../lib/access.js'
import { roleHome } from '../../lib/permissions.js'
import { readLastArea } from '../lastArea.js'
import { AppError } from '../../data/errors.js'

/**
 * One login page for every role (design 06 section 2.1). Role-aware redirect; ?next honoured only if reachable.
 * Look: the site's hero card - 15px white panel, Hepta Slab title, fields 20px apart, full-width yellow CTA.
 */
export default function LoginPage() {
  const { status, roles, signIn } = useAuth()
  const { t } = useLanguage()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)

  const next = safeNext(params.get('next'))

  useEffect(() => {
    if (status !== 'authed') return
    const target = next && canOpenPath(roles, next) ? next : (roleHome(roles, readLastArea()) ?? '/')
    navigate(target, { replace: true })
  }, [status, roles, next, navigate])

  if (status === 'loading') return <Loading label={t('auth.checkingSession')} />
  if (status === 'error') return <Navigate to="/" replace />

  async function onSubmit(e) {
    e.preventDefault()
    const nextErrors = {}
    if (!email.trim()) nextErrors.email = t('auth.fieldRequired')
    if (!password) nextErrors.password = t('auth.fieldRequired')
    setErrors(nextErrors)
    setFormError(null)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setFormError(err instanceof AppError ? t(err.messageKey) : t('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel w-full max-w-md p-6 text-card-foreground shadow-dropdown animate-in fade-in zoom-in-95 sm:p-panel-pad">
      <h1 className="text-section-title">{t('auth.title')}</h1>
      <p className="mt-2 text-base text-muted-foreground">{t('auth.subtitle')}</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-field-gap">
        <Field label={t('auth.email')} type="email" name="email" autoComplete="username" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field label={t('auth.password')} type="password" name="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        {formError && (
          <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full rounded-sm" loading={busy}>
          {busy ? t('auth.submitting') : t('auth.submit')}
        </Button>
      </form>
    </div>
  )
}
