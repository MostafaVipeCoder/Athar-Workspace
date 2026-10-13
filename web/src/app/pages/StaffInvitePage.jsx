import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext.js'
import { useStaffInvitation, acceptStaffInvitation } from '../../data/staff.js'
import { signUpWithStaffInvitation } from '../../data/auth.js'
import { Button } from '../../ui/Button.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { Field } from '../../ui/Field.jsx'
import { ColorSwatches } from '../../ui/ColorSwatches.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { PROFILE_COLORS } from '../../lib/constants.js'
import { validateInviteForm } from './forms.logic.js'

/**
 * /invite/staff/:token (08 section 14): shows e-mail + inviter + expiry (anon RPC), asks ONLY full name + password +
 * profile colour, creates the account (e-mail from the invitation, token in user metadata so the DB never grants
 * founder), accepts the invitation (idempotent RPC) and lands in the staff app.
 */
export default function StaffInvitePage() {
  const { token } = useParams()
  const { t, formatDate } = useLanguage()
  const { status, user, signOut } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const inv = useStaffInvitation(token)
  const [form, setForm] = useState({ fullName: '', password: '', confirm: '', color: PROFILE_COLORS[0] })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }))

  if (inv.isPending || status === 'loading') return <Loading label={t('invite.checking')} />

  const card = 'panel w-full max-w-md p-6 text-card-foreground shadow-dropdown animate-in fade-in zoom-in-95 sm:p-panel-pad'
  if (inv.isError || !inv.data?.valid) {
    return (
      <div className={card} data-testid="invite-invalid">
        <h1 className="text-section-title">{t('invite.invalidTitle')}</h1>
        <p className="mt-2 text-base text-muted-foreground">{t('invite.invalidBody')}</p>
        <Link to="/login" className={buttonClass({ variant: 'outline', className: 'mt-4' })}>{t('common.signIn')}</Link>
      </div>
    )
  }
  const data = inv.data

  async function finish(result) {
    if (!result?.accepted) {
      setFormError(t(`invite.reason.${result?.reason ?? 'invalid'}`))
      return
    }
    qc.clear()
    navigate('/', { replace: true })
  }

  // already signed in: accept with THIS account (the e-mail must match; the RPC checks)
  async function acceptAsCurrent() {
    setBusy(true)
    setFormError(null)
    try {
      await finish(await acceptStaffInvitation(token))
    } catch (err) {
      setFormError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const errs = validateInviteForm(form)
    setErrors(errs)
    setFormError(null)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const session = await signUpWithStaffInvitation({ email: data.email, password: form.password, fullName: form.fullName.trim(), profileColor: form.color.toLowerCase(), token })
      if (!session) {
        // e-mail confirmation is on: the trigger already applied the invitation; the user confirms and signs in
        setFormError(t('invite.confirmEmail'))
        return
      }
      await finish(await acceptStaffInvitation(token))
    } catch (err) {
      setFormError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={card} data-testid="invite-page">
      <h1 className="text-section-title">{t('invite.title')}</h1>
      <p className="mt-2 text-base text-muted-foreground">{t('invite.subtitle', { inviter: data.inviter_name })}</p>
      <dl className="mt-3 rounded-input bg-surface p-3 text-sm">
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('auth.email')}</dt><dd dir="ltr" className="font-medium">{data.email}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('invite.expires')}</dt><dd>{formatDate(data.expires_at)}</dd></div>
      </dl>

      {status === 'authed' ? (
        <div className="mt-4 space-y-3" data-testid="invite-signed-in">
          <p className="text-sm">{t('invite.signedInAs', { email: user?.email ?? '' })}</p>
          {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={acceptAsCurrent} loading={busy}>{t('invite.acceptAsCurrent')}</Button>
            <Button variant="outline" onClick={() => signOut()} disabled={busy}>{t('invite.useOther')}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4" data-testid="invite-form">
          <div className="flex items-center gap-3">
            <Avatar name={form.fullName || data.email} color={form.color} size="lg" />
            <Field className="flex-1" label={t('invite.fullName')} name="fullName" autoComplete="name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName && t(errors.fullName)} data-autofocus />
          </div>
          <Field label={t('auth.password')} type="password" name="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} error={errors.password && t(errors.password)} hint={t('invite.passwordHint')} />
          <Field label={t('invite.confirmPassword')} type="password" name="confirm" autoComplete="new-password" dir="ltr" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} error={errors.confirm && t(errors.confirm)} />
          <ColorSwatches label={t('invite.color')} options={PROFILE_COLORS} value={form.color} onChange={(c) => set('color', c)} />
          {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>{busy ? t('invite.submitting') : t('invite.submit')}</Button>
        </form>
      )}
    </div>
  )
}
