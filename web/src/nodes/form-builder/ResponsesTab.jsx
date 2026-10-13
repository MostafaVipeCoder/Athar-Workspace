import { useMemo, useState } from 'react'
import { BarChart3, Copy, Download, ExternalLink, Trash2 } from 'lucide-react'
import './i18n.js'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { signedFileUrl, useFormEvents, useFormResponses } from '../../data/forms.js'
import { exportRows } from '../../lib/export/xlsx.js'
import { formatInTz } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { SOCIAL_PLATFORMS, countsBy, countsByDay, formatAnswer, responseColumns, responseDisplay, responseMatches, withSource } from './formLogic.js'

const STATUSES = ['submitted', 'reviewed', 'spam']
const STATUS_TONE = { submitted: 'blue', reviewed: 'green', spam: 'red' }
const selectCls = 'min-h-9 rounded-md border border-input bg-background px-2 text-sm'

function StatusSelect({ value, onChange, t, label, disabled }) {
  return (
    <select aria-label={label} value={value ?? 'submitted'} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      {STATUSES.map((s) => <option key={s} value={s}>{t(`form.responses.status.${s}`)}</option>)}
    </select>
  )
}

function Bars({ data, label }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label={label}>
        {data.map((d) => <div key={d.date} title={`${d.date}: ${d.count}`} className={cn('flex-1 rounded-t', d.count ? 'bg-primary' : 'bg-muted')} style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />)}
      </div>
    </div>
  )
}

function CountList({ rows, label, t, keyLabel = (k) => k }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">-</p> : (
        <ul className="space-y-0.5 text-sm">{rows.slice(0, 8).map((r) => <li key={r.key} className="flex justify-between gap-2"><span className="truncate">{keyLabel(r.key, t)}</span><span className="font-medium tabular-nums">{r.count}</span></li>)}</ul>
      )}
    </div>
  )
}

function FileLink({ path, t }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (/^https?:\/\//i.test(path)) return <a href={path} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('form.responses.file')}</a>
  return (
    <Button variant="link" size="sm" className="px-0" loading={busy} onClick={async () => {
      setBusy(true)
      try {
        const url = await signedFileUrl(path)
        if (url) window.open(url, '_blank', 'noopener')
      } catch { toast.error(t('form.responses.fileFailed')) } finally { setBusy(false) }
    }}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('form.responses.file')}</Button>
  )
}

/**
 * Responses tab of the builder (as-is FormResponsesTab + Analytics + Clicks tabs, docs/04 sections 5.6-5.8): table with
 * search/source/status filters, per-response drawer, status workflow (submitted/reviewed/spam), delete with confirm +
 * Undo (soft delete), Excel export (lib/export/xlsx), source-tracking links, counts per day/source/status and the
 * form_view/form_share clicks of node_events.
 */
