import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Lock, RotateCcw, Send, Settings2 } from 'lucide-react'
import { listAlumniQuarterStatus, useAlumniQuarterStatus, useQuarterMutations } from '../../../data/alumniQuarters.js'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { SELECT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { FIGURE_STATUSES, daysLeft, isPeriod, periodFromIndex, periodIndex, periodLabel } from '../../../lib/alumniQuarters.js'
import { cn } from '../../../lib/cn.js'
import { FigureStatusBadge } from '../../../shared/alumni/FiguresPanel.jsx'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, CompanyLogo, KpiCard, Pagination } from './ui.jsx'
import AreaTabs from './AreaTabs.jsx'
import DirectoryFilters from './DirectoryFilters.jsx'
import SendRemindersDialog from './SendRemindersDialog.jsx'
import { mergeSearch, parseState, toRpcFilters } from './adminState.js'
import { useAdminErrorText, useDebounced, useLabels } from './hooks.js'
import './i18n.common.js'
import './area.i18n.js'
import './quarters.i18n.js'
import '../../../shared/alumni/i18n.quarters.js'
import '../../../shared/alumni/i18n.edit.js'

const PAGE = 50

/**
 * The QUARTER STATUS page (owner decision 21): for one quarter, every alumni company as confirmed / updated-not-confirmed / not-updated (or closed), when its figures were last modified,
 * who confirmed, how many reminders were sent; filters, a bulk "send a reminder to these", "close the quarter now", an Excel export. Reminders themselves are configured on the next page.
 */
