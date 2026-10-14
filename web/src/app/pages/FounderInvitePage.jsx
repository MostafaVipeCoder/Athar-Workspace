import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, MailCheck } from 'lucide-react'
import { useAuth } from '../AuthContext.js'
import { acceptInvitation, getMyAlumniProfile, validateInvitation } from '../../data/alumni.js'
import { signUpFounder } from '../../data/auth.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { Field } from '../../ui/Field.jsx'
import { Loading } from '../../ui/States.jsx'
import { holdsStaffRole, invitationCompanyName, validateSignupForm } from '../../lib/alumniSignup.js'
import './alumniAuth.i18n.js'

const card = 'panel w-full max-w-md p-6 text-card-foreground shadow-dropdown animate-in fade-in zoom-in-95 sm:p-panel-pad'

/**
 * /invite/:token (design 09 F2): a founder invitation of an EXISTING company. The page shows which company and who invited, then
 *  - signed in as a founder: accepts with this account (`accept_invitation`: the e-mail must be the invited one; the server links him to the company, not as primary);
 *  - signed in as staff: explains why not (staff and founder are mutually exclusive, m25) and offers to sign out;
 *  - anonymous: creates the account (the trigger links the company when the e-mail is the invited one) or signs in first (`/login?next=/invite/:token`).
 * The e-mail is typed by the person: the invitation only reveals a masked address.
 */
