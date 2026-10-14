import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../AuthContext.js'
import { signUpFounder } from '../../data/auth.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { Field } from '../../ui/Field.jsx'
import { focusFirstInvalidSoon } from '../../ui/focusFirstInvalid.js'
import { Loading } from '../../ui/States.jsx'
import { roleHome } from '../../lib/permissions.js'
import { validateSignupForm } from '../../lib/alumniSignup.js'
import { readLastArea } from '../lastArea.js'
import './alumniAuth.i18n.js'

const card = 'panel w-full max-w-md p-6 text-card-foreground shadow-dropdown animate-in fade-in zoom-in-95 sm:p-panel-pad'

/**
 * /signup (design 09 F1): open founder sign-up on the Alumni platform: name, e-mail, password. The role is granted by the database trigger (the literal `founder`,
 * never read from what is sent). With e-mail confirmation ON in the project there is no session yet: the page says "check your e-mail"; the local stack auto-confirms.
 * Hook for CAPTCHA: `signUpFounder({ captchaToken })` (03 OD-5: not built; GoTrue enforces it once it is enabled in the Auth settings).
 */
export default function SignupPage() {
  const { t } = useLanguage()
  const { status, roles } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // 'confirm' | 'session'
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }))

  if (status === 'loading' && !done) return <Loading label={t('auth.checkingSession')} />
  // an account that is already signed in goes to its own home (a staff member never becomes a founder here)
  if (status === 'authed' && !done) return <Navigate to={roleHome(roles, readLastArea()) ?? '/'} replace />

  if (done === 'confirm') {
    return (
      <div className={card} data-testid="signup-confirm">
        <MailCheck className="h-8 w-8 text-primary" aria-hidden="true" />
        <h1 className="mt-2 text-section-title">{t('alumni.auth.signup.confirmTitle')}</h1>
        <p className="mt-2 text-base text-muted-foreground">{t('alumni.auth.signup.confirmBody', { email: form.email.trim() })}</p>
        <Link to="/login" className={buttonClass({ variant: 'outline', className: 'mt-4' })}>{t('alumni.auth.signup.signIn')}</Link>
      </div>
    )
  }

  async function submit(e) {
    e.preventDefault()
    const found = validateSignupForm(form)
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key)])))
    setFormError(null)
    if (Object.keys(found).length) { focusFirstInvalidSoon(e.currentTarget); return } // the first problem gets the focus (and is announced)
    setBusy(true)
    try {
      const { session } = await signUpFounder({ email: form.email, password: form.password, fullName: form.fullName })
      if (!session) { setDone('confirm'); return }
      setDone('session')
      navigate('/alumni/founder/profile', { replace: true, state: { welcome: true } })
    } catch (err) {
      setFormError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={card} data-testid="signup-page">
      <h1 className="text-section-title">{t('alumni.auth.signup.title')}</h1>
      <p className="mt-2 text-base text-muted-foreground">{t('alumni.auth.signup.subtitle')}</p>
      <form onSubmit={submit} noValidate className="mt-6 space-y-field-gap">
        <Field label={t('alumni.auth.signup.fullName')} name="fullName" autoComplete="name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
        <Field label={t('auth.email')} type="email" name="email" autoComplete="email" inputMode="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
        <Field label={t('auth.password')} type="password" name="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} error={errors.password} hint={t('invite.passwordHint')} />
        <Field label={t('invite.confirmPassword')} type="password" name="confirm" autoComplete="new-password" dir="ltr" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} error={errors.confirm} />
        {formError && (
          <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="signup-error">
            {formError} {formError === t('alumni.auth.emailTaken') && <Link to="/login" className="font-semibold underline">{t('alumni.auth.signup.signIn')}</Link>}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full rounded-sm" loading={busy}>{busy ? t('alumni.auth.signup.submitting') : t('alumni.auth.signup.submit')}</Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        {t('alumni.auth.signup.haveAccount')} <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">{t('alumni.auth.signup.signIn')}</Link>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t('alumni.auth.signup.staffNote')}</p>
    </div>
  )
}
