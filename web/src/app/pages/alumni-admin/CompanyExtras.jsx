import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Copy, ExternalLink, GitMerge } from 'lucide-react'
import { useAlumniInvitations, useAlumniMutations } from '../../../data/alumni.js'
import { useAdminMutations } from '../../../data/alumniAdmin.js'
import { appBaseUrl } from '../../../lib/links.js'
import { useAuth } from '../../AuthContext.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Field } from '../../../ui/Field.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import { statusTone } from './adminLogic.js'
import { useAdminErrorText, useAdminFormat, useCopy } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'

/** Invite a founder to THIS company (the link is shown once; the e-mail is not sent by the platform) and the invitations already made for it. */
export function CompanyInvitations({ companyId }) {
  const { t, lang } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const fmt = useAdminFormat()
  const toast = useToast()
  const copy = useCopy()
  const errorText = useAdminErrorText()
  const { createInvitation } = useAlumniMutations()
  const list = useAlumniInvitations({ limit: 100 })
  const [email, setEmail] = useState('')
  const [language, setLanguage] = useState(lang)
  const [created, setCreated] = useState(null)
  const mine = (list.data?.rows ?? []).filter((r) => r.company_id === companyId)

  async function create(e) {
    e.preventDefault()
    try {
      const r = await createInvitation.mutateAsync({ companyId, email: email.trim(), language, appUrl: appBaseUrl() })
      setCreated({ email: r.email, link: r.link })
      toast.success(d('invCreated', { email: r.email }))
      setEmail('')
    } catch (err) {
      toast.error(errorText(err, { email: d('invEmail') }))
    }
  }

  return (
    <div className="space-y-4" data-testid="company-invitations">
      <p className="text-sm text-muted-foreground">{d('invDesc')}</p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <Field className="min-w-60 flex-1" type="email" dir="ltr" label={d('invEmail')} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <Field as="select" label={d('invLanguage')} value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="ar">{t('alumni.admin.common.arabic')}</option>
          <option value="en">{t('alumni.admin.common.english')}</option>
        </Field>
        <Button type="submit" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} loading={createInvitation.isPending}>{d('invCreate')}</Button>
      </form>
      {created && (
        <div className="space-y-1 rounded-card border border-primary/40 bg-primary/5 p-3" role="status">
          <p className="text-sm font-semibold">{d('invLinkOnce')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly dir="ltr" value={created.link} aria-label={created.email} onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-input border border-input bg-input-bg px-3 text-sm" />
            <Button size="sm" onClick={() => copy(created.link)}><Copy className="h-4 w-4" aria-hidden="true" />{d('invCopy')}</Button>
          </div>
        </div>
      )}
      {mine.length === 0 ? <p className="text-sm text-muted-foreground">{d('invNone')}</p> : (
        <ul className="divide-y rounded-card border">
          {mine.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span dir="ltr" className="font-semibold">{r.email}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">{fmt.date(r.sent_at)}<Badge tone={statusTone(r.effective_status)}>{t(`alumni.admin.common.invStatus.${r.effective_status}`)}</Badge></span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/alumni/admin/invitations" className="text-sm font-semibold text-primary hover:underline">{d('invSeeAll')}</Link>
    </div>
  )
}

/** Merge a duplicate INTO this company (`merge_companies`: founders, participation, yearly rows, notes and invitations move here, the duplicate is removed). Irreversible: confirmed. */
export function CompanyMerge({ company, onMerged }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { merge } = useAdminMutations()
  const keepName = pick(company, 'name')

  async function pickDuplicate(dup) {
    if (dup.id === company.id) { toast.warning(d('mergeSelf')); return }
    const dropName = pick(dup, 'name')
    const ok = await confirm({ title: d('mergeConfirmTitle', { drop: dropName, keep: keepName }), message: d('mergeConfirmBody', { drop: dropName, keep: keepName }), confirmLabel: d('mergeRun'), destructive: true })
    if (!ok) return
    try {
      await merge.mutateAsync({ keep: company.id, drop: dup.id })
      toast.success(d('merged'))
      onMerged?.()
    } catch (e) {
      toast.error(`${d('mergeFailed')} ${errorText(e)}`)
    }
  }
  return (
    <div className="space-y-3" data-testid="company-merge">
      <p className="flex items-start gap-2 text-sm text-muted-foreground"><GitMerge className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{d('mergeDesc')}</p>
      <CompanyPicker label={d('mergePick')} excludeIds={[company.id]} onSelect={pickDuplicate} />
    </div>
  )
}

/**
 * Certificates are NOT rebuilt here (the Certificates node and the public verifier exist): this block only LINKS to them. Everybody gets the verifier; staff who can open projects also get
 * the project of every participation whose support includes certification (the node lives on the project canvas).
 */
export function CertificateLinks({ programs = [] }) {
  const { t, pick } = useLanguage()
  const { areas } = useAuth()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const canOpenProjects = (areas ?? []).includes('staff')
  const withCertificates = programs.filter((p) => Array.isArray(p.support) && p.support.includes('certification') && p.project_id)
  return (
    <div className="space-y-2 rounded-card border bg-surface/50 p-4" data-testid="certificate-links">
      <p className="text-sm font-semibold">{d('certTitle')}</p>
      <p className="text-sm text-muted-foreground">{d('certBody')}</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/verify" target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm' })}><BadgeCheck className="h-4 w-4" aria-hidden="true" />{d('certVerify')}</Link>
        {canOpenProjects && withCertificates.map((p) => (
          <Link key={p.project_id} to={`/projects/${p.project_id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{d('certProject', { name: pick(p, 'project_name') })}</Link>
        ))}
      </div>
    </div>
  )
}
