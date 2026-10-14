import { useState } from 'react'
import { Copy, Link2, Mail, X } from 'lucide-react'
import { createAlumniInvitation, revokeAlumniInvitation, useAlumniInvitations } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { appBaseUrl } from '../../../lib/links.js'
import { isEmail } from '../../../lib/contact.js'
import { copyText } from '../../../lib/clipboard.js'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import './alumni.company.i18n.js'

/**
 * Invite a co-founder who has no account to join THIS company (design 09 F5, `create_alumni_invitation`): the invitation is for one e-mail address and one company, valid for
 * 14 days. The link is shown ONCE (only its hash is stored); the e-mail itself is not sent yet (the outbox worker does not exist), so the founder copies the link and sends it.
 * Pending invitations of this company are listed with Revoke.
 */
export default function CoFounderInvite({ companyId }) {
  const { t, lang, formatDate } = useLanguage()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const { refresh } = useAlumniRefresh()
  const pending = useAlumniInvitations({ status: 'pending', limit: 50 })
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null) // { link, email, expires_at } shown once
  const rows = (pending.data?.rows ?? []).filter((r) => r.company_id === companyId)

  async function create(e) {
    e.preventDefault()
    if (!isEmail(email)) { setError(t('alumni.founder.invite.emailInvalid')); return }
    setError(null)
    setBusy(true)
    try {
      const r = await createAlumniInvitation({ companyId, email: email.trim(), language: lang, appUrl: appBaseUrl() })
      setCreated({ link: r.link, email: r.email, expires_at: r.expires_at })
      setEmail('')
      await refresh()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (await copyText(created.link)) toast.success(t('alumni.founder.invite.copied'))
    else toast.warning(t('alumni.founder.invite.copyFailed'))
  }

  async function revoke(row) {
    try {
      await revokeAlumniInvitation(row.id)
      await refresh()
      toast.success(t('alumni.founder.invite.revoked'))
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <div className="space-y-3 rounded-card border border-dashed border-input p-4" data-testid="cofounder-invite">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold"><Mail className="h-4 w-4 text-primary" aria-hidden="true" />{t('alumni.founder.invite.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('alumni.founder.invite.desc')}</p>
      </div>
      <form onSubmit={create} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field className="flex-1" type="email" dir="ltr" inputMode="email" label={t('alumni.founder.invite.email')} value={email} error={error} onChange={(e) => { setEmail(e.target.value); setError(null) }} />
        <Button type="submit" loading={busy}>{t('alumni.founder.invite.create')}</Button>
      </form>
      {created && (
        <div role="status" className="space-y-2 rounded-input bg-success/10 p-3 text-sm" data-testid="invite-created">
          <p className="font-semibold">{t('alumni.founder.invite.createdTitle', { email: created.email })}</p>
          <p className="flex items-start gap-2"><Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span dir="ltr" className="min-w-0 break-all font-mono text-xs" data-testid="invite-link">{created.link}</span></p>
          <p className="text-xs text-muted-foreground">{t('alumni.founder.invite.createdNote', { date: formatDate(created.expires_at, { dateStyle: 'medium' }) })}</p>
          <Button variant="outline" size="sm" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.invite.copy')}</Button>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="space-y-1.5" data-testid="pending-invitations">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-input bg-surface/70 px-3 py-1.5 text-sm">
              <span dir="ltr" className="min-w-0 flex-1 truncate">{r.email}</span>
              <Badge tone="amber">{t('alumni.founder.invite.expiresOn', { date: formatDate(r.expires_at, { dateStyle: 'medium' }) })}</Badge>
              <Button variant="ghost" size="icon" aria-label={t('alumni.founder.invite.revoke', { email: r.email })} onClick={() => revoke(r)}><X className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
