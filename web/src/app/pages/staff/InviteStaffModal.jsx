import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { isEmail, normalizeEmail } from '../../../lib/contact.js'
import { appBaseUrl, buildStaffInviteUrl } from '../../../lib/links.js'
import { RoleChecklist } from './RolesModal.jsx'
import { ProgramChecklist } from './MembershipsModal.jsx'

/** Copy-to-clipboard button; falls back to selecting the text when the Clipboard API is unavailable. */
export function CopyLink({ value, label, copiedLabel }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      const el = document.getElementById('invite-link')
      el?.select?.()
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="copy-link">
      {done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {done ? copiedLabel : label}
    </Button>
  )
}

/**
 * Invite a staff member by e-mail (08 section 14). The RPC queues the e-mail in the outbox (delivery not wired yet) and
 * returns the clear token ONCE; the link is shown here with a copy button and is not retrievable later.
 */
export default function InviteStaffModal({ programs, onClose, onInvite }) {
  const { t, lang } = useLanguage()
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState(['project_manager'])
  const [programIds, setProgramIds] = useState([])
  const [language, setLanguage] = useState(lang)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!isEmail(email)) {
      setError(t('staff.emailInvalid'))
      return
    }
    if (roles.length === 0) {
      setError(t('staff.rolesRequired'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await onInvite({ email: normalizeEmail(email), roles, programIds, language, appUrl: appBaseUrl() })
      setResult({ ...res, link: buildStaffInviteUrl(res.token) })
    } catch (err) {
      setError(err?.code === 'conflict' ? t('staff.emailExists') : t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title={t('staff.invite')} description={result ? undefined : t('staff.inviteHint')} closeLabel={t('common.close')} className="sm:max-w-lg" dismissible={!busy}>
      {result ? (
        <div className="space-y-3" data-testid="invite-result">
          <p className="text-sm">{t('staff.inviteCreated', { email: result.email })}</p>
          <p className="rounded-input border border-accent bg-accent/15 p-2 text-xs text-foreground">{t('staff.inviteDeliveryNote')}</p>
          <label htmlFor="invite-link" className="block text-sm font-medium">{t('staff.inviteLink')}</label>
          <input id="invite-link" readOnly value={result.link} dir="ltr" onFocus={(e) => e.target.select()} className="min-h-11 w-full rounded-input border border-input bg-input-bg px-3 font-mono text-xs" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CopyLink value={result.link} label={t('staff.copyLink')} copiedLabel={t('staff.copied')} />
            <span className="text-xs text-muted-foreground">{t('staff.expires', { date: new Date(result.expires_at).toLocaleDateString() })}</span>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="invite-form">
          <Field label={t('auth.email')} type="email" inputMode="email" dir="ltr" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={error} data-autofocus />
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('staff.roles')}</legend>
            <RoleChecklist value={roles} onChange={setRoles} name="invite-roles" />
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('staff.programs')}</legend>
            <ProgramChecklist programs={programs} value={programIds} onChange={setProgramIds} name="invite-programs" />
          </fieldset>
          <Field as="select" label={t('staff.emailLanguage')} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button type="submit" loading={busy}>{t('staff.sendInvite')}</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
