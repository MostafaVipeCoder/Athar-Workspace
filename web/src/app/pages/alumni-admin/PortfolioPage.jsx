import { lazy, Suspense, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileSpreadsheet } from 'lucide-react'
import { useAlumniPortfolio } from '../../../data/alumniQuarters.js'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SELECT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { PORTFOLIO_METRICS, isPeriod, periodFromIndex, periodIndex, periodLabel, portfolioSeries, portfolioSheetRows } from '../../../lib/alumniQuarters.js'
import { cn } from '../../../lib/cn.js'
import { useQuarterFormat } from '../../../shared/alumni/useQuarterFormat.js'
import { AdminPage, SectionCard } from './ui.jsx'
import AreaTabs from './AreaTabs.jsx'
import DirectoryFilters from './DirectoryFilters.jsx'
import { mergeSearch, parseState, toRpcFilters } from './adminState.js'
import { useAdminErrorText, useLabels } from './hooks.js'
import './i18n.common.js'
import './area.i18n.js'
import './quarters.i18n.js'
import '../../../shared/alumni/i18n.quarters.js'
import '../../../shared/alumni/i18n.company.js'

// the chart code is a chunk of its own, loaded when this page (or a company with closed quarters) is shown
const ChartCard = lazy(() => import('../../../shared/alumni/QuarterChart.jsx'))

const TABLE_COLS = [
  ['companies', 'count'], ['reporting', 'count'], ['revenue_total', 'money'], ['revenue_median', 'money'], ['employees_total', 'count'], ['female_share', 'percent'],
  ['funding_total', 'money'], ['survival_rate', 'percent'], ['closing_rate', 'percent'],
]

/**
 * PORTFOLIO PERFORMANCE by quarter (owner decision 21): total / median revenue, employment, female share, funding, survival and closing rates, computed from the FROZEN quarterly
 * snapshots ONLY (never a draft), for the companies of a program / sector / governorate. Aggregates sum REPORTED snapshots only; a quarter without data is a gap. Excel export.
 */
export default function PortfolioPage() {
  const { t, tn, lang } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const fmt = useQuarterFormat()
  const labels = useLabels()
  const programs = useAlumniPrograms()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const filters = useMemo(() => toRpcFilters(state.filters), [state.filters])
  const from = isPeriod(params.get('from')) ? params.get('from') : null
  const to = isPeriod(params.get('to')) ? params.get('to') : null
  const query = useAlumniPortfolio({ filters, from, to })
  const data = query.data
  const periods = data?.periods ?? []
  const setExtra = (patch) => {
    const next = mergeSearch(params, state)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  const onFilters = (patch) => setParams(mergeSearch(params, { ...state, filters: { ...state.filters, ...patch }, page: 1 }), { replace: true })
  const options = useMemo(() => {
    const top = periodIndex(data?.latest ?? data?.to)
    if (top === null || top === undefined) return []
    return Array.from({ length: 24 }, (_, n) => periodFromIndex(top - n)).filter(Boolean)
  }, [data?.latest, data?.to])
  const hasData = periods.some((p) => p.companies > 0)

  async function exportXlsx() {
    try {
      const { exportRows } = await import('../../../lib/export/xlsx.js')
      const labelsMap = Object.fromEntries(['period_key', 'companies', 'reporting', 'revenue_total', 'revenue_median', 'employees_total', 'employees_female', 'female_share', 'freelancers', 'funding_total', 'team_size', 'female_founders', 'open', 'closed', 'survival_rate', 'closed_new', 'closing_rate', 'corrected'].map((k) => [k, q(`pf.x.${k}`)]))
      const [header, ...rows] = portfolioSheetRows(periods, labelsMap)
      await exportRows(rows, header.map((h, i) => ({ key: (r) => r[i], header: h })), `portfolio-${data.from}-${data.to}.xlsx`, { sheetName: 'Portfolio', blanks: true })
    } catch (err) { toast.error(errorText(err)) }
  }

  return (
    <AdminPage testId="alumni-admin-portfolio" title={q('pf.title')} subtitle={q('pf.subtitle')} actions={<Button variant="outline" size="sm" className="min-h-11" onClick={exportXlsx} disabled={!hasData}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{q('export')}</Button>}>
      <AreaTabs />
      <div className="flex flex-wrap items-end gap-3">
        {['from', 'to'].map((k) => (
          <div key={k} className="space-y-1">
            <label htmlFor={`pf-${k}`} className={LABEL_CLASS}>{q(`pf.${k}`)}</label>
            <select id={`pf-${k}`} className={cn(SELECT_CLASS, 'w-auto')} value={(k === 'from' ? from ?? data?.from : to ?? data?.to) ?? ''} onChange={(ev) => setExtra({ [k]: ev.target.value })} disabled={options.length === 0}>
              {[...options].reverse().map((p) => <option key={p} value={p}>{periodLabel(p, lang)}</option>)}
            </select>
          </div>
        ))}
      </div>
      <DirectoryFilters filters={state.filters} onChange={onFilters} programs={programs.data?.programs ?? []} labels={labels} onClear={() => onFilters({ program_id: '', sector: '', governorate: '' })} only={['program_id', 'sector', 'governorate']} />
      <p className="text-sm text-muted-foreground" data-testid="pf-note">{q('pf.note')}</p>

      {query.isPending ? <Skeleton className="h-64 w-full" /> : query.isError ? <ErrorState error={query.error} title={q('loadFailed')} onRetry={() => query.refetch()} /> : !hasData ? (
        <EmptyState title={q(from || to ? 'pf.emptyRange' : 'pf.empty')} body={q(from || to ? 'pf.emptyRangeBody' : 'pf.emptyBody')} />
      ) : (
        <>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <div className="grid gap-3 lg:grid-cols-2" data-testid="portfolio-charts">
              {PORTFOLIO_METRICS.map((m) => <ChartCard key={m.key} title={q(`pf.m.${m.key}`)} unit={m.unit} kind={m.chart} points={portfolioSeries(periods, m.key)} />)}
            </div>
          </Suspense>
          <SectionCard id="pf-table" title={q('pf.tableTitle')} testId="portfolio-table">
            <div className="overflow-x-auto rounded-card border">
              <table className="w-full min-w-[48rem] text-sm">
                <caption className="sr-only">{q('pf.tableTitle')}</caption>
                <thead className="bg-surface text-xs font-bold text-athar-ink"><tr><th scope="col" className="px-3 py-2 text-start">{q('pf.x.period_key')}</th>{TABLE_COLS.map(([k]) => <th key={k} scope="col" className="px-3 py-2 text-start">{q(`pf.m.${k}`)}</th>)}</tr></thead>
                <tbody>
                  {[...periods].reverse().map((p) => (
                    <tr key={p.period_key} className="border-t tabular-nums" data-testid="portfolio-row">
                      <th scope="row" className="px-3 py-1.5 text-start font-semibold">{periodLabel(p.period_key, lang)}{p.corrected > 0 && <span className="ms-1 text-xs font-normal text-muted-foreground">({qn('pf.corrected', p.corrected)})</span>}</th>
                      {TABLE_COLS.map(([k, unit]) => <td key={k} className="px-3 py-1.5" dir="ltr">{p[k] === null || p[k] === undefined ? <span className="text-muted-foreground">-</span> : fmt(unit, p[k])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </AdminPage>
  )
}
