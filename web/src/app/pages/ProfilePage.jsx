import { lazy, Suspense, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../AuthContext.js'
import { updateProfile, updatePassword } from '../../data/auth.js'
import { keys } from '../../data/queryKeys.js'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { ColorSwatches } from '../../ui/ColorSwatches.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { PROFILE_COLORS, STAFF_ROLES } from '../../lib/constants.js'

// the Google connection (m61) is a lazy chunk: only staff open it, and only on this page
const GoogleAccountSection = lazy(() => import('../../shared/google/GoogleAccountSection.jsx'))

/** Minimal /profile (06 section 2.1): display name, profile colour, UI language, change password. Any signed-in user. */
export default function ProfilePage() {
  const { user, profile, roles } = useAuth()
  const { t, lang, setLang } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [color, setColor] = useState(profile?.profile_color ?? PROFILE_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwError, setPwError] = useState(null)
  const [pwBusy, setPwBusy] = useState(false)

  async function saveProfile(e) {
    e.preventDefault()
    if (name.trim().length < 2) {
      toast.warning(t('invite.nameRequired'))
      return
    }
    setBusy(true)
    try {
      await updateProfile(user.id, { full_name: name, profile_color: color, language: lang })
      qc.invalidateQueries({ queryKey: keys.profile(user.id) })
      toast.success(t('profile.saved'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pw.next.length < 8) return setPwError(t('invite.passwordShort'))
    if (pw.next !== pw.confirm) return setPwError(t('invite.passwordMismatch'))
    setPwError(null)
    setPwBusy(true)
    try {
      await updatePassword(pw.next)
      setPw({ next: '', confirm: '' })
      toast.success(t('profile.passwordChanged'))
    } catch (err) {
      setPwError(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div className="space-y-6 py-4" data-testid="profile-page">
      <div className="flex items-center gap-4">
        <Avatar name={name || user?.email} id={user?.id} color={color} size="lg" />
        <div className="min-w-0">
          <h1 className="text-section-title">{t('profile.title')}</h1>
          <p className="truncate text-sm text-muted-foreground" dir="ltr">{user?.email}</p>
          <p className="text-xs text-muted-foreground">{roles.map((r) => t(`role.${r}`)).join(' · ')}</p>
        </div>
      </div>

      <form onSubmit={saveProfile} className="space-y-4 rounded-card border bg-card p-4" noValidate>
        <Field label={t('invite.fullName')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <ColorSwatches label={t('invite.color')} options={PROFILE_COLORS} value={color} onChange={setColor} />
        <Field as="select" label={t('common.language')} value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </div>
      </form>

      {roles.some((r) => STAFF_ROLES.includes(r)) && (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-surface" aria-hidden="true" />}>
          <GoogleAccountSection />
        </Suspense>
      )}

      <form onSubmit={changePassword} className="space-y-4 rounded-card border bg-card p-4" noValidate>
        <h2 className="font-semibold">{t('profile.changePassword')}</h2>
        <Field label={t('profile.newPassword')} type="password" autoComplete="new-password" dir="ltr" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} hint={t('invite.passwordHint')} />
        <Field label={t('invite.confirmPassword')} type="password" autoComplete="new-password" dir="ltr" value={pw.confirm} onChange={(e) => setPw((s) => ({ ...s, confirm: e.target.value }))} error={pwError} />
        <div className="flex justify-end">
          <Button type="submit" variant="outline" loading={pwBusy}>{t('profile.changePassword')}</Button>
        </div>
      </form>
    </div>
  )
}