export function ResponsesTab({ node, questions, tz, publicUrl, social, mutations: m, initialOpenId = null }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const responses = useFormResponses(node.id)
  const events = useFormEvents(node.id)
  const [term, setTerm] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [openedInitial, setOpenedInitial] = useState(false)

  const rows = useMemo(() => responses.data ?? [], [responses.data])
  // deep link (?response=<id>, e.g. "open original response" from a Selection stage): open the drawer once the rows are in
  if (initialOpenId && !openedInitial && responses.data) {
    setOpenedInitial(true)
    const r = rows.find((x) => x.id === initialOpenId)
    if (r) setOpen(r)
  }
  const sources = useMemo(() => countsBy(rows, (r) => r.source), [rows])
  const filtered = useMemo(() => rows.filter((r) => (!source || (r.source || 'direct') === source) && (!status || r.status === status) && responseMatches(r, term)), [rows, source, status, term])
  const perDay = useMemo(() => countsByDay(rows, { days: 30, tz }), [rows, tz])
  const last7 = perDay.slice(-7).reduce((a, d) => a + d.count, 0)
  const today = perDay[perDay.length - 1]?.count ?? 0
  const byStatus = useMemo(() => countsBy(rows, (r) => r.status, 'submitted'), [rows])
  const views = (events.data ?? []).filter((e) => e.event_type === 'form_view').length
  const shares = useMemo(() => countsBy((events.data ?? []).filter((e) => e.event_type === 'form_share'), (e) => e.platform, 'copy'), [events.data])
  const channels = [...SOCIAL_PLATFORMS.filter((p) => social?.[p]).map((p) => ({ key: p, label: t(`form.social.${p}`) })), ...(social?.custom ?? []).filter((c) => c.active).map((c) => ({ key: c.key, label: c.label || c.key }))]

  /** Runs a mutation with toast feedback; resolves to true on success, false on error (the error is shown). */
  async function run(fn, success) {
    try {
      await fn()
      if (success) toast.success(success)
      return true
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return false
    }
  }
  const setRowStatus = (r, s) => run(() => m.setStatus.mutateAsync({ id: r.id, status: s }), t('form.responses.statusSet'))
  async function remove(r) {
    if (!(await confirm({ title: t('form.responses.deleteTitle'), message: t('form.responses.deleteBody'), destructive: true }))) return
    if (!(await run(() => m.remove.mutateAsync({ id: r.id })))) return
    setOpen(null)
    toast.success(t('form.responses.deleted'), { action: { label: t('form.responses.undo'), onClick: () => run(() => m.restore.mutateAsync({ id: r.id }), t('form.responses.restored')) } })
  }
  const exportAll = () => run(async () => {
    const n = await exportRows(filtered, responseColumns(questions, lang, t, { tz }), `${node.name_en || node.name_ar || 'form'}-responses`)
    toast.success(t('form.responses.exported', { count: n }))
  })
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast.success(t('form.settings.copied')) } catch { toast.info(url) }
  }

  if (responses.isPending) return <Loading />
  if (responses.error) return <ErrorState error={responses.error} onRetry={responses.refetch} title={t('form.responses.loadFailed')} />

  return (
    <div className="space-y-4" data-testid="responses-tab">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['totalLabel', rows.length], ['last7', last7], ['today', today]].map(([k, v]) => (
          <div key={k} className="rounded-md border p-2"><p className="text-xl font-bold tabular-nums">{v}</p><p className="text-xs text-muted-foreground">{t(`form.responses.${k}`)}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBar value={term} onChange={setTerm} label={t('form.responses.search')} className="min-w-48 flex-1" />
        <select aria-label={t('form.responses.col.source')} value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
          <option value="">{t('form.responses.filter.all')}</option>
          {sources.map((s) => <option key={s.key} value={s.key}>{s.key} ({s.count})</option>)}
        </select>
        <select aria-label={t('form.responses.filter.status')} value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">{t('form.responses.filter.anyStatus')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`form.responses.status.${s}`)}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => setShowAnalytics((v) => !v)} aria-expanded={showAnalytics}><BarChart3 className="h-4 w-4" aria-hidden="true" />{t('form.responses.analytics')}</Button>
        <Button size="sm" variant="outline" onClick={exportAll} disabled={!filtered.length}><Download className="h-4 w-4" aria-hidden="true" />{t('form.responses.export')}</Button>
      </div>

      {showAnalytics && (
        <section className="grid gap-4 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="responses-analytics">
          <div className="sm:col-span-2"><Bars data={perDay} label={t('form.responses.perDay')} /></div>
          <CountList rows={sources} label={t('form.responses.bySource')} t={t} />
          <CountList rows={byStatus} label={t('form.responses.byStatus')} t={t} keyLabel={(k) => t(`form.responses.status.${k}`)} />
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">{t('form.responses.clicks')}</p>
            {events.isPending ? <Loading /> : views + shares.length === 0 ? <p className="text-xs text-muted-foreground">{t('form.responses.noClicks')}</p> : (
              <p className="text-sm">{views} {t('form.responses.views')} · {shares.reduce((a, s) => a + s.count, 0)} {t('form.responses.shares')} {shares.length > 0 && <span className="text-muted-foreground">({shares.map((s) => `${s.key} ${s.count}`).join(', ')})</span>}</p>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-4" data-testid="source-links">
            <p className="text-xs font-medium text-muted-foreground">{t('form.responses.sourceLinks')}</p>
            <p className="text-xs text-muted-foreground">{t('form.responses.sourceLinksHint')}</p>
            {publicUrl && (
              <ul className="grid gap-1 sm:grid-cols-2">
                {channels.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 truncate">{c.label}</span>
                    <code dir="ltr" className="min-w-0 flex-1 truncate rounded-xs bg-surface px-1 text-xs">{withSource(publicUrl, c.key)}</code>
                    <Button size="sm" variant="ghost" aria-label={`${t('form.settings.copyLink')}: ${c.label}`} onClick={() => copy(withSource(publicUrl, c.key))}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {rows.length === 0 ? <EmptyState title={t('form.responses.empty')} body={t('form.responses.emptyBody')} /> : filtered.length === 0 ? <EmptyState title={t('common.empty')} /> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-start text-xs font-semibold text-athar-ink">
              <tr>
                <th className="p-2 text-start">{t('form.responses.col.submitted')}</th>
                <th className="p-2 text-start">{t('form.responses.col.title')}</th>
                <th className="p-2 text-start">{t('form.responses.col.source')}</th>
                <th className="p-2 text-start">{t('form.responses.col.status')}</th>
                <th className="p-2 text-start"><span className="sr-only">{t('form.responses.col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const d = responseDisplay(r.answers, questions)
                return (
                  <tr key={r.id} className="border-t" data-testid="response-row">
                    <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">{formatInTz(r.submitted_at, tz, lang)}</td>
                    <td className="p-2">
                      <button type="button" className="text-start hover:underline" onClick={() => setOpen(r)}>
                        <span className="block font-medium" dir="auto">{d.title || '-'}</span>
                        <span className="block text-xs text-muted-foreground" dir="auto">{[d.subtitle, d.email].filter(Boolean).join(' · ')}</span>
                      </button>
                    </td>
                    <td className="p-2"><Badge tone="outline">{r.source || 'direct'}</Badge></td>
                    <td className="p-2"><StatusSelect value={r.status} onChange={(s) => setRowStatus(r, s)} t={t} label={`${t('form.responses.col.status')}: ${d.title}`} /></td>
                    <td className="p-2 text-end">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>{t('form.responses.open')}</Button>
                        <Button size="icon" variant="ghost" className="text-destructive" aria-label={`${t('form.responses.delete')}: ${d.title}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={responseDisplay(open.answers, questions).title || t('form.responses.drawer')} description={formatInTz(open.submitted_at, tz, lang)} closeLabel={t('common.close')} className="sm:max-w-2xl"
          footer={<>
            <StatusSelect value={open.status} onChange={(s) => { setRowStatus(open, s); setOpen({ ...open, status: s }) }} t={t} label={t('form.responses.col.status')} />
            <Button variant="destructive" size="sm" onClick={() => remove(open)}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('form.responses.delete')}</Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(null)}>{t('common.close')}</Button>
          </>}
        >
          <dl className="space-y-3 text-sm" data-testid="response-drawer">
            {questions.map((q) => {
              const v = open.answers?.[q.key]
              return (
                <div key={q.id} className="grid gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground" dir="auto">{(lang === 'ar' ? q.label.ar || q.label.en : q.label.en || q.label.ar) || q.key}</dt>
                  <dd className="whitespace-pre-line break-words" dir="auto">{q.type === 'file' && v ? <FileLink path={String(v)} t={t} /> : formatAnswer(q, v, lang) || t('form.responses.noAnswer')}</dd>
                </div>
              )
            })}
            {Object.entries(open.answers ?? {}).filter(([k]) => !questions.some((q) => q.key === k)).map(([k, v]) => (
              <div key={k} className="grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">{k}</dt><dd className="break-words" dir="auto">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
            ))}
            <div className="grid gap-0.5 border-t pt-2">
              <dt className="text-xs font-medium text-muted-foreground">{t('form.responses.tracking')}</dt>
              <dd className="text-xs text-muted-foreground" dir="ltr">{[['source', open.source || 'direct'], ...Object.entries(open.tracking ?? {}).filter(([k]) => k !== 'source')].map(([k, v]) => `${k}=${v}`).join(' · ')}</dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  )
}
