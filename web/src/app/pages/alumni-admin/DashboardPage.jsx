import { Link } from 'react-router-dom'
import { BarChart3, Bell, Building2, CalendarCheck, ClipboardCheck, Gauge, Layers, MailPlus, Users } from 'lucide-react'
import { useAlumniAnalytics, useAlumniInvitations } from '../../../data/alumni.js'
import { useAlumniBroadcasts, useAlumniOverview } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Badge } from '../../../ui/Badge.jsx'
import { EmptyState } from '../../../ui/States.jsx'
import { AdminPage, KpiCard, Query, SectionCard } from './ui.jsx'
import { BarList } from './charts.jsx'
import { barRows, readRate, statusTone } from './adminLogic.js'
import { useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './dashboard.i18n.js'

const ROUTE = '/alumni/admin'

/**
 * M1: the manager's dashboard. Real figures only (the analytics + overview RPCs; no number is invented, an empty registry says so). Every card loads on its own: a failing
 * one shows its error with Try again and the rest of the page stays.
 */
export default function DashboardPage() {
  const { t, tn, pick } = useLanguage()
  const fmt = useAdminFormat()
  const labels = useLabels()
  const overview = useAlumniOverview()
  const analytics = useAlumniAnalytics({})
  const invitations = useAlumniInvitations({ limit: 5 })
  const broadcasts = useAlumniBroadcasts({ limit: 5 })
  const d = (k, vars) => t(`alumni.admin.dash.${k}`, vars)

  return (
    <AdminPage
      testId="alumni-admin-dashboard"
      title={d('title')}
      subtitle={overview.data ? `${d('subtitle')} ${d('asOf', { date: fmt.date(overview.data.as_of) })}` : d('subtitle')}
      actions={
        <>
          <Link to={`${ROUTE}/directory`} className={buttonClass({ variant: 'outline', size: 'sm' })}><Building2 className="h-4 w-4" aria-hidden="true" />{d('actionsDirectory')}</Link>
          <Link to={`${ROUTE}/invitations`} className={buttonClass({ variant: 'outline', size: 'sm' })}><MailPlus className="h-4 w-4" aria-hidden="true" />{d('actionsInvite')}</Link>
          <Link to={`${ROUTE}/notifications`} className={buttonClass({ variant: 'primary', size: 'sm' })}><Bell className="h-4 w-4" aria-hidden="true" />{d('actionsNotify')}</Link>
        </>
      }
    >
      <Query query={overview} skeleton="h-40 w-full">
        {(o) => (
          <>
            {o.companies.alumni === 0 && (
              <EmptyState
                icon={Building2}
                title={d('emptyTitle')}
                body={d('emptyBody', { candidates: fmt.num(o.companies.candidates) })}
                action={<Link to={`${ROUTE}/directory?scope=candidates`} className={buttonClass({ variant: 'primary', size: 'sm' })}>{d('emptyAction')}</Link>}
              />
            )}
            <section aria-label={d('title')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <KpiCard testId="kpi-alumni" label={d('kpiAlumni')} icon={Building2} to={`${ROUTE}/directory`} value={fmt.num(o.companies.alumni)}
                hint={`${d('kpiAlumniHint', { total: fmt.num(o.companies.total) })} · ${d('kpiCandidates', { count: fmt.num(o.companies.candidates) })}`} />
              <Query query={analytics} skeleton="h-28 w-full">
                {(a) => (
                  <>
                    <KpiCard testId="kpi-operating" label={d('kpiOperating')} icon={Gauge} to={`${ROUTE}/analytics`} value={d('kpiOperatingValue', { open: fmt.num(o.companies.open), closed: fmt.num(o.companies.closed) })}
                      hint={a.totals.survival_rate === null || a.totals.survival_rate === undefined ? d('kpiSurvivalNone') : d('kpiSurvival', { rate: fmt.pct(a.totals.survival_rate) })} />
                    <KpiCard testId="kpi-programs" label={d('kpiPrograms')} icon={Layers} to={`${ROUTE}/analytics`} value={fmt.num(a.by_program.length)} hint={tn('alumni.admin.dash.kpiProgramsHint', a.totals.with_program)} />
                    <KpiCard testId="kpi-report" label={d('kpiReport')} icon={CalendarCheck} to={`${ROUTE}/workspace`}
                      value={o.latest_year ? `${fmt.num(a.totals.reporting_year)} / ${fmt.num(a.totals.companies)}` : '—'}
                      hint={o.latest_year ? d('kpiReportHint', { year: a.year }) : d('kpiReportNone')} />
                  </>
                )}
              </Query>
              <KpiCard testId="kpi-founders" label={d('kpiFounders')} icon={Users} value={d('kpiFoundersValue', { accounts: fmt.num(o.founders.with_account), total: fmt.num(o.founders.total) })}
                hint={d('kpiFoundersHint', { linked: fmt.num(o.founders.alumni_founders), withId: fmt.num(o.founders.with_national_id) })} />
              <KpiCard testId="kpi-completeness" label={d('kpiCompleteness')} icon={ClipboardCheck} to={`${ROUTE}/directory?incomplete=true`}
                value={o.completeness.average === null ? '—' : `${fmt.num(o.completeness.average)}%`}
                hint={o.completeness.average === null ? d('kpiCompletenessNone') : tn('alumni.admin.dash.kpiCompletenessHint', o.completeness.incomplete)}>
                {o.completeness.average !== null && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.completeness.average} aria-label={d('kpiCompleteness')}>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${o.completeness.average}%` }} />
                  </div>
                )}
              </KpiCard>
              <KpiCard testId="kpi-review" label={d('kpiReview')} icon={ClipboardCheck} to={`${ROUTE}/directory?reviewed=false`} value={d('kpiReviewValue', { current: fmt.num(o.review.current) })}
                hint={d('kpiReviewHint', { changed: fmt.num(o.review.changed_since), never: fmt.num(o.review.never) })} />
              <KpiCard testId="kpi-invitations" label={d('kpiInvitations')} icon={MailPlus} to={`${ROUTE}/invitations`} value={d('kpiInvitationsValue', { pending: fmt.num(o.invitations.pending) })}
                hint={d('kpiInvitationsHint', { accepted: fmt.num(o.invitations.accepted), rate: fmt.pct(readRate(o.invitations.accepted, o.invitations.accepted + o.invitations.pending + o.invitations.expired)) })} />
              <KpiCard testId="kpi-notifications" label={d('kpiNotifications')} icon={Bell} to={`${ROUTE}/notifications`} value={d('kpiNotificationsValue', { count: fmt.num(o.notifications.broadcasts_30d) })}
                hint={d('kpiNotificationsHint', { recipients: fmt.num(o.notifications.recipients_30d), rate: fmt.pct(readRate(o.notifications.read_30d, o.notifications.recipients_30d)) })} />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard id="attention" title={d('attention')} testId="dash-attention">
                <Attention o={o} d={d} fmt={fmt} />
              </SectionCard>
              <SectionCard id="by-sector" title={d('bySector')}>
                <Query query={analytics} skeleton="h-40 w-full">
                  {(a) => (a.by_sector.length === 0
                    ? <p className="text-sm text-muted-foreground">{d('noData')}</p>
                    : <BarList ariaLabel={d('bySector')} rows={barRows(a.by_sector, { labelOf: (k) => labels.label('sector', k), limit: 6, otherLabel: t('alumni.admin.common.other'), nullLabel: t('alumni.admin.common.notSpecified') })} format={fmt.num} />)}
                </Query>
              </SectionCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <SectionCard id="by-program" title={d('byProgram')} action={<Link to={`${ROUTE}/analytics`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"><BarChart3 className="me-1 inline h-4 w-4" aria-hidden="true" />{d('seeAll')}</Link>}>
                <Query query={analytics} skeleton="h-32 w-full">
                  {(a) => (a.by_program.length === 0
                    ? <p className="text-sm text-muted-foreground">{d('noData')}</p>
                    : <BarList ariaLabel={d('byProgram')} rows={barRows(a.by_program.map((p) => ({ key: p.key, count: p.count, p })), { labelOf: (_k, i) => pick(i.p, 'program_name'), limit: 6, otherLabel: t('alumni.admin.common.other') })} format={fmt.num} tone="ink" />)}
                </Query>
              </SectionCard>
              <SectionCard id="recent-invitations" title={d('recentInvitations')} action={<Link to={`${ROUTE}/invitations`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{d('seeAll')}</Link>}>
                <Query query={invitations} skeleton="h-32 w-full">
                  {(r) => (r.rows.length === 0
                    ? <p className="text-sm text-muted-foreground">{d('noInvitations')}</p>
                    : (
                      <ul className="divide-y">
                        {r.rows.map((i) => (
                          <li key={i.id} className="flex items-start justify-between gap-2 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold" dir="ltr">{i.email}</p>
                              <p className="truncate text-xs text-muted-foreground"><bdi>{d('toCompany', { company: pick(i, 'company_name') })}</bdi> · <bdi>{fmt.date(i.sent_at)}</bdi></p>
                            </div>
                            <Badge tone={statusTone(i.effective_status)}>{t(`alumni.admin.common.invStatus.${i.effective_status}`)}</Badge>
                          </li>
                        ))}
                      </ul>
                    ))}
                </Query>
              </SectionCard>
              <SectionCard id="recent-notifications" title={d('recentNotifications')} action={<Link to={`${ROUTE}/notifications`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{d('seeAll')}</Link>}>
                <Query query={broadcasts} skeleton="h-32 w-full">
                  {(r) => (r.rows.length === 0
                    ? <p className="text-sm text-muted-foreground">{d('noNotifications')}</p>
                    : (
                      <ul className="divide-y">
                        {r.rows.map((b) => (
                          <li key={b.broadcast_id} className="py-2">
                            <p className="truncate text-sm font-semibold">{pick(b, 'title')}</p>
                            <p className="text-xs text-muted-foreground"><bdi>{fmt.date(b.sent_at)}</bdi> · <bdi>{d('readOf', { reads: fmt.num(b.reads), recipients: fmt.num(b.recipients) })}</bdi></p>
                          </li>
                        ))}
                      </ul>
                    ))}
                </Query>
              </SectionCard>
            </div>
          </>
        )}
      </Query>
    </AdminPage>
  )
}

/** The to-do list of the registry: each line is a count and a door to the list that fixes it. Zero counts are left out. */
function Attention({ o, d, fmt }) {
  const annual = o.completeness.missing_by.find((m) => m.key === 'annual_update')?.count ?? 0
  const items = [
    { key: 'incomplete', label: d('attIncomplete'), count: o.completeness.incomplete, to: `${ROUTE}/directory?incomplete=true` },
    { key: 'never', label: d('attNever'), count: o.review.never, to: `${ROUTE}/directory?reviewed=false` },
    { key: 'changed', label: d('attChanged'), count: o.review.changed_since, to: `${ROUTE}/directory?reviewed=true` },
    { key: 'annual', label: d('attAnnual'), count: annual, to: `${ROUTE}/workspace?incomplete=true` },
    { key: 'pending', label: d('attPending'), count: o.invitations.pending, to: `${ROUTE}/invitations` },
    { key: 'candidates', label: d('attCandidates'), count: o.companies.candidates, to: `${ROUTE}/directory?scope=candidates` },
  ].filter((i) => i.count > 0)
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{d('attentionNone')}</p>
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.to} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span>{i.label}</span>
            <span className="rounded-full bg-surface px-2.5 py-0.5 font-semibold tabular-nums">{fmt.num(i.count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
