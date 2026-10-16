import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, FileSpreadsheet, Send, Settings2 } from 'lucide-react'
import { listClosedFollowups, useClosedFollowups } from '../../../data/alumniClosed.js'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { SELECT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { CLOSED_TYPES, answerHeadline } from '../../../lib/alumniClosed.js'
import { cn } from '../../../lib/cn.js'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, CompanyLogo, KpiCard, Pagination } from './ui.jsx'
import AreaTabs from './AreaTabs.jsx'
import DirectoryFilters from './DirectoryFilters.jsx'
import SendRemindersDialog from './SendRemindersDialog.jsx'
import { mergeSearch, parseState, toRpcFilters } from './adminState.js'
import { useAdminErrorText, useDebounced, useLabels } from './hooks.js'
import './i18n.common.js'
import './area.i18n.js'
import './closed.i18n.js'
import '../../../shared/alumni/i18n.closed.js'
import '../../../shared/alumni/i18n.edit.js'

const PAGE = 50
const STATUSES = ['answered', 'not_answered']
const SORTS = ['name', 'answered', 'closed', 'type']

/** A web address only when it is http(s) (the server stores nothing else; the check keeps a stale value from ever becoming a `javascript:` link). */
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) ? u : null)

/** The details of one answer as short labelled lines. */
function Details({ answer, labels }) {
  const { t } = useLanguage()
  const d = (k) => t(`alumni.admin.cl.detail.${k}`)
  if (!answer) return <span className="text-muted-foreground">-</span>
  const field = answer.field ? labels.label('sector', answer.field) : ''
  const url = safeUrl(answer.venture_url)
  if (answer.answer_type === 'new_startup') {
    return (
      <div className="space-y-0.5">
        <p className="font-semibold" dir="auto">{answer.venture_name}</p>
        {field && <p className="text-xs"><span className="text-muted-foreground">{d('field')}: </span>{field}</p>}
        {answer.venture_stage && <p className="text-xs"><span className="text-muted-foreground">{d('stage')}: </span>{labels.label('stage', answer.venture_stage)}</p>}
        {url && <p className="text-xs"><a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex items-center gap-1 break-all text-primary hover:underline">{url.replace(/^https?:\/\//i, '')}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a></p>}
        {answer.venture_description && <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{answer.venture_description}</p>}
      </div>
    )
  }
  if (answer.answer_type === 'employed') {
    return (
      <div className="space-y-0.5">
        <p className="font-semibold" dir="auto">{answer.employer}</p>
        <p className="text-xs"><span className="text-muted-foreground">{d('role')}: </span><span dir="auto">{answer.job_title}</span></p>
        {field && <p className="text-xs"><span className="text-muted-foreground">{d('field')}: </span>{field}</p>}
      </div>
    )
  }
  return <p className="line-clamp-3 text-xs" dir="auto">{answerHeadline(answer, 200)}</p>
}

/**
 * /alumni/admin/closed: the CLOSED-COMPANY FOLLOW-UP (owner decision 22). Every closed alumni company with the founder's latest answer to "What are you doing now?" (new venture / employed / other),
 * the venture or the employer, whether the founder wants to join Athar programs, when he answered; counts that are filters, a "not answered yet" filter, the directory filters, an Excel export
 * and a button that reminds exactly these founders (the closed wording of the reminder).
 */
export default function ClosedFollowupPage() {
  const { t, pick } = useLanguage()
  const c = (k, v) => t(`alumni.admin.cl.${k}`, v)
  const e = useEditText()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const labels = useLabels()
  const programs = useAlumniPrograms()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const status = STATUSES.includes(params.get('status')) ? params.get('status') : null
  const type = CLOSED_TYPES.includes(params.get('type')) ? params.get('type') : null
  const interested = params.get('interested') === 'true' ? true : params.get('interested') === 'false' ? false : null
  // (own parameter names: `sort` / `dir` belong to the directory state)
  const sort = SORTS.includes(params.get('csort')) ? params.get('csort') : 'name'
  const dir = params.get('cdir') === 'desc' ? 'desc' : 'asc'
  const rpcFilters = useMemo(() => toRpcFilters(state.filters), [state.filters])
  const [sending, setSending] = useState(false)
  const [exporting, setExporting] = useState(false)

  const query = useClosedFollowups({ filters: rpcFilters, status, type, interested, limit: PAGE, offset: (state.page - 1) * PAGE, sort, dir })
  const data = query.data
  const rows = data?.rows ?? []
  const counts = data?.counts

  const setExtra = (patch) => {
    const next = mergeSearch(params, state)
    for (const [k, v] of Object.entries(patch)) { if (v !== null && v !== undefined && v !== '') next.set(k, String(v)); else next.delete(k) }
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

  // the counts are filters: one tap shows exactly those companies (a second tap clears)
  const tiles = [
    { key: 'total', value: counts?.total, on: !status && !type && interested === null, patch: { status: '', type: '', interested: '' } },
    { key: 'answered', value: counts?.answered, on: status === 'answered' && !type, patch: { status: 'answered', type: '', interested: '' } },
    { key: 'not_answered', value: counts?.not_answered, on: status === 'not_answered', patch: { status: 'not_answered', type: '', interested: '' } },
    { key: 'new_startup', value: counts?.new_startup, on: type === 'new_startup', patch: { type: 'new_startup', status: '', interested: '' } },
    { key: 'employed', value: counts?.employed, on: type === 'employed', patch: { type: 'employed', status: '', interested: '' } },
    { key: 'other', value: counts?.other, on: type === 'other', patch: { type: 'other', status: '', interested: '' } },
    { key: 'interested', value: counts?.interested, on: interested === true, patch: { interested: 'true', status: '', type: '' } },
  ]

  async function exportXlsx() {
    setExporting(true)
    try {
      const all = []
      for (let off = 0; off < 5000; off += 500) {
        const r = await listClosedFollowups({ filters: rpcFilters, status, type, interested, limit: 500, offset: off, sort: 'name', dir: 'asc' })
        all.push(...r.rows)
        if (r.rows.length < 500) break
      }
      const { exportRows } = await import('../../../lib/export/xlsx.js')
      const x = (k) => t(`alumni.admin.cl.xl.${k}`)
      const yn = (v) => (v ? x('yes') : x('no'))
      const cols = [
        { header: x('company'), key: (r) => pick(r, 'name') },
        { header: x('closedOn'), key: (r) => r.closed_on },
        { header: x('founder'), key: (r) => pick(r.founder ?? {}, 'name') },
        { header: x('answerType'), key: (r) => (r.answer ? t(`alumni.closed.type.${r.answer.answer_type}`) : c('notAnswered')) },
        { header: x('venture'), key: (r) => r.answer?.venture_name },
        { header: x('field'), key: (r) => (r.answer?.field ? labels.label('sector', r.answer.field) : '') },
        { header: x('stage'), key: (r) => (r.answer?.venture_stage ? labels.label('stage', r.answer.venture_stage) : '') },
        { header: x('link'), key: (r) => safeUrl(r.answer?.venture_url) ?? '' },
        { header: x('description'), key: (r) => r.answer?.venture_description },
        { header: x('interested'), key: (r) => (r.answer?.answer_type === 'new_startup' ? yn(r.answer.wants_programs) : '') },
        { header: x('employer'), key: (r) => r.answer?.employer },
        { header: x('role'), key: (r) => r.answer?.job_title },
        { header: x('other'), key: (r) => r.answer?.other_text },
        { header: x('answeredOn'), key: (r) => r.answer?.answered_at },
        { header: x('answeredBy'), key: (r) => (r.answer ? c(`bySource.${r.answer.answered_source}`) : '') },
        { header: x('reminders'), key: (r) => r.reminders?.count ?? 0 },
      ]
      await exportRows(all, cols, 'closed-companies-followup.xlsx', { sheetName: 'Closed follow-up', blanks: true })
    } catch (err) { toast.error(errorText(err)) } finally { setExporting(false) }
  }

  const sortHeader = (key, label) => (
    <th scope="col" className="px-3 py-2 text-start" aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 text-start font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExtra({ csort: key, cdir: sort === key && dir === 'asc' ? 'desc' : 'asc' })}>
        {label}{sort === key && <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )

  return (
    <AdminPage
      testId="alumni-admin-closed"
      title={c('title')}
      subtitle={c('subtitle')}
      actions={(
        <>
          <Link to="/alumni/admin/quarters/reminders#wording" className={buttonClass({ variant: 'outline', size: 'sm' })}><Settings2 className="h-4 w-4" aria-hidden="true" />{c('remindersLink')}</Link>
          <Button variant="outline" size="sm" className="min-h-11" onClick={exportXlsx} loading={exporting} disabled={!data || data.total === 0}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{c('export')}</Button>
          <Button size="sm" className="min-h-11" onClick={() => setSending(true)} disabled={!data || data.total === 0} data-testid="remind-closed"><Send className="h-4 w-4" aria-hidden="true" />{c('sendReminders')}</Button>
        </>
      )}
    >
      <AreaTabs />
      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" data-testid="closed-counts">
          {tiles.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.on} onClick={() => setExtra(x.on && x.key !== 'total' ? { status: '', type: '', interested: '' } : x.patch)} className={cn('rounded-card border p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', x.on ? 'border-foreground bg-surface' : 'bg-card hover:border-foreground')} data-testid={`count-${x.key}`}>
              <KpiCard label={c(`kpi.${x.key}`)} value={x.value ?? 0} hint={x.key === 'total' ? undefined : c('of', { count: counts.total })} />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SearchBar className="min-w-60 flex-1 sm:max-w-xs" label={c('search')} placeholder={c('searchPlaceholder')} value={qText} onChange={setQText} />
        <div className="space-y-1">
          <label htmlFor="cl-status" className={LABEL_CLASS}>{c('f.status')}</label>
          <select id="cl-status" className={cn(SELECT_CLASS, 'w-auto')} value={status ?? ''} onChange={(ev) => setExtra({ status: ev.target.value })}>
            <option value="">{c('f.any')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{c(`f.${s}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="cl-type" className={LABEL_CLASS}>{c('f.type')}</label>
          <select id="cl-type" className={cn(SELECT_CLASS, 'w-auto')} value={type ?? ''} onChange={(ev) => setExtra({ type: ev.target.value })}>
            <option value="">{c('f.any')}</option>
            {CLOSED_TYPES.map((k) => <option key={k} value={k}>{t(`alumni.closed.type.${k}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="cl-int" className={LABEL_CLASS}>{c('f.interested')}</label>
          <select id="cl-int" className={cn(SELECT_CLASS, 'w-auto')} value={interested === null ? '' : String(interested)} onChange={(ev) => setExtra({ interested: ev.target.value })}>
            <option value="">{c('f.any')}</option>
            <option value="true">{c('f.yes')}</option>
            <option value="false">{c('f.no')}</option>
          </select>
        </div>
      </div>
      <DirectoryFilters filters={state.filters} onChange={onFilters} programs={programs.data?.programs ?? []} labels={labels} onClear={() => update({ filters: { scope: state.filters.scope }, page: 1 })} only={['program_id', 'sector', 'governorate', 'stage']} />

      {query.isPending ? <SkeletonList count={6} />
        : query.isError ? <ErrorState error={query.error} title={c('loadFailed')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <EmptyState title={c('empty')} body={c('emptyBody')} />
        : (
          <>
            <div role="region" aria-label={c('title')} className="overflow-x-auto rounded-card border bg-card" data-testid="closed-table-wrap">
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="bg-surface text-xs font-bold text-athar-ink">
                  <tr>
                    {sortHeader('name', c('col.company'))}
                    {sortHeader('closed', c('col.closedOn'))}
                    <th scope="col" className="px-3 py-2 text-start">{c('col.founder')}</th>
                    {sortHeader('type', c('col.answer'))}
                    <th scope="col" className="px-3 py-2 text-start">{c('col.details')}</th>
                    <th scope="col" className="px-3 py-2 text-start">{c('col.interested')}</th>
                    {sortHeader('answered', c('col.answeredOn'))}
                    <th scope="col" className="px-3 py-2 text-start">{c('col.reminders')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const name = pick(r, 'name') || '—'
                    const a = r.answer
                    return (
                      <tr key={r.id} className="border-t align-top" data-testid="closed-row" data-answered={a ? 'yes' : 'no'}>
                        <td className="px-3 py-2"><span className="flex items-center gap-2"><CompanyLogo path={r.logo_path} size={28} /><Link to={`/alumni/admin/company/${r.id}`} className="font-semibold text-primary hover:underline">{name}</Link></span></td>
                        <td className="px-3 py-2 text-xs tabular-nums">{r.closed_on ? e.date(r.closed_on) : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-3 py-2 text-xs"><span dir="auto">{pick(r.founder ?? {}, 'name') || '-'}</span>{r.founder && r.founder.with_account === 0 && <span className="block text-muted-foreground">{c('noFounderAccount')}</span>}</td>
                        <td className="px-3 py-2">{a ? <Badge tone={a.answer_type === 'new_startup' ? 'green' : a.answer_type === 'employed' ? 'blue' : 'neutral'}>{t(`alumni.closed.type.${a.answer_type}`)}</Badge> : <Badge tone="outline">{c('notAnswered')}</Badge>}</td>
                        <td className="max-w-xs px-3 py-2"><Details answer={a} labels={labels} /></td>
                        <td className="px-3 py-2">{a?.answer_type === 'new_startup' ? (a.wants_programs ? <Badge tone="green">{c('interestedBadge')}</Badge> : <span className="text-xs text-muted-foreground">{c('f.no')}</span>) : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-3 py-2 text-xs">{a ? <><span className="block tabular-nums">{e.date(a.answered_at)}</span><span className="text-muted-foreground">{c(`bySource.${a.answered_source}`)}</span></> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-3 py-2 text-xs">{r.reminders?.count ? <><Badge tone="outline">{c('remindersCount', { count: r.reminders.count })}</Badge><span className="mt-1 block text-muted-foreground tabular-nums">{e.date(r.reminders.last_at)}</span></> : <span className="text-muted-foreground">-</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} page={state.page} size={PAGE} onPage={(p) => update({ page: p })} sizes={[PAGE]} />
          </>
        )}
      {sending && data?.current_period && <SendRemindersDialog period={data.current_period} audience="closed" scope={{ filters: rpcFilters }} onlyNew={false} onClose={() => setSending(false)} />}
    </AdminPage>
  )
}