export default function QuartersPage() {
  const { t, tn, lang, pick } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  const e = useEditText()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const labels = useLabels()
  const programs = useAlumniPrograms()
  const { closeQuarter, reopenQuarter } = useQuarterMutations()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const period = isPeriod(params.get('period')) ? params.get('period') : null
  const status = FIGURE_STATUSES.includes(params.get('status')) ? params.get('status') : null
  const rpcFilters = useMemo(() => toRpcFilters(state.filters), [state.filters])
  const [sending, setSending] = useState(null) // { onlyNew, scope }
  const [selection, setSelection] = useState({ key: '', ids: [] })
  const [exporting, setExporting] = useState(false)

  const query = useAlumniQuarterStatus({ period, filters: rpcFilters, status, limit: PAGE, offset: (state.page - 1) * PAGE, sort: 'status', dir: 'asc' })
  const data = query.data
  const key = data?.period?.key ?? period
  const rows = data?.rows ?? []

  const setExtra = (patch) => {
    const next = mergeSearch(params, state)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    next.delete('page')
    setParams(next, { replace: true })
  }
  const update = (patch) => setParams(mergeSearch(params, { ...state, ...patch }), { replace: true })
  const onFilters = (patch) => update({ filters: { ...state.filters, ...patch }, page: 1 })

  const [qText, setQText] = useState(state.filters.q ?? '')
  const [seenQ, setSeenQ] = useState(state.filters.q ?? '')
  if ((state.filters.q ?? '') !== seenQ) { setSeenQ(state.filters.q ?? ''); setQText(state.filters.q ?? '') }
  const debouncedQ = useDebounced(qText, 300)
  const commitSearch = useEffectEvent((v) => { if (v !== (state.filters.q ?? '')) onFilters({ q: v }) })
  useEffect(() => { commitSearch(debouncedQ) }, [debouncedQ])

  const selKey = JSON.stringify([rpcFilters, status, key])
  const selected = new Set(selection.key === selKey ? selection.ids : [])
  const setSelected = (ids) => setSelection({ key: selKey, ids: [...ids] })
  const toggle = (id) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n) }
  const pageIds = rows.filter((r) => r.status !== 'closed').map((r) => r.id)
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  const top = periodIndex(key)
  const options = top === null ? [] : Array.from({ length: 8 }, (_, n) => periodFromIndex(top - n)).filter(Boolean)
  const periodOptions = key && !options.includes(key) ? [key, ...options] : options
  const left = daysLeft(data?.period?.deadline)

  async function closeAll() {
    const ok = await confirm({ title: q('closeAllTitle', { quarter: periodLabel(key, lang) }), message: q('closeAllBody', { quarter: periodLabel(key, lang) }), confirmLabel: q('closeAllConfirm'), destructive: true })
    if (!ok) return
    try {
      const r = await closeQuarter.mutateAsync({ period: key, companyId: null })
      toast.success(r.already_frozen > 0 ? `${qn('closeAllDone', r.frozen)} (${qn('closeAllAlready', r.already_frozen)})` : qn('closeAllDone', r.frozen))
    } catch (err) { toast.error(errorText(err)) }
  }
  async function reopenAll() {
    const ok = await confirm({ title: q('reopenAllTitle', { quarter: periodLabel(key, lang) }), message: q('reopenAllBody'), confirmLabel: q('reopenAllConfirm'), destructive: true })
    if (!ok) return
    try {
      const r = await reopenQuarter.mutateAsync({ period: key, companyId: null })
      toast.success(qn('reopenAllDone', r.reopened))
    } catch (err) { toast.error(errorText(err)) }
  }
  async function exportXlsx() {
    setExporting(true)
    try {
      const all = []
      for (let off = 0; off < 5000; off += 500) {
        const r = await listAlumniQuarterStatus({ period: key, filters: rpcFilters, status, limit: 500, offset: off, sort: 'name', dir: 'asc' })
        all.push(...r.rows)
        if (r.rows.length < 500) break
      }
      const { exportRows } = await import('../../../lib/export/xlsx.js')
      const cols = [
        { header: q('col.company'), key: (r) => pick(r, 'name') },
        { header: q('col.status'), key: (r) => t(`alumni.q.status.${r.status}`) },
        { header: q('col.modified'), key: (r) => r.last_modified },
        { header: q('col.modifiedBy'), key: (r) => r.updated_by_name ?? r.updated_source },
        { header: q('col.confirmedAt'), key: (r) => r.confirmed_at },
        { header: q('col.confirmedBy'), key: (r) => r.confirmed_by_name },
        { header: q('col.reminders'), key: (r) => r.reminders?.count ?? 0 },
        { header: q('col.lastReminder'), key: (r) => r.reminders?.last_at },
        { header: q('col.closedAt'), key: (r) => r.snapshot?.frozen_at },
      ]
      await exportRows(all, cols, `quarter-status-${key}.xlsx`, { sheetName: key, blanks: true })
    } catch (err) { toast.error(errorText(err)) } finally { setExporting(false) }
  }

  const counts = data?.counts
  return (
    <AdminPage
      testId="alumni-admin-quarters"
      title={q('title')}
      subtitle={q('subtitle')}
      actions={(
        <>
          <Link to="/alumni/admin/quarters/reminders" className={buttonClass({ variant: 'outline', size: 'sm' })}><Settings2 className="h-4 w-4" aria-hidden="true" />{q('remindersLink')}</Link>
          <Button variant="outline" size="sm" className="min-h-11" onClick={exportXlsx} loading={exporting} disabled={!data || data.total === 0}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{q('export')}</Button>
          <Button size="sm" className="min-h-11" onClick={() => setSending({ onlyNew: true, scope: { filters: rpcFilters } })} disabled={!key || data?.period?.is_current === false} data-testid="send-now"><Send className="h-4 w-4" aria-hidden="true" />{q('sendNow')}</Button>
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setSending({ onlyNew: false, scope: { filters: rpcFilters } })} disabled={!key || data?.period?.is_current === false} data-testid="resend">{q('resend')}</Button>
        </>
      )}
    >
      <AreaTabs />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="qs-period" className={LABEL_CLASS}>{q('quarter')}</label>
          <select id="qs-period" className={cn(SELECT_CLASS, 'w-auto')} value={key ?? ''} onChange={(ev) => setExtra({ period: ev.target.value })} disabled={!key}>
            {periodOptions.map((p) => <option key={p} value={p}>{periodLabel(p, lang)}</option>)}
          </select>
        </div>
        {data && (
          <p className="pb-2 text-sm text-muted-foreground" data-testid="period-info">
            {data.period.is_current ? q('closesOn', { date: e.date(data.period.deadline) }) : q('closedPeriod', { date: e.date(data.period.deadline) })}
            {data.period.is_current && left !== null && left >= 0 ? ` · ${q('daysLeft', { days: left })}` : ''} · {q('tz', { zone: data.period.timezone === 'Africa/Cairo' ? q('zoneCairo') : data.period.timezone })}
          </p>
        )}
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="quarter-counts">
          {FIGURE_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setExtra({ status: status === s ? '' : s })} className={cn('rounded-card border p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', status === s ? 'border-foreground bg-surface' : 'bg-card hover:border-foreground')}>
              <KpiCard label={t(`alumni.q.status.${s}`)} value={counts[s]} hint={qn('ofTotal', counts.total)} />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SearchBar className="min-w-60 flex-1 sm:max-w-xs" label={q('search')} placeholder={q('searchPlaceholder')} value={qText} onChange={setQText} />
        <Button variant="outline" size="sm" className="min-h-11" onClick={closeAll} disabled={!key || !data || data.period.is_current === false && counts?.closed === counts?.total}><Lock className="h-4 w-4" aria-hidden="true" />{q('closeAll')}</Button>
        <Button variant="ghost" size="sm" className="min-h-11" onClick={reopenAll} disabled={!key || !counts?.closed}><RotateCcw className="h-4 w-4" aria-hidden="true" />{q('reopenAll')}</Button>
      </div>
      <DirectoryFilters filters={state.filters} onChange={onFilters} programs={programs.data?.programs ?? []} labels={labels} onClear={() => update({ filters: { scope: state.filters.scope }, page: 1 })} only={['program_id', 'sector', 'governorate', 'stage']} />

      {query.isPending ? <SkeletonList count={6} />
        : query.isError ? <ErrorState error={query.error} title={q('loadFailed')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <EmptyState title={q('empty')} body={q('emptyBody')} />
        : (
          <>
            <div role="region" aria-label={q('title')} className="overflow-x-auto rounded-card border bg-card" data-testid="quarter-table-wrap">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-surface text-xs font-bold text-athar-ink">
                  <tr>
                    <th scope="col" className="w-11 p-0"><label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={q('selectAll')} checked={allOn} onChange={() => setSelected(allOn ? [...selected].filter((id) => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])])} className="h-5 w-5 accent-[hsl(var(--primary))]" /></label></th>
                    {['company', 'status', 'modified', 'confirmed', 'reminders', 'founders'].map((c) => <th key={c} scope="col" className="px-3 py-2 text-start">{q(`col.${c}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const name = pick(r, 'name') || '—'
                    return (
                      <tr key={r.id} className="border-t align-top" data-testid="quarter-row" data-status={r.status}>
                        <td className="p-0"><label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={q('selectRow', { name })} checked={selected.has(r.id)} disabled={r.status === 'closed'} onChange={() => toggle(r.id)} className="h-5 w-5 accent-[hsl(var(--primary))]" /></label></td>
                        <td className="px-3 py-2"><span className="flex items-center gap-2"><CompanyLogo path={r.logo_path} size={28} /><Link to={`/alumni/admin/company/${r.id}#metrics`} className="font-semibold text-primary hover:underline">{name}</Link></span></td>
                        <td className="px-3 py-2">
                          <FigureStatusBadge status={r.status} />
                          {r.snapshot && <span className="mt-1 block text-[11px] text-muted-foreground">{q('closedOn', { date: e.date(r.snapshot.frozen_at) })}{r.snapshot.reported ? '' : ` · ${t('alumni.q.history.notReported')}`}{r.snapshot.corrected ? ` · ${t('alumni.q.history.corrected')}` : ''}</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">{r.last_modified ? <><span className="block tabular-nums">{e.dateTime(r.last_modified)}</span><span className="text-muted-foreground">{r.updated_by_name ?? e.sourceLabel(r.updated_source)}</span></> : <span className="text-muted-foreground">{t('alumni.q.form.neverModified')}</span>}</td>
                        <td className="px-3 py-2 text-xs">{r.confirmed_at ? <><span className="block tabular-nums">{e.dateTime(r.confirmed_at)}</span><span className="text-muted-foreground">{r.confirmed_by_name}</span></> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-3 py-2 text-xs">{r.reminders?.count ? <><Badge tone="outline">{q('remindersCount', { count: r.reminders.count })}</Badge><span className="mt-1 block text-muted-foreground tabular-nums">{e.date(r.reminders.last_at)}</span></> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-3 py-2 text-xs tabular-nums">{qn('foundersCell', r.founders?.total ?? 0, { acc: r.founders?.with_account ?? 0 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} page={state.page} size={PAGE} onPage={(p) => update({ page: p })} sizes={[PAGE]} />
          </>
        )}

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3" data-testid="quarter-selection">
          <p className="text-sm font-semibold" aria-live="polite">{q('selected', { count: selected.size })}</p>
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setSelected([])}>{q('clearSelection')}</Button>
            <Button onClick={() => setSending({ onlyNew: false, scope: { companyIds: [...selected] } })} data-testid="send-selected"><Send className="h-4 w-4" aria-hidden="true" />{q('sendToThese')}</Button>
          </div>
        </div>
      )}
      {sending && key && <SendRemindersDialog period={key} scope={sending.scope} onlyNew={sending.onlyNew} onClose={() => setSending(null)} />}
    </AdminPage>
  )
}