export default function FounderInvitePage() {
  const { token } = useParams()
  const { t, lang, formatDate } = useLanguage()
  const { status, user, roles, signOut } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const inv = useQuery({ queryKey: ['alumni', 'invitation', token], queryFn: () => validateInvitation(token), retry: false, staleTime: 60_000, meta: { silent: true } })
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null) // 'confirm' | 'notLinked'
  const [creating, setCreating] = useState(false) // sign-up in progress: the session appears before the company link is checked, keep the form on screen
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }))

  if ((inv.isPending && !outcome) || (status === 'loading' && !outcome)) return <Loading label={t('alumni.auth.invite.checking')} />

  if (outcome === 'confirm') {
    return (
      <div className={card} data-testid="invite-confirm">
        <MailCheck className="h-8 w-8 text-primary" aria-hidden="true" />
        <p className="mt-2 text-base">{t('alumni.auth.invite.confirmBody', { email: form.email.trim() })}</p>
        <Link to="/login" className={buttonClass({ variant: 'outline', className: 'mt-4' })}>{t('alumni.auth.signup.signIn')}</Link>
      </div>
    )
  }
  if (outcome === 'notLinked') {
    return (
      <div className={card} data-testid="invite-not-linked">
        <h1 className="text-section-title">{t('alumni.auth.invite.notLinkedTitle')}</h1>
        <p className="mt-2 text-base text-muted-foreground">{t('alumni.auth.invite.notLinkedBody')}</p>
        <Button className="mt-4" onClick={() => navigate('/alumni/founder/profile', { replace: true, state: { welcome: true } })}>{t('alumni.auth.invite.continue')}</Button>
      </div>
    )
  }

  if (inv.isError || !inv.data?.valid) {
    return (
      <div className={card} data-testid="invite-invalid">
        <h1 className="text-section-title">{t('alumni.auth.invite.invalidTitle')}</h1>
        <p className="mt-2 text-base text-muted-foreground">{t('alumni.auth.invite.invalidBody')}</p>
        <Link to="/login" className={buttonClass({ variant: 'outline', className: 'mt-4' })}>{t('common.signIn')}</Link>
      </div>
    )
  }

  const data = inv.data
  const company = invitationCompanyName(data, lang)
  const header = (
    <>
      <h1 className="flex items-start gap-2 text-section-title"><Building2 className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 break-words" data-testid="invite-company">{t('alumni.auth.invite.title', { company })}</span></h1>
      <p className="mt-2 text-base text-muted-foreground">{t('alumni.auth.invite.subtitle')}</p>
      <dl className="mt-3 space-y-1 rounded-input bg-surface p-3 text-sm">
        {data.inviter_name && <div><dd>{t('alumni.auth.invite.invitedBy', { name: data.inviter_name })}</dd></div>}
        <div><dd dir="ltr" className="text-start">{t('alumni.auth.invite.forEmail', { email: data.masked_email })}</dd></div>
        {data.expires_at && <div><dd>{t('alumni.auth.invite.expires', { date: formatDate(data.expires_at, { dateStyle: 'medium' }) })}</dd></div>}
      </dl>
    </>
  )

  async function acceptAsCurrent() {
    setBusy(true)
    setFormError(null)
    try {
      const r = await acceptInvitation(token)
      if (!r?.accepted) { setFormError(t('alumni.auth.invite.notAccepted')); return }
      qc.clear()
      navigate('/alumni/founder/profile', { replace: true, state: { invited: true } })
    } catch (err) {
      setFormError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const found = validateSignupForm(form)
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key)])))
    setFormError(null)
    if (Object.keys(found).length) return
    setBusy(true)
    setCreating(true)
    try {
      const { session } = await signUpFounder({ email: form.email, password: form.password, fullName: form.fullName, invitationToken: token })
      if (!session) { setOutcome('confirm'); return }
      // the database trigger linked the company when the e-mail is the invited one: look, do not assume
      const mine = await getMyAlumniProfile().catch(() => null)
      if ((mine?.companies ?? []).length > 0) navigate('/alumni/founder/profile', { replace: true, state: { invited: true } })
      else setOutcome('notLinked')
    } catch (err) {
      setCreating(false)
      setFormError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'authed' && !creating) {
    const staff = holdsStaffRole(roles)
    return (
      <div className={card} data-testid="invite-page">
        {header}
        <div className="mt-4 space-y-3" data-testid="invite-signed-in">
          <p className="text-sm">{t('alumni.auth.invite.signedInAs', { email: user?.email ?? '' })}</p>
          {staff ? (
            <div role="alert" className="space-y-2 rounded-input bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="invite-staff">
              <p className="font-semibold">{t('alumni.auth.invite.staffTitle')}</p>
              <p>{t('alumni.auth.invite.staffBody')}</p>
            </div>
          ) : (
            formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="invite-error">{formError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!staff && <Button onClick={acceptAsCurrent} loading={busy}>{busy ? t('alumni.auth.invite.accepting') : t('alumni.auth.invite.accept', { company })}</Button>}
            <Button variant="outline" onClick={() => signOut()} disabled={busy}>{staff ? t('alumni.auth.invite.signOut') : t('alumni.auth.invite.useOther')}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={card} data-testid="invite-page">
      {header}
      <form onSubmit={submit} noValidate className="mt-4 space-y-field-gap" data-testid="invite-form">
        <Field label={t('alumni.auth.signup.fullName')} name="fullName" autoComplete="name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
        <Field label={t('auth.email')} type="email" name="email" autoComplete="email" inputMode="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} hint={t('alumni.auth.invite.emailHint', { email: data.masked_email })} />
        <Field label={t('auth.password')} type="password" name="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} error={errors.password} hint={t('invite.passwordHint')} />
        <Field label={t('invite.confirmPassword')} type="password" name="confirm" autoComplete="new-password" dir="ltr" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} error={errors.confirm} />
        {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="invite-error">{formError}</p>}
        <Button type="submit" size="lg" className="w-full rounded-sm" loading={busy}>{busy ? t('alumni.auth.signup.submitting') : t('alumni.auth.invite.submit')}</Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        {t('alumni.auth.invite.haveAccount')}{' '}
        <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="font-semibold text-primary underline-offset-4 hover:underline" data-testid="invite-signin">{t('alumni.auth.invite.signInInstead')}</Link>
      </p>
    </div>
  )
}
