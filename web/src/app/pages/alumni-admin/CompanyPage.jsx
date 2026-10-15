import { useEffect } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, GitMerge, History, Layers, LineChart, MailPlus, ShieldCheck, Users } from 'lucide-react'
import { useAlumniCompany, useAlumniStamps } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { COMPANY_MISSING_SECTION } from '../../../lib/alumniForms.js'
import { RULE_SECTION } from '../../../lib/alumniAttention.js'
import { CompletenessMeter, ProfileSection } from '../../../shared/alumni/blocks.jsx'
import { highlightSection, scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import MetricsTable from '../../../shared/alumni/MetricsTable.jsx'
import ProgramsReadOnlyList from '../../../shared/alumni/ProgramsReadOnlyList.jsx'
import StampLine from '../../../shared/alumni/StampLine.jsx'
import TrendBars from '../../../shared/alumni/TrendBars.jsx'
import { CompanyLogo } from './ui.jsx'
import ManagerFields from './ManagerFields.jsx'
import CompanyAdminTeam from './CompanyAdminTeam.jsx'
import CompanyProfileForm from './CompanyProfileForm.jsx'
import HistoryPanel from './HistoryPanel.jsx'
import { CertificateLinks, CompanyInvitations, CompanyMerge } from './CompanyExtras.jsx'
import { useCompanyActions } from './useCompanyActions.js'
import { reviewState } from './columns.js'
import { useLabels } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'
import './company.edit.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'
import '../../../shared/alumni/i18n.edit.js'

function Header({ company }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const labels = useLabels()
  const review = reviewState({ reviewed_at: company.internal?.reviewed_at, updated_at: company.updated_at })
  const place = [labels.label('governorate', company.governorate), pick(company, 'location')].filter(Boolean).join(' - ')
  return (
    <header className="flex flex-wrap items-start gap-4 rounded-card border bg-card p-4" data-testid="company-header">
      <CompanyLogo path={company.logo_path} size={72} />
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-section-title break-words">{pick(company, 'name') || '—'}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={company.is_alumni ? 'blue' : 'outline'}>{company.is_alumni ? d('alumniBadge') : d('notAlumniBadge')}</Badge>
          <Badge tone={company.operating_status === 'closed' ? 'red' : 'green'}>{company.operating_status === 'closed' ? d('closed') : d('open')}</Badge>
          <Badge tone={review === 'current' ? 'green' : review === 'changed' ? 'amber' : 'outline'}>{d(`review.${review}`)}</Badge>
          <Badge tone="neutral">{d('visibilityBadge', { value: labels.label('directory_visibility', company.directory_visibility) })}</Badge>
          {company.sector && <Badge tone="outline">{labels.label('sector', company.sector)}</Badge>}
          {company.stage && <Badge tone="outline">{labels.label('stage', company.stage)}</Badge>}
        </div>
        {place && <p className="text-sm text-muted-foreground">{place}</p>}
        <StampLine audience="manager" stamp={company.updated_source ? { at: company.updated_at, source: company.updated_source } : null} />
      </div>
    </header>
  )
}

function SectionChips({ sections }) {
  const { t } = useLanguage()
  return (
    <nav aria-label={t('nav.sections')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {sections.map((s) => (
        <button key={s.id} type="button" onClick={() => scrollToSection(s.id)} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-input bg-background px-3 text-sm font-semibold hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{s.label}</button>
      ))}
    </nav>
  )
}

/**
 * Everything about one company for a manager (design 09 M3): the editable profile (CompanyProfileForm), the manager-only fields, the team (every founder editable, national ID, bio,
 * LinkedIn), the yearly figures (edit, review, delete), the derived programs, the HISTORY of edits (and the company at any date), invitations and merge. Each section shows who edited
 * it last. A deep link from the needs-attention queue (`?focus=<item>#<section>`) scrolls to the section, highlights it and opens the form that fixes the item.
 */
function CompanyEditor({ payload }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const [search] = useSearchParams()
  const location = useLocation()
  const company = payload.company
  const stamps = useAlumniStamps(company.id)
  const actions = useCompanyActions(payload)
  const stampOf = (section) => { const x = stamps.data?.sections?.[section]; return x ? <StampLine audience="manager" stamp={{ at: x.at, source: x.source, name: x.name }} /> : null }

  const focusRule = search.get('focus')
  // a link such as /company/<id>?focus=sector#classification lands on its section, highlighted (once, after the first paint)
  const target = (focusRule && RULE_SECTION[focusRule]) || location.hash.slice(1) || null
  useEffect(() => {
    if (!target) return undefined
    const id = setTimeout(() => { scrollToSection(target, { smooth: false }); highlightSection(target) }, 150)
    return () => clearTimeout(id)
  }, [target])

  const sections = [
    { id: 'basics', label: t('alumni.common.basicsTitle') }, { id: 'classification', label: t('alumni.common.classificationTitle') }, { id: 'location', label: t('alumni.common.locationTitle') },
    { id: 'online', label: t('alumni.common.onlineTitle') }, { id: 'status', label: t('alumni.common.statusTitle') }, { id: 'directory', label: t('alumni.common.directoryTitle') },
    { id: 'manager', label: d('managerTitle') }, { id: 'team', label: d('teamTitle') }, { id: 'metrics', label: d('metricsTitle') }, { id: 'programs', label: d('programsTitle') },
    { id: 'history', label: d('historyTitle') }, { id: 'invitations', label: d('invTitle') }, { id: 'merge', label: d('mergeTitle') },
  ]

  return (
    <div className="space-y-5 pb-28" data-testid="admin-company">
      <Link to="/alumni/admin/directory" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{d('back')}</Link>
      <Header company={company} />
      <div className="rounded-card border bg-card p-4">
        <CompletenessMeter percent={company.completeness?.percent} missing={company.completeness?.missing ?? []} labelFor={(k) => t(`alumni.common.missing.${k}`)} sectionFor={(k) => COMPANY_MISSING_SECTION[k]} />
      </div>
      <SectionChips sections={sections} />

      <CompanyProfileForm payload={payload} />

      <ProfileSection id="manager" icon={ShieldCheck} title={d('managerTitle')} description={d('managerDesc')} stamp={stampOf('manager')}>
        <ManagerFields company={company} />
      </ProfileSection>
      <ProfileSection id="team" icon={Users} title={d('teamTitle')} description={d('teamDesc')} stamp={stampOf('team')}>
        <CompanyAdminTeam companyId={company.id} team={payload.team} counts={payload.counts} ceoFounderId={payload.ceo_founder_id} onChanged={actions.refresh} founderStamps={stamps.data?.founders ?? []} autoOpen={focusRule} />
      </ProfileSection>
      <ProfileSection id="metrics" icon={LineChart} title={d('metricsTitle')} description={d('metricsDesc')} stamp={stampOf('metrics')}>
        <TrendBars snapshots={payload.snapshots} />
        <MetricsTable snapshots={payload.snapshots} onSave={actions.saveYear} onDelete={actions.deleteYear} onReload={actions.reloadYear} onReview={actions.reviewYear} audience="manager" yearStamps={stamps.data?.years ?? []} />
      </ProfileSection>
      <ProfileSection id="programs" icon={Layers} title={d('programsTitle')} description={d('programsDesc')}>
        <ProgramsReadOnlyList programs={payload.programs} />
        <CertificateLinks programs={payload.programs} />
      </ProfileSection>
      <ProfileSection id="history" icon={History} title={d('historyTitle')} description={d('historyDesc')}>
        <HistoryPanel companyId={company.id} />
      </ProfileSection>
      <ProfileSection id="invitations" icon={MailPlus} title={d('invTitle')}>
        <CompanyInvitations companyId={company.id} />
      </ProfileSection>
      <ProfileSection id="merge" icon={GitMerge} title={d('mergeTitle')}>
        <CompanyMerge company={company} onMerged={actions.refresh} />
      </ProfileSection>
    </div>
  )
}

function Loading() {
  const { t } = useLanguage()
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-28 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" />
    </div>
  )
}

/** The empty company of /company/new: the same form, nothing else (the team, figures and history need a company to belong to). */
function NewCompany() {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  return (
    <div className="space-y-5 pb-28" data-testid="admin-company">
      <Link to="/alumni/admin/directory" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{d('back')}</Link>
      <header className="space-y-1 rounded-card border bg-card p-4"><h1 className="text-section-title">{d('newTitle')}</h1><p className="text-sm text-muted-foreground">{d('newBody')}</p></header>
      <CompanyProfileForm create payload={{ company: {}, team: [], counts: {}, programs: [], snapshots: [] }} />
    </div>
  )
}

/** M3: /alumni/admin/company/:id (and /company/new): everything about one company for a manager. */
export default function CompanyPage() {
  const { id } = useParams()
  if (id === 'new') return <NewCompany key="new" />
  return <Existing id={id} />
}

function Existing({ id }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const q = useAlumniCompany(id)
  if (q.isPending) return <Loading />
  if (q.error?.code === 'not_found' || q.error?.code === 'forbidden' || q.error?.code === 'validation') {
    return <EmptyState title={d('notFound')} action={<Link to="/alumni/admin/directory" className={buttonClass({ variant: 'outline', className: 'mt-2' })}>{d('back')}</Link>} />
  }
  if (q.error) return <ErrorState error={q.error} title={d('loadFailed')} onRetry={() => q.refetch()} />
  return <CompanyEditor key={id} payload={q.data} />
}
