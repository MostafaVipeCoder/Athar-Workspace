import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Filter, ListChecks, Pencil, UserRound } from 'lucide-react'
import { listAlumniAttention, useAlumniAttention } from '../../../data/alumni.js'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { completenessTone } from '../../../lib/alumni.js'
import { activeAttFilterCount, ATT_SCOPES, attentionExportRows, fixPath, mergeAttSearch, normalizeRules, parseAttState, readRules, toAttFilters, visibleMissing, writeRules } from '../../../lib/alumniAttention.js'
import { cn } from '../../../lib/cn.js'
import StampLine from '../../../shared/alumni/StampLine.jsx'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, CheckRow, CompanyLogo, KpiCard, Pagination, Segmented } from './ui.jsx'
import AreaTabs from './AreaTabs.jsx'
import { useAdminErrorText, useAdminFormat, useDebounced } from './hooks.js'
import './i18n.common.js'
import './area.i18n.js'
import './attention.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

const TONE_BAR = { success: 'bg-success', warning: 'bg-accent', danger: 'bg-destructive-text', neutral: 'bg-muted-foreground' }
const PAGE_SIZE = 25

/** Which items the queue checks. The choice is a per-viewer convenience (this browser); the server refuses an empty list, so at least one stays on. */
function RulesDialog({ rules, selected, onClose, onApply }) {
  const { t, tn } = useLanguage()
  const a = (k, v) => t(`alumni.admin.att.${k}`, v)
  const [chosen, setChosen] = useState(new Set(selected))
  const toggle = (key) => setChosen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const groups = ['required', 'recommended'].map((sev) => ({ sev, items: rules.filter((r) => r.severity === sev) }))
  return (
    <Modal open onClose={onClose} title={a('rulesTitle')} description={a('rulesIntro')} closeLabel={t('common.close')} className="sm:max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onApply(null)}>{a('rulesReset')}</Button>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => onApply([...chosen])} disabled={chosen.size === 0} data-testid="rules-apply">{a('rulesApply')}</Button>
        </>
      }>
      <div className="space-y-5" data-testid="rules-dialog">
        {groups.map((g) => (
          <fieldset key={g.sev} className="space-y-1">
            <legend className="text-sm font-bold">{a(g.sev === 'required' ? 'rulesRequired' : 'rulesRecommended')}</legend>
            {g.items.map((r) => (
              <CheckRow key={r.key} checked={chosen.has(r.key)} onChange={() => toggle(r.key)} label={a(`rule.${r.key}`)} hint={a('rulesCount', { count: r.count })} />
            ))}
          </fieldset>
        ))}
        {chosen.size === 0 && <p role="alert" className="text-sm text-destructive-text">{a('rulesNone')}</p>}
        <p className="sr-only">{tn('alumni.admin.common.selectedCount', chosen.size)}</p>
      </div>
    </Modal>
  )
}

