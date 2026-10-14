import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Briefcase, Building2, FileSpreadsheet, Filter, Gauge, Landmark, Percent, Users, Wallet } from 'lucide-react'
import { useAlumniAnalytics } from '../../../data/alumni.js'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { cn } from '../../../lib/cn.js'
import { AdminPage, KpiCard, SectionCard } from './ui.jsx'
import { BarList, ColumnChart, ShareBar } from './charts.jsx'
import DirectoryFilters from './DirectoryFilters.jsx'
import ExportDialog from './ExportDialog.jsx'
import { activeFilterCount, parseState, mergeSearch, toRpcFilters } from './adminState.js'
import { analyticsSheets, barRows, sharePct, yearOptions, yearSeries } from './adminLogic.js'
import { exportFilename, exportWorkbook } from './exportXlsx.js'
import { useAdminErrorText, useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './analytics.i18n.js'

const FILTER_KEYS = ['program_id', 'sector', 'stage', 'startup_type', 'legal_status', 'governorate', 'ceo_governorate', 'ceo_gender', 'age_category', 'education_status', 'operating_status']
// the keys analyticsSheets asks for -> the dictionary keys of this page
const SHEET_KEYS = { summary: 's_summary', metric: 's_metric', value: 's_value', label: 's_label', count: 's_count', year: 's_year', companies: 'm_companies', open: 'm_open', closed: 'm_closed', survival: 'm_survival',
  withProgram: 'm_withProgram', reporting: 'm_reporting', founders: 'm_founders', femaleFounders: 'm_femaleFounders', foundersUnder35: 'm_foundersUnder35', employees: 'm_employees', femaleEmployees: 'm_femaleEmployees',
  freelancers: 'm_freelancers', funding: 'm_funding', revenue: 'm_revenue' }

/**
 * M7 / M8: the Analytics page (filtered) and the Impact view (all alumni, no filters) are ONE component with two modes. Aggregates come from `get_alumni_analytics` (the same
 * filter as the directory and the export); the CEO's gender / age category / governorate are the ones derived from the national ID. Nothing is invented: a year nobody reported
 * says so (coverage line), and an empty registry shows an empty state, never a made-up percentage.
 */
export default function AnalyticsPage({ mode = 'analytics' }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.ana.${k}`, v)
  const impact = mode === 'impact'
  const fmt = useAdminFormat()
  const labels = useLabels()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const filters = useMemo(() => (impact ? { scope: 'alumni' } : toRpcFilters(state.filters)), [impact, state.filters])
  const programs = useAlumniPrograms()
  const q = useAlumniAnalytics({ filters, year: state.year })
  const [filtersOpen, setFiltersOpen] = useState(() => activeFilterCount(state.filters) > 0)
  const [exportOpen, setExportOpen] = useState(false)
  const update = (patch) => setParams(mergeSearch(params, { ...state, ...patch }), { replace: true })

  async function exportExcel(a) {
    try {
      const tt = (k) => d(SHEET_KEYS[k] ?? k)
      const labelFor = (field, i) => {
        const k = i.key
        if (k === null || k === undefined || k === '') return t('alumni.admin.common.notSpecified')
        switch (field) {
          case 'by_sector': return labels.label('sector', k)
          case 'by_stage': return labels.label('stage', k)
          case 'by_startup_type': return labels.label('startup_type', k)
          case 'by_legal_status': return labels.label('legal_status', k)
          case 'by_governorate': case 'by_ceo_governorate': return labels.label('governorate', Number(k))
          case 'by_ceo_gender': return labels.label('gender', k)
          case 'by_ceo_age_category': return labels.label('age_category', k)
          case 'by_program': return pick(i, 'program_name')
          default: return String(k)
        }
      }
      await exportWorkbook(analyticsSheets(a, { labels: labelFor, t: tt }), exportFilename(d('exportFile')))
      toast.success(d('exported'))
    } catch (e) {
      toast.error(`${d('exportFailed')} ${errorText(e)}`)
    }
  }

  const title = impact ? d('titleImpact') : d('title')
  return (
    <AdminPage
      testId={impact ? 'alumni-admin-impact' : 'alumni-admin-analytics'}
      title={title}
      subtitle={impact ? d('subtitleImpact') : d('subtitle')}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{d('exportOwner')}</Button>
          <Button size="sm" onClick={() => q.data && exportExcel(q.data)} disabled={!q.data || q.data.totals.companies === 0}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{d('exportExcel')}</Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={d('views')} className="inline-flex gap-1 rounded-full border border-input bg-background p-1">
          {[['analytics', d('viewAnalytics'), '/alumni/admin/analytics'], ['impact', d('viewImpact'), '/alumni/admin/impact']].map(([k, label, to]) => (
            <Link key={k} to={to} aria-current={mode === k ? 'page' : undefined} className={cn('inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === k ? 'bg-foreground text-background' : 'hover:bg-surface')}>{label}</Link>
          ))}
        </nav>
        <select aria-label={d('year')} className={`${SELECT_CLASS} min-h-11 w-auto py-1`} value={state.year ?? ''} onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{d('yearLatest')}{q.data && !state.year ? ` (${q.data.year})` : ''}</option>
          {yearOptions(q.data?.year).map((y) => <option key={y} value={y}>{d('year')}: {y}</option>)}
        </select>
        {!impact && (
          <Button variant={filtersOpen ? 'secondary' : 'outline'} size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="h-4 w-4" aria-hidden="true" />{d('filters')}{activeFilterCount(state.filters) > 0 && <Badge tone="amber" className="ms-1">{activeFilterCount(state.filters)}</Badge>}
          </Button>
        )}
      </div>
      {!impact && filtersOpen && <DirectoryFilters filters={filters} only={FILTER_KEYS} onChange={(p) => update({ filters: { ...state.filters, ...p } })} programs={programs.data?.programs ?? []} labels={labels} onClear={() => update({ filters: { scope: 'alumni' } })} />}

      {q.isPending ? <SkeletonList count={8} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" itemClassName="h-28 w-full" />
        : q.isError ? <ErrorState error={q.error} title={d('loadFailed')} onRetry={() => q.refetch()} />
        : q.data.totals.companies === 0 ? <EmptyState icon={Building2} title={d('emptyTitle')} body={d('emptyBody')} action={<Link to="/alumni/admin/directory?scope=candidates" className="text-sm font-semibold text-primary hover:underline">{t('alumni.admin.dir.emptyAlumniAction')}</Link>} />
        : <Body a={q.data} impact={impact} labels={labels} fmt={fmt} d={d} t={t} pick={pick} />}

      {exportOpen && <ExportDialog open onClose={() => setExportOpen(false)} filters={filters} count={q.data?.totals.companies ?? 0} latestYear={q.data?.year} defaultYear={state.year} />}
    </AdminPage>
  )
}

function Body({ a, impact, labels, fmt, d, t, pick }) {
  const tt = a.totals
  const anyReported = a.by_year.length > 0
  const money = (v) => (anyReported ? fmt.money(v) : '—')
  const bars = (items, labelOf, limit = 8) => barRows(items, { labelOf, limit, otherLabel: t('alumni.admin.common.other'), nullLabel: t('alumni.admin.common.notSpecified') })
  const pctText = (p) => fmt.pct(Math.round(p * 10) / 10)
  const total = tt.companies
  const femaleShare = sharePct(tt.female_founders, tt.founders)
  const underShare = sharePct(tt.founders_under_35, tt.founders)
  const jobsShare = sharePct(tt.female_employees, tt.employees)
  const gov = (k) => labels.label('governorate', Number(k))
  const sections = [
    ['secSector', 'by_sector', (k) => labels.label('sector', k)],
    ['secStage', 'by_stage', (k) => labels.label('stage', k)],
    ['secType', 'by_startup_type', (k) => labels.label('startup_type', k)],
    ['secLegal', 'by_legal_status', (k) => labels.label('legal_status', k)],
    ['secLocation', 'by_governorate', gov],
    ['secCeoGov', 'by_ceo_governorate', gov],
    ['secAge', 'by_ceo_age_category', (k) => labels.label('age_category', k)],
  ]
  return (
    <>
      <section aria-label={d('title')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="analytics-kpis">
        <KpiCard testId="ana-companies" label={d('kpiCompanies')} icon={Building2} value={fmt.num(total)} hint={d('kpiCompaniesHint', { withProgram: fmt.num(tt.with_program) })} />
        <KpiCard testId="ana-survival" label={d('kpiSurvival')} icon={Gauge} value={tt.survival_rate === null || tt.survival_rate === undefined ? '—' : fmt.pct(tt.survival_rate)} hint={d('kpiSurvivalHint', { open: fmt.num(tt.open), closed: fmt.num(tt.closed) })} />
        <KpiCard testId="ana-closing" label={d('kpiClosing')} icon={Percent} value={total > 0 ? fmt.pct(sharePct(tt.closed, total)) : '—'} hint={d('kpiClosingHint', { closed: fmt.num(tt.closed), total: fmt.num(total) })} />
        <KpiCard testId="ana-founders" label={d('kpiFounders')} icon={Users} value={fmt.num(tt.founders)} hint={d('kpiFoundersHint', { female: fmt.num(tt.female_founders), femaleShare: femaleShare === null ? '—' : fmt.pct(femaleShare), under35: fmt.num(tt.founders_under_35), under35Share: underShare === null ? '—' : fmt.pct(underShare) })} />
        <KpiCard testId="ana-jobs" label={d('kpiJobs')} icon={Briefcase} value={anyReported ? fmt.num(tt.employees) : '—'} hint={d('kpiJobsHint', { female: fmt.num(tt.female_employees), share: jobsShare === null ? '—' : fmt.pct(jobsShare), freelancers: fmt.num(tt.freelancers) })} />
        <KpiCard testId="ana-revenue" label={d('kpiRevenue', { year: a.year })} icon={Wallet} value={money(tt.revenue)} hint={d('kpiRevenueHint', { year: a.year })} />
        <KpiCard testId="ana-funding" label={d('kpiFunding')} icon={Landmark} value={money(tt.funding_raised)} hint={d('kpiFundingHint', { year: a.year })} />
      </section>
      <p className="text-sm text-muted-foreground" data-testid="coverage">{anyReported ? d('coverage', { reporting: fmt.num(tt.reporting_year), total: fmt.num(total), year: a.year }) : d('coverageNone')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard id="status" title={d('secStatus')}>
          <ShareBar ariaLabel={d('secStatus')} format={fmt.num} segments={[{ key: 'open', label: labels.label('operating_status', 'open'), value: tt.open, tone: 'primary' }, { key: 'closed', label: labels.label('operating_status', 'closed'), value: tt.closed, tone: 'ink' }]} />
        </SectionCard>
        <SectionCard id="gender" title={d('secGender')}>
          <ShareBar ariaLabel={d('secGender')} format={fmt.num} segments={[
            { key: 'female', label: labels.label('gender', 'female'), value: a.by_ceo_gender.find((x) => x.key === 'female')?.count ?? 0, tone: 'primary' },
            { key: 'male', label: labels.label('gender', 'male'), value: a.by_ceo_gender.find((x) => x.key === 'male')?.count ?? 0, tone: 'ink' },
            { key: 'none', label: t('alumni.admin.common.notSpecified'), value: a.by_ceo_gender.find((x) => x.key === null || x.key === undefined)?.count ?? 0, tone: 'success' }]} />
        </SectionCard>
      </div>

      <SectionCard id="trend" title={d('trend')} description={d('trendHint')}>
        {a.by_year.length === 0 ? <p className="text-sm text-muted-foreground">{d('noTrend')}</p> : (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <div><h3 className="mb-1 text-sm font-bold">{d('trendRevenue')}</h3><ColumnChart ariaLabel={d('trendRevenue')} missingLabel={d('notReported')} series={yearSeries(a.by_year, 'revenue')} format={fmt.compact} /></div>
              <div><h3 className="mb-1 text-sm font-bold">{d('trendFunding')}</h3><ColumnChart ariaLabel={d('trendFunding')} missingLabel={d('notReported')} tone="ink" series={yearSeries(a.by_year, 'funding_raised')} format={fmt.compact} /></div>
              <div><h3 className="mb-1 text-sm font-bold">{d('trendJobs')}</h3><ColumnChart ariaLabel={d('trendJobs')} missingLabel={d('notReported')} tone="success" series={yearSeries(a.by_year, 'employees')} format={fmt.num} /></div>
            </div>
            <div className="overflow-x-auto rounded-card border" role="region" aria-label={d('byYear')}>
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface text-xs font-bold text-athar-ink"><tr>{['tableYear', 'tableReporting', 'tableRevenue', 'tableFunding', 'tableJobs', 'tableFemaleJobs', 'tableFreelancers'].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start">{d(k)}</th>)}</tr></thead>
                <tbody>
                  {[...a.by_year].sort((x, y) => y.year - x.year).map((y) => (
                    <tr key={y.year} className="border-t tabular-nums"><th scope="row" className="px-3 py-1.5 text-start font-semibold">{y.year}</th><td className="px-3 py-1.5">{fmt.num(y.companies_reporting)}</td><td className="px-3 py-1.5">{fmt.money(y.revenue)}</td><td className="px-3 py-1.5">{fmt.money(y.funding_raised)}</td><td className="px-3 py-1.5">{fmt.num(y.employees)}</td><td className="px-3 py-1.5">{fmt.num(y.female_employees)}</td><td className="px-3 py-1.5">{fmt.num(y.freelancers)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard id="program" title={d('secProgram')}>
          {a.by_program.length === 0 ? <p className="text-sm text-muted-foreground">{d('notReported')}</p>
            : <BarList ariaLabel={d('secProgram')} tone="ink" format={fmt.num} pctText={pctText} rows={barRows(a.by_program.map((p) => ({ key: p.key, count: p.count, p })), { labelOf: (_k, i) => pick(i.p, 'program_name'), limit: 8, otherLabel: t('alumni.admin.common.other') })} />}
        </SectionCard>
        {(impact ? sections.filter(([k]) => k === 'secSector' || k === 'secLocation') : sections).map(([title, field, labelOf]) => (
          <SectionCard key={field} id={field} title={d(title)}>
            <BarList ariaLabel={d(title)} format={fmt.num} pctText={pctText} rows={bars(a[field], labelOf)} />
          </SectionCard>
        ))}
      </div>
    </>
  )
}
