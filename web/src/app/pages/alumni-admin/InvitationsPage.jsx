import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Info, RefreshCw, Trash2 } from 'lucide-react'
import { useAlumniInvitations, useAlumniMutations } from '../../../data/alumni.js'
import { useAlumniOverview } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { appBaseUrl } from '../../../lib/links.js'
import { AdminPage, Pagination, SectionCard, Segmented } from './ui.jsx'
import InviteCreate from './InviteCreate.jsx'
import { STATUS_TABS, invitationsAsTsv, statusTone } from './adminLogic.js'
import { useAdminErrorText, useAdminFormat, useCopy } from './hooks.js'
import './i18n.common.js'
import './invitations.i18n.js'

const PAGE_SIZE = 25

/** The links just created: shown ONCE (only a hash is stored). Each has its own copy button; "copy all" gives a tab-separated list for a mail merge. */
function CreatedLinks({ items, failed, onDismiss }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.inv.${k}`, v)
  const copy = useCopy()
  if (items.length === 0 && failed.length === 0) return null
  return (
    <SectionCard id="created" title={d('createdTitle')} description={d('createdBody')} testId="created-links" className="border-primary/40"
      action={<div className="flex gap-2">{items.length > 1 && <Button variant="outline" size="sm" onClick={() => copy(invitationsAsTsv(items))}><Copy className="h-4 w-4" aria-hidden="true" />{d('copyAll')}</Button>}<Button size="sm" onClick={onDismiss}>{d('dismiss')}</Button></div>}>
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="space-y-1">
            <p className="text-sm font-semibold"><span dir="ltr">{i.email}</span> <span className="font-normal text-muted-foreground">· {i.companyName}</span></p>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly dir="ltr" value={i.link} aria-label={d('linkOf', { email: i.email })} onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-input border border-input bg-input-bg px-3 text-sm" />
              <Button variant="primary" size="sm" onClick={() => copy(i.link)} aria-label={`${d('copyLink')}: ${i.email}`}><Copy className="h-4 w-4" aria-hidden="true" />{d('copyLink')}</Button>
            </div>
          </li>
        ))}
        {failed.map((f) => (
          <li key={f.line} className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><span dir="ltr" className="font-semibold">{f.email}</span> — {f.failure}</li>
        ))}
      </ul>
    </SectionCard>
  )
}

export default function InvitationsPage() {
  const { t, tn, lang, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.inv.${k}`, v)
  const fmt = useAdminFormat()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { createInvitation, revokeInvitation } = useAlumniMutations()
  const overview = useAlumniOverview()
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [term, setTerm] = useState('')
  const [created, setCreated] = useState({ items: [], failed: [] })
  const list = useAlumniInvitations({ status: status === 'all' ? null : status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  const counts = overview.data?.invitations
  const rows = useMemo(() => {
    const q = term.trim().toLowerCase()
    return (list.data?.rows ?? []).filter((r) => !q || r.email.toLowerCase().includes(q) || `${r.company_name_en ?? ''} ${r.company_name_ar ?? ''}`.toLowerCase().includes(q))
  }, [list.data, term])

  const onCreated = (items, failed = []) => setCreated((c) => ({ items: [...items, ...c.items], failed }))

  async function resend(r) {
    if (r.effective_status === 'pending') {
      const ok = await confirm({ title: d('resendTitle', { email: r.email }), message: d('resendBody'), confirmLabel: d('resend') })
      if (!ok) return
    }
    try {
      const x = await createInvitation.mutateAsync({ companyId: r.company_id, email: r.email, language: lang, appUrl: appBaseUrl() })
      onCreated([{ id: x.id, email: x.email, companyName: pick(r, 'company_name'), companyId: r.company_id, link: x.link }])
      toast.success(d('resent', { email: r.email }))
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }
  async function revoke(r) {
    const ok = await confirm({ title: d('revokeTitle'), message: d('revokeBody', { email: r.email }), confirmLabel: d('revoke'), destructive: true })
    if (!ok) return
    try {
      await revokeInvitation.mutateAsync(r.id)
      toast.success(d('revoked'))
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }

  return (
    <AdminPage testId="alumni-admin-invitations" title={d('title')} subtitle={d('subtitle')}>
      <div role="note" className="flex items-start gap-3 rounded-card border border-accent bg-accent/25 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{d('noEmailTitle')}</p>
          <p className="text-sm">{d('noEmailBody')}</p>
        </div>
      </div>

      <CreatedLinks items={created.items} failed={created.failed} onDismiss={() => setCreated({ items: [], failed: [] })} />
      <InviteCreate onCreated={onCreated} />

      <SectionCard id="list" title={d('list')} testId="invitation-list" action={<p className="text-xs text-muted-foreground">{d('noLinkLater')}</p>}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented label={d('status')} value={status} onChange={(s) => { setStatus(s); setPage(1) }}
            options={STATUS_TABS.map((s) => ({ value: s, label: d(`tab.${s}`), count: counts ? (s === 'all' ? counts.total : counts[s]) : undefined }))} />
          <SearchBar className="min-w-60 flex-1 sm:max-w-xs" label={d('searchPage')} placeholder={d('searchPage')} value={term} onChange={setTerm} />
        </div>
        {list.isPending ? (
          <SkeletonList count={3} itemClassName="h-14 w-full" />
        ) : list.isError ? (
          <ErrorState error={list.error} title={d('loadFailed')} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={term ? d('emptyFiltered') : d('empty')} />
        ) : (
          <>
            <ul className="divide-y rounded-card border" data-testid="invitations">
              {rows.map((r) => (
                <li key={r.id} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto_minmax(0,1.4fr)_auto]" data-status={r.effective_status}>
                  <p className="truncate text-sm font-semibold" dir="ltr" title={r.email}>{r.email}</p>
                  <p className="min-w-0 text-sm"><Link to={`/alumni/admin/company/${r.company_id}`} className="inline-flex min-h-11 max-w-full items-center truncate text-primary hover:underline" aria-label={d('openCompany', { name: pick(r, 'company_name') })}>{pick(r, 'company_name')}</Link></p>
                  <div><Badge tone={statusTone(r.effective_status)}>{t(`alumni.admin.common.invStatus.${r.effective_status}`)}</Badge></div>
                  <p className="text-xs text-muted-foreground">
                    {d('colSent')}: {fmt.date(r.sent_at)}
                    <br />{r.effective_status === 'accepted' ? `${d('colAccepted')}: ${fmt.date(r.accepted_at)}` : `${d('colExpires')}: ${fmt.date(r.expires_at)}`}
                  </p>
                  <div className="flex flex-wrap justify-end gap-1">
                    {r.effective_status !== 'accepted' && (
                      <Button variant="outline" size="sm" onClick={() => resend(r)} disabled={createInvitation.isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" />{d('resend')}</Button>
                    )}
                    {r.effective_status === 'pending' && (
                      <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => revoke(r)} disabled={revokeInvitation.isPending}><Trash2 className="h-4 w-4" aria-hidden="true" />{d('revoke')}</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination className="mt-3" total={list.data.total} page={page} size={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </SectionCard>
      <p className="sr-only" aria-live="polite">{tn('alumni.admin.inv.lineCount', rows.length)}</p>
    </AdminPage>
  )
}
