import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Send, X } from 'lucide-react'
import { useAdminMutations, useAlumniBroadcasts, useAlumniPrograms, useAudiencePreview, useBroadcastRecipients, useFounderSearch, useOpportunities } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { joinList } from '../../../i18n/core.js'
import { Badge } from '../../../ui/Badge.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { AdminPage, Pagination, SectionCard, Segmented } from './ui.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import { BODY_MAX, TITLE_MAX, audienceKey, audienceReady, audienceToRpc, missingLanguage, readRate, validateMessage } from './adminLogic.js'
import { useAdminErrorText, useAdminFormat, useDebounced } from './hooks.js'
import './i18n.common.js'
import './notifications.i18n.js'

const KINDS = ['all', 'program', 'company', 'founder']
const PAGE = 10

function Chip({ label, onRemove, removeLabel, tag }) {
  return (
    <li className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-surface px-3 text-sm">
      <span>{label}</span>{tag}
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="-me-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </li>
  )
}

function FounderSearch({ chosen, onAdd, onRemove }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.notif.${k}`, v)
  const [text, setText] = useState('')
  const q = useFounderSearch(useDebounced(text, 300))
  const ids = new Set(chosen.map((f) => f.id))
  return (
    <div className="space-y-2">
      <SearchBar label={d('searchFounders')} placeholder={d('searchFounders')} value={text} onChange={setText} />
      {text.trim().length < 2 ? <p className="text-xs text-muted-foreground">{d('searchHint')}</p> : q.isPending ? <Skeleton className="h-10 w-full" /> : (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{d('noFounders')}</p> : (
        <ul className="divide-y rounded-card border">
          {q.data.filter((f) => !ids.has(f.id)).map((f) => (
            <li key={f.id} className="flex min-h-11 items-center justify-between gap-2 px-3 py-1">
              <span className="min-w-0 text-sm"><span className="font-semibold">{pick(f, 'name')}</span> <span className="text-xs text-muted-foreground" dir="ltr">{f.email}</span>{!f.auth_user_id && <Badge tone="outline" className="ms-2">{d('noAccountTag')}</Badge>}</span>
              <Button variant="outline" size="sm" onClick={() => onAdd(f)}>{d('add')}</Button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={d('founders')}>
          {chosen.map((f) => <Chip key={f.id} label={pick(f, 'name')} onRemove={() => onRemove(f.id)} removeLabel={d('removeChosen', { name: pick(f, 'name') })} tag={!f.auth_user_id ? <Badge tone="outline">{d('noAccountTag')}</Badge> : null} />)}
        </ul>
      )}
    </div>
  )
}

function Compose() {
  const { t, tn, lang, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.notif.${k}`, v)
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { sendNotification } = useAdminMutations()
  const programs = useAlumniPrograms()
  const [aud, setAud] = useState({ kind: 'all', programId: '', projectId: '', companies: [], founders: [] })
  const [params] = useSearchParams()
  const opportunities = useOpportunities({ enabled: Boolean(params.get('opportunity')) })
  const [detached, setDetached] = useState(false)
  const attached = detached ? null : (opportunities.data ?? []).find((o) => o.opportunity_id === params.get('opportunity')) ?? null
  const [msg, setMsg] = useState({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' })
  const [link, setLink] = useState('')
  // coming from an opportunity ("Notify the founders"): the title starts as the opportunity's, once
  const [seeded, setSeeded] = useState(null)
  if (attached && seeded !== attached.opportunity_id) {
    setSeeded(attached.opportunity_id)
    setMsg((m) => ({ ...m, titleEn: m.titleEn || attached.title_en || '', titleAr: m.titleAr || attached.title_ar || '' }))
  }
  const [touched, setTouched] = useState(false)
  const ready = audienceReady(aud)
  const rpc = ready ? audienceToRpc(aud) : null
  const preview = useAudiencePreview(rpc, audienceKey(aud), { enabled: ready })
  const errors = validateMessage(msg)
  const hasErrors = Object.keys(errors).length > 0
  const program = (programs.data?.programs ?? []).find((p) => p.id === aud.programId)
  const missing = missingLanguage(msg)
  const set = (patch) => setAud((a) => ({ ...a, ...patch }))

  async function send() {
    setTouched(true)
    if (hasErrors || !ready) return
    const count = preview.data?.recipients ?? 0
    if (count === 0) return
    const ok = await confirm({ title: d('sendTitle'), message: tn('alumni.admin.notif.sendBody', count), confirmLabel: d('send'), destructive: false })
    if (!ok) return
    try {
      const r = await sendNotification.mutateAsync({ audience: rpc, ...msg, link: link.trim(), opportunityId: attached?.opportunity_id ?? null })
      toast.success(tn('alumni.admin.notif.sent', r.recipients))
      setMsg({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' })
      setLink('')
      setDetached(true)
      setTouched(false)
    } catch (e) {
      toast.error(`${d('sendFailed')} ${errorText(e, { title: d('messageTitle'), body: d('messageBody'), audience: d('audience'), link: d('linkLabel') })}`)
    }
  }

  return (
    <SectionCard id="compose" title={d('compose')} testId="compose">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold" id="aud-label">{d('audience')}</p>
          <Segmented label={d('audience')} value={aud.kind} onChange={(kind) => set({ kind })} options={KINDS.map((k) => ({ value: k, label: d(`aud.${k}`) }))} />
          {aud.kind === 'program' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field as="select" label={d('program')} value={aud.programId} onChange={(e) => set({ programId: e.target.value, projectId: '' })}>
                <option value="">{d('pickProgram')}</option>
                {(programs.data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{pick(p, 'name')}</option>)}
              </Field>
              <Field as="select" label={d('project')} value={aud.projectId} disabled={!program} onChange={(e) => set({ projectId: e.target.value })}>
                <option value="">{d('allProjects')}</option>
                {(program?.projects ?? []).map((j) => <option key={j.id} value={j.id}>{pick(j, 'name')}</option>)}
              </Field>
            </div>
          )}
          {aud.kind === 'company' && (
            <div className="space-y-2">
              <CompanyPicker label={d('companies')} excludeIds={aud.companies.map((c) => c.id)} onSelect={(c) => set({ companies: [...aud.companies, c] })} />
              {aud.companies.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={d('addedCompanies')}>{aud.companies.map((c) => <Chip key={c.id} label={pick(c, 'name')} removeLabel={d('removeChosen', { name: pick(c, 'name') })} onRemove={() => set({ companies: aud.companies.filter((x) => x.id !== c.id) })} />)}</ul>}
            </div>
          )}
          {aud.kind === 'founder' && <FounderSearch chosen={aud.founders} onAdd={(f) => set({ founders: [...aud.founders, f] })} onRemove={(id) => set({ founders: aud.founders.filter((f) => f.id !== id) })} />}
          <div aria-live="polite" className="min-h-6 text-sm" data-testid="audience-preview">
            {!ready ? <span className="text-muted-foreground">{d('audienceNeeded')}</span>
              : preview.isPending ? <span className="text-muted-foreground">{t('common.loading')}</span>
              : preview.isError ? <span className="text-destructive-text">{d('previewFailed')} {errorText(preview.error)}</span>
              : preview.data.recipients === 0 ? <span className="font-semibold text-destructive-text">{d('reachNone')}</span>
              : (
                <>
                  <span className="font-semibold">{tn('alumni.admin.notif.reach', preview.data.recipients)}</span>
                  {preview.data.without_account > 0 && <span className="text-muted-foreground"> {tn('alumni.admin.notif.skipped', preview.data.without_account)}</span>}
                  {preview.data.sample?.length > 0 && <span className="block text-xs text-muted-foreground">{d('sample', { names: joinList(lang, preview.data.sample.map((s) => pick(s, 'name'))) })}</span>}
                </>
              )}
          </div>
        </div>

        <div className="space-y-3">
          <BilingualField label={d('messageTitle')} required value={{ en: msg.titleEn, ar: msg.titleAr }} onChange={(v) => setMsg((m) => ({ ...m, titleEn: v.en, titleAr: v.ar }))} error={touched && errors.title ? d(`err.title.${errors.title}`) : null} />
          <p className="text-xs text-muted-foreground">{d('titleCount', { count: Math.max(msg.titleEn.length, msg.titleAr.length), max: TITLE_MAX })}</p>
          <BilingualField label={d('messageBody')} required as="textarea" rows={5} value={{ en: msg.bodyEn, ar: msg.bodyAr }} onChange={(v) => setMsg((m) => ({ ...m, bodyEn: v.en, bodyAr: v.ar }))} error={touched && errors.body ? d(`err.body.${errors.body}`) : null} />
          <p className="text-xs text-muted-foreground">{d('bodyCount', { count: Math.max(msg.bodyEn.length, msg.bodyAr.length), max: BODY_MAX })}</p>
          <Field type="text" dir="ltr" label={d('linkLabel')} hint={d('linkHint')} placeholder="/alumni/founder/opportunities" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} />
          {attached && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
              <span><span className="font-semibold">{d('attached', { title: pick(attached, 'title') })}</span> <span className="text-muted-foreground">{d('attachedHint')}</span></span>
              <Button variant="ghost" size="sm" onClick={() => setDetached(true)}>{d('detach')}</Button>
            </p>
          )}
          <p className="text-xs text-muted-foreground">{d('languageNote')}</p>
          {missing && <p className="text-xs font-semibold" role="status">{d(missing === 'en' ? 'missingEn' : 'missingAr')}</p>}
        </div>

        {!hasErrors && (
          <div className="rounded-card border bg-surface/50 p-4" aria-label={d('previewHeading')} role="group">
            <p className="mb-2 text-sm font-semibold">{d('previewHeading')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {[['ar', msg.titleAr || msg.titleEn, msg.bodyAr || msg.bodyEn], ['en', msg.titleEn || msg.titleAr, msg.bodyEn || msg.bodyAr]].map(([l, title, body]) => (
                <div key={l} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{d(l === 'ar' ? 'previewAr' : 'previewEn')}</p>
                  <p className="font-semibold">{title || d('previewEmpty')}</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{body || d('previewEmpty')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={send} loading={sendNotification.isPending} disabled={!ready || (preview.data && preview.data.recipients === 0)} data-testid="send-notification"><Send className="h-4 w-4" aria-hidden="true" />{d('send')}</Button>
        </div>
      </div>
    </SectionCard>
  )
}

function audienceLabel(b, d, pick) {
  const name = pick({ name_en: b.target_name_en, name_ar: b.target_name_ar }, 'name')
  switch (b.audience_type) {
    case 'all': return d('toAll')
    case 'program': return name ? d('toProgram', { name }) : d('toProgramGeneric')
    case 'company': return name ? d('toCompany', { name }) : d('toCompanies')
    case 'founder': return name ? d('toFounder', { name }) : d('toFounders')
    default: return b.audience_type
  }
}

function Recipients({ id }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.notif.${k}`, v)
  const q = useBroadcastRecipients(id)
  if (q.isPending) return <Skeleton className="h-16 w-full" />
  if (q.isError) return <ErrorState error={q.error} title={d('recipientsFailed')} onRetry={() => q.refetch()} />
  return (
    <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {q.data.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
          <span className="min-w-0 truncate">{r.founder ? pick(r.founder, 'name') : '—'}</span>
          <Badge tone={r.is_read ? 'green' : 'outline'}>{d(r.is_read ? 'readTag' : 'unreadTag')}</Badge>
        </li>
      ))}
    </ul>
  )
}

function History() {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.notif.${k}`, v)
  const fmt = useAdminFormat()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useAlumniBroadcasts({ limit: PAGE, offset: (page - 1) * PAGE })
  return (
    <SectionCard id="history" title={d('history')} testId="history">
      {q.isPending ? <SkeletonList count={3} itemClassName="h-16 w-full" />
        : q.isError ? <ErrorState error={q.error} title={d('historyFailed')} onRetry={() => q.refetch()} />
        : q.data.rows.length === 0 ? <EmptyState title={d('historyEmpty')} />
        : (
          <>
            <ul className="divide-y rounded-card border">
              {q.data.rows.map((b) => {
                const pct = readRate(b.reads, b.recipients)
                const isOpen = open === b.broadcast_id
                return (
                  <li key={b.broadcast_id} className="space-y-2 px-4 py-3" data-testid="broadcast">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{pick(b, 'title')}</p>
                        <p className="text-xs text-muted-foreground"><bdi>{d('to', { audience: audienceLabel(b, d, pick) })}</bdi> · <bdi>{d('sentOn', { date: fmt.dateTime(b.sent_at) })}</bdi>{b.sent_by && <> · <bdi>{d('sentBy', { name: b.sent_by })}</bdi></>}</p>
                      </div>
                      <div className="w-44 shrink-0">
                        <p className="text-sm font-semibold tabular-nums">{d('read', { reads: fmt.num(b.reads), recipients: fmt.num(b.recipients) })}</p>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={d('readPercent', { percent: pct })}><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                      </div>
                    </div>
                    <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{pick(b, 'body')}</p>
                    <Button variant="ghost" size="sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.broadcast_id)}>
                      {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}{isOpen ? d('hideRecipients') : d('showRecipients')}
                    </Button>
                    {isOpen && <Recipients id={b.broadcast_id} />}
                  </li>
                )
              })}
            </ul>
            <Pagination className="mt-3" total={q.data.total} page={page} size={PAGE} onPage={setPage} />
          </>
        )}
    </SectionCard>
  )
}

/** M5: compose and send an in-app notification (the audience is resolved on the server, one row per recipient, plain text) and watch who read it. */
export default function NotificationsPage() {
  const { t } = useLanguage()
  return (
    <AdminPage testId="alumni-admin-notifications" title={t('alumni.admin.notif.title')} subtitle={t('alumni.admin.notif.subtitle')}>
      <Compose />
      <History />
    </AdminPage>
  )
}