function Row({ row, rules }) {
  const { t, tn, pick } = useLanguage()
  const a = (k, v) => t(`alumni.admin.att.${k}`, v)
  const sectionOf = useMemo(() => Object.fromEntries(rules.map((r) => [r.key, r.section])), [rules])
  const severityOf = useMemo(() => Object.fromEntries(rules.map((r) => [r.key, r.severity])), [rules])
  const chips = visibleMissing(row.missing)
  const first = (row.missing.find((k) => severityOf[k] === 'required') ?? row.missing[0]) || null
  const tone = completenessTone(row.completeness_percent)
  const name = pick(row, 'name') || '-'
  const ceoName = row.ceo ? pick(row.ceo, 'name') : ''
  return (
    <li className="space-y-3 rounded-card border bg-card p-4" data-testid="attention-row" data-missing={row.missing.length}>
      <div className="flex flex-wrap items-start gap-3">
        <CompanyLogo path={row.logo_path} size={44} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/alumni/admin/company/${row.id}`} className="inline-flex min-h-11 items-center break-words text-base font-bold text-primary hover:underline">{name}</Link>
            <Badge tone={row.is_alumni ? 'blue' : 'outline'}>{row.is_alumni ? a('alumniBadge') : a('notAlumniBadge')}</Badge>
            {row.pending_invitations > 0 && <Badge tone="amber">{a('invitedPending')}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="attention-ceo">
            {row.ceo ? (
              <span className="inline-flex flex-wrap items-center gap-x-2">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                {a('ceoLine', { name: ceoName })}
                <Badge tone={row.ceo.has_account ? 'green' : 'outline'}>{a(row.ceo.has_account ? 'hasAccount' : 'noAccount')}</Badge>
                {row.ceo.email && <span dir="ltr" className="text-xs">{row.ceo.email}</span>}
                {row.ceo.phone && <span dir="ltr" className="text-xs">{row.ceo.phone}</span>}
              </span>
            ) : a('noCeoLine')}
          </p>
          <StampLine audience="manager" stamp={row.last_update?.at ? { at: row.last_update.at, source: row.last_update.source ?? 'system' } : null} showNone className="pt-0.5" />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-1 sm:w-48">
          <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{a('completeness', { percent: row.completeness_percent })}</span></div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.completeness_percent} aria-label={a('completeness', { percent: row.completeness_percent })} className="h-2 overflow-hidden rounded-full bg-surface">
            <div className={cn('h-full rounded-full', TONE_BAR[tone])} style={{ width: `${row.completeness_percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {row.required_missing > 0 ? tn('alumni.admin.att.requiredMissing', row.required_missing) : row.recommended_missing > 0 ? tn('alumni.admin.att.recommendedMissing', row.recommended_missing) : a('allGood')}
          </p>
        </div>
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={a('col.missing')}>
          {chips.map((k) => (
            <li key={k}>
              <Link to={fixPath(row.id, k, sectionOf[k])} aria-label={a('fixItem', { item: a(`rule.${k}`) })} data-testid="attention-chip" data-rule={k}
                className={cn('inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  severityOf[k] === 'required' ? 'border-accent bg-accent/30' : 'border-input bg-background')}>
                {severityOf[k] === 'required' && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
                {a(`rule.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {first && <Link to={fixPath(row.id, first, sectionOf[first])} className={buttonClass({ variant: 'primary', size: 'sm' })} data-testid="attention-fix"><Pencil className="h-4 w-4" aria-hidden="true" />{a('fix')}</Link>}
        <Link to={`/alumni/admin/company/${row.id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>{a('openCompany')}</Link>
        {!row.ceo?.has_account && <Link to={fixPath(row.id, null, 'invitations')} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{a('invite')}</Link>}
      </div>
    </li>
  )
}

/**
 * The needs-attention queue (owner decision 20.3): every company with missing data, the worst first, with counts per missing item, filters, a completeness bar and a one-click
 * jump to the form that fixes each item. The catalogue (what is checked, required or recommended, which section fixes it) comes from the server; which items COUNT is this
 * viewer's choice. Fast on the whole registry: one request per page of the list.
 */
export default function AttentionPage() {
  const { t, tn, pick } = useLanguage()
  const a = (k, v) => t(`alumni.admin.att.${k}`, v)
  const toast = useToast()
  const fmt = useAdminFormat()
  const e = useEditText()
  const errorText = useAdminErrorText()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseAttState(params), [params])
  const update = (patch) => setParams(mergeAttSearch(params, { ...state, ...patch }), { replace: true })
  const [saved, setSaved] = useState(() => readRules())
  const [rulesOpen, setRulesOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(() => activeAttFilterCount(state.filters) > 0)
  const [exporting, setExporting] = useState(false)
  const programs = useAlumniPrograms()

  const [qText, setQText] = useState(state.filters.q ?? '')
  const [seenQ, setSeenQ] = useState(state.filters.q ?? '')
  if ((state.filters.q ?? '') !== seenQ) { setSeenQ(state.filters.q ?? ''); setQText(state.filters.q ?? '') }
  const debouncedQ = useDebounced(qText, 300)
  const commitSearch = useEffectEvent((q) => { if (q !== (state.filters.q ?? '')) update({ filters: { ...state.filters, q }, page: 1 }) })
  useEffect(() => { commitSearch(debouncedQ) }, [debouncedQ])

  const filters = useMemo(() => toAttFilters(state.filters), [state.filters])
  const query = useAlumniAttention({ filters, rules: saved, limit: state.size, offset: (state.page - 1) * state.size, sort: state.sort })
  const data = query.data
  const rules = data?.rules ?? []
  const catalog = rules.map((r) => r.key)
  const selected = normalizeRules(saved, catalog)
  const counts = data?.counts

  function applyRules(keys) {
    const all = keys && catalog.length > 0 && catalog.every((k) => keys.includes(k)) ? null : keys
    setSaved(all)
    writeRules(all)
    setRulesOpen(false)
    update({ page: 1 })
  }

  async function exportList() {
    setExporting(true)
    try {
      const full = await listAlumniAttention({ filters, rules: saved, limit: 5000, offset: 0, sort: state.sort })
      const { exportRows } = await import('../../../lib/export/xlsx.js')
      const ctx = { pickName: (o) => pick(o, 'name'), yes: t('alumni.admin.common.yes'), no: t('alumni.admin.common.no'), ruleLabel: (k) => a(`rule.${k}`), link: (id) => `${window.location.origin}/alumni/admin/company/${id}` }
      const cols = ['company', 'alumni', 'completeness', 'required', 'recommended', 'missing', 'ceo', 'email', 'phone', 'account', 'invitation', 'updated', 'link'].map((k) => ({ key: k, header: a(`col.${k}`), format: k === 'updated' ? (v) => (v ? e.dateTime(v) : '') : undefined }))
      const n = await exportRows(attentionExportRows(full.rows, ctx), cols, `needs-attention-${new Date().toISOString().slice(0, 10)}`, { sheetName: a('sheet'), blanks: true })
      toast.success(tn('alumni.admin.att.exported', n))
    } catch (err) {
      toast.error(`${a('exportFailed')} ${errorText(err)}`)
    } finally {
      setExporting(false)
    }
  }

  const hasFilter = activeAttFilterCount(state.filters) > 0 || Boolean(state.filters.q)
  const onFilters = (patch) => update({ filters: { ...state.filters, ...patch }, page: 1 })
  const triState = (v) => (v === true ? 'yes' : v === false ? 'no' : 'any')
  const fromTri = (v) => (v === 'yes' ? true : v === 'no' ? false : '')
  const rows = data?.rows ?? []
  const withCounts = rules.filter((r) => r.selected && r.count > 0)

  return (
    <AdminPage
      testId="alumni-admin-attention"
      title={a('title')}
      subtitle={a('subtitle')}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)} disabled={rules.length === 0} data-testid="rules-open"><ListChecks className="h-4 w-4" aria-hidden="true" />{a('rulesButton')}</Button>
          <Button size="sm" onClick={exportList} loading={exporting} disabled={!data || (data.total ?? 0) === 0} data-testid="attention-export"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{a('export')}</Button>
        </>
      }
    >
      <AreaTabs />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="attention-kpis">
        <KpiCard label={a('kpiTotal')} value={counts ? fmt.num(counts.total) : '-'} icon={ListChecks} />
        <KpiCard label={a('kpiIssues')} value={counts ? fmt.num(counts.with_issues) : '-'} icon={AlertTriangle} tone={counts?.with_issues > 0 ? 'bad' : 'default'} />
        <KpiCard label={a('kpiComplete')} value={counts ? fmt.num(counts.complete) : '-'} icon={CheckCircle2} tone="good" />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar className="min-w-60 flex-1 sm:max-w-sm" label={a('searchLabel')} placeholder={a('searchPlaceholder')} value={qText} onChange={setQText} />
          <Segmented label={a('scope')} value={filters.scope} onChange={(v) => onFilters({ scope: v })} options={ATT_SCOPES.map((s) => ({ value: s, label: a(`scope.${s}`) }))} />
          <Button variant={filtersOpen ? 'secondary' : 'outline'} size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="h-4 w-4" aria-hidden="true" />{a('filters')}
            {activeAttFilterCount(state.filters) > 0 && <Badge tone="amber" className="ms-1">{activeAttFilterCount(state.filters)}</Badge>}
          </Button>
          <div className="space-y-1">
            <label htmlFor="att-sort" className="sr-only">{a('sort')}</label>
            <select id="att-sort" className={cn(SELECT_CLASS, 'min-h-11 w-auto py-1')} value={state.sort} onChange={(ev) => update({ sort: ev.target.value, page: 1 })} title={a('sort')}>
              {['missing', 'completeness', 'name', 'updated'].map((s) => <option key={s} value={s}>{a(`sort.${s}`)}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{a(`scopeHint.${filters.scope}`)}</p>
        {filtersOpen && (
          <div className="grid gap-3 rounded-card border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="attention-filters">
            {[
              { id: 'att-sev', label: a('severity'), value: filters.severity ?? 'any', onChange: (v) => onFilters({ severity: v === 'any' ? '' : v }), options: ['any', 'required', 'recommended'].map((v) => [v, a(`severity.${v}`)]) },
              { id: 'att-acc', label: a('account'), value: triState(filters.has_account), onChange: (v) => onFilters({ has_account: fromTri(v) }), options: ['any', 'yes', 'no'].map((v) => [v, a(`account.${v}`)]) },
              { id: 'att-inv', label: a('invited'), value: triState(filters.invited), onChange: (v) => onFilters({ invited: fromTri(v) }), options: ['any', 'yes', 'no'].map((v) => [v, a(`invited.${v}`)]) },
            ].map((f) => (
              <div key={f.id} className="space-y-1">
                <label htmlFor={f.id} className="block text-sm font-medium text-athar-ink">{f.label}</label>
                <select id={f.id} className={cn(SELECT_CLASS, 'min-h-11')} value={f.value} onChange={(ev) => f.onChange(ev.target.value)}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
            ))}
            <div className="space-y-1">
              <label htmlFor="att-prog" className="block text-sm font-medium text-athar-ink">{a('program')}</label>
              <select id="att-prog" className={cn(SELECT_CLASS, 'min-h-11')} value={filters.program_id ?? ''} onChange={(ev) => onFilters({ program_id: ev.target.value })}>
                <option value="">{a('anyProgram')}</option>
                {(programs.data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{pick(p, 'name')}</option>)}
              </select>
            </div>
            {hasFilter && <div className="sm:col-span-2 lg:col-span-4"><Button variant="ghost" size="sm" onClick={() => update({ filters: { scope: filters.scope }, page: 1 })}>{a('clearFilters')}</Button></div>}
          </div>
        )}
      </div>

      {withCounts.length > 0 && (
        <section aria-label={a('byRule')} className="space-y-2" data-testid="attention-by-rule">
          <p className="text-xs font-semibold text-muted-foreground">{a('byRule')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {withCounts.map((r) => (
              <li key={r.key}>
                <button type="button" aria-pressed={filters.missing === r.key} data-rule={r.key} onClick={() => onFilters({ missing: filters.missing === r.key ? '' : r.key })}
                  className={cn('inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filters.missing === r.key ? 'border-foreground bg-foreground text-background' : r.severity === 'required' ? 'border-accent bg-accent/30 hover:border-foreground' : 'border-input bg-background hover:border-foreground')}>
                  {a(`rule.${r.key}`)}
                  <span className="rounded-full bg-background/30 px-1.5 tabular-nums">{fmt.num(r.count)}</span>
                </button>
              </li>
            ))}
          </ul>
          {filters.missing && <Button variant="ghost" size="sm" onClick={() => onFilters({ missing: '' })}>{a('clearRule')}</Button>}
        </section>
      )}

      {query.isPending ? <SkeletonList count={5} itemClassName="h-28 w-full" />
        : query.isError ? <ErrorState error={query.error} title={a('loadFailed')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <EmptyState icon={CheckCircle2} title={a('emptyTitle')} body={a('emptyBody')} action={hasFilter ? <Button variant="outline" onClick={() => update({ filters: { scope: filters.scope }, page: 1 })}>{a('clearFilters')}</Button> : null} />
        : (
          <>
            <ul className={cn('space-y-3', query.isFetching && 'opacity-70')} data-testid="attention-list">
              {rows.map((r) => <Row key={r.id} row={r} rules={rules} />)}
            </ul>
            <Pagination total={data.total} page={state.page} size={state.size} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s, page: 1 })} />
          </>
        )}

      {rulesOpen && <RulesDialog rules={rules} selected={selected} onClose={() => setRulesOpen(false)} onApply={applyRules} />}
    </AdminPage>
  )
}
