import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, GitMerge, Layers, LineChart, MailPlus, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { alumniKeys, deleteCompanySnapshot, getAlumniCompany, saveAlumniCompany, upsertCompanySnapshot, useAlumniCompany } from '../../../data/alumni.js'
import { removeObjects } from '../../../data/storage.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { parseAlumniError } from '../../../lib/alumni.js'
import { buildCompanyPatch, COMPANY_MISSING_SECTION, companyToForm, fieldErrorOf, validateCompanyForm } from '../../../lib/alumniForms.js'
import { useAuth } from '../../AuthContext.js'
import { CompletenessMeter, ProfileSection } from '../../../shared/alumni/blocks.jsx'
import { scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import { CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection, CompanyOnlineSection, CompanyStatusSection, DirectoryVisibilitySection } from '../../../shared/alumni/CompanySections.jsx'
import MetricsTable from '../../../shared/alumni/MetricsTable.jsx'
import ProgramsReadOnlyList from '../../../shared/alumni/ProgramsReadOnlyList.jsx'
import SaveBar from '../../../shared/alumni/SaveBar.jsx'
import TrendBars from '../../../shared/alumni/TrendBars.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { useDraftForm } from '../../../shared/alumni/useDraftForm.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import { CompanyLogo } from './ui.jsx'
import ManagerFields from './ManagerFields.jsx'
import CompanyAdminTeam from './CompanyAdminTeam.jsx'
import { CertificateLinks, CompanyInvitations, CompanyMerge } from './CompanyExtras.jsx'
import { reviewState } from './columns.js'
import { useAdminErrorText, useLabels } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'

const sectionOfField = (field) => (['name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on'].includes(field) ? 'basics'
  : ['startup_type', 'sector', 'subsector', 'stage', 'legal_status'].includes(field) ? 'classification'
  : ['governorate', 'location_en', 'location_ar'].includes(field) ? 'location'
  : ['website_url', 'app_url', 'linkedin_url', 'links'].includes(field) || field.startsWith('links.') ? 'online'
  : ['operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note'].includes(field) ? 'status' : 'directory')

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

/** The editable profile of one company (or an empty one to create). The draft keeps the manager's edits; Save sends only what changed, with the version the form loaded. */
function CompanyEditor({ payload, create = false }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { refresh, fetchFresh } = useAlumniRefresh()
  const company = payload.company
  const form = useDraftForm(() => companyToForm(company), {
    version: company.updated_at ?? 'new',
    isDirty: (values, base) => Object.keys(buildCompanyPatch(base, values)).length > 0,
    onDiscard: (paths) => removeObjects('public-assets', paths.flatMap((p) => [p, p.replace(/\.webp$/, '_t.webp')])),
  })
  const { values, base, set: setField, setMany: setManyFields } = form
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)

  const patch = buildCompanyPatch(base, values)
  const changeCount = Object.keys(patch).length
  const dirty = changeCount > 0
  const clientErrors = validateCompanyForm(values)
  const shown = Object.fromEntries(Object.entries(clientErrors).filter(([k]) => submitted || k !== 'name_ar').map(([k, key]) => [k, t(key)]))
  const errors = { ...shown, ...serverErrors }
  const set = useCallback((key, value) => { setField(key, value); setServerErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e)) }, [setField])
  const setMany = useCallback((p) => { setManyFields(p); setServerErrors((e) => (Object.keys(p).some((k) => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))) : e)) }, [setManyFields])

  function undo() { form.reset(); setServerErrors({}); setSubmitted(false); setStale(false) }

  async function save() {
    setSubmitted(true)
    setServerErrors({})
    const found = Object.keys(clientErrors)
    if (found.length) { scrollToSection(sectionOfField(found[0])); return }
    setBusy(true)
    try {
      const saved = await saveAlumniCompany(create ? null : company.id, patch, create ? null : form.version)
      await refresh()
      if (create) {
        toast.success(d('created'))
        navigate(`/alumni/admin/company/${saved.company.id}`, { replace: true })
        return
      }
      form.rebase(companyToForm(saved.company), saved.company.updated_at)
      setStale(false)
      toast.success(d('saved'))
    } catch (err) {
      const parsed = parseAlumniError(err)
      if (parsed.token === 'alumni_stale') setStale(true)
      else {
        const fe = fieldErrorOf(parsed)
        if (fe) { setServerErrors({ [fe.field]: t(fe.key) }); scrollToSection(sectionOfField(fe.field)) }
        toast.error(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }
  async function reloadKeepingMine() {
    const fresh = await fetchFresh(alumniKeys.adminCompany(company.id), () => getAlumniCompany(company.id))
    form.rebase(companyToForm(fresh.company), fresh.company.updated_at, Object.keys(patch))
    setStale(false)
  }

  const saveYear = async (year, data) => { await upsertCompanySnapshot(company.id, year, data); await refresh(); toast.success(d('yearSaved')) }
  const deleteYear = async (year) => { await deleteCompanySnapshot(company.id, year); await refresh(); toast.success(d('yearDeleted')) }

  const sections = [
    { id: 'basics', label: t('alumni.common.basicsTitle') }, { id: 'classification', label: t('alumni.common.classificationTitle') }, { id: 'location', label: t('alumni.common.locationTitle') },
    { id: 'online', label: t('alumni.common.onlineTitle') }, { id: 'status', label: t('alumni.common.statusTitle') }, { id: 'directory', label: t('alumni.common.directoryTitle') },
    ...(create ? [] : [{ id: 'manager', label: d('managerTitle') }, { id: 'team', label: d('teamTitle') }, { id: 'metrics', label: d('metricsTitle') }, { id: 'programs', label: d('programsTitle') }, { id: 'invitations', label: d('invTitle') }, { id: 'merge', label: d('mergeTitle') }]),
  ]

  return (
    <div className="space-y-5 pb-24" data-testid="admin-company">
      <UnsavedGuard when={dirty && !busy} />
      <Link to="/alumni/admin/directory" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{d('back')}</Link>
      {create ? (
        <header className="space-y-1 rounded-card border bg-card p-4"><h1 className="text-section-title">{d('newTitle')}</h1><p className="text-sm text-muted-foreground">{d('newBody')}</p></header>
      ) : (
        <>
          <Header company={company} />
          <div className="rounded-card border bg-card p-4">
            <CompletenessMeter percent={company.completeness?.percent} missing={company.completeness?.missing ?? []} labelFor={(k) => t(`alumni.common.missing.${k}`)} sectionFor={(k) => COMPANY_MISSING_SECTION[k]} />
          </div>
        </>
      )}
      <SectionChips sections={sections} />

      {stale && (
        <div role="alert" className="space-y-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="stale-banner">
          <p className="font-bold">{d('stale')}</p>
          <p>{d('staleBody')}</p>
          <Button variant="outline" size="sm" onClick={reloadKeepingMine}><RefreshCw className="h-4 w-4" aria-hidden="true" />{d('staleReload')}</Button>
        </div>
      )}

      <CompanyBasicsSection values={values} set={set} setMany={setMany} errors={errors} userId={user?.id} track={form.track} disabled={busy} />
      <CompanyClassificationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <CompanyLocationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <CompanyOnlineSection values={values} set={set} errors={errors} disabled={busy} />
      <CompanyStatusSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <DirectoryVisibilitySection values={values} set={set} errors={errors} disabled={busy} blocked={Boolean(company.internal?.directory_hidden)} isAlumni={Boolean(company.is_alumni)} />

      {!create && (
        <>
          <ProfileSection id="manager" icon={ShieldCheck} title={d('managerTitle')} description={d('managerDesc')}>
            <ManagerFields company={company} />
          </ProfileSection>
          <ProfileSection id="team" icon={Users} title={d('teamTitle')} description={d('teamDesc')}>
            <CompanyAdminTeam companyId={company.id} team={payload.team} counts={payload.counts} ceoFounderId={payload.ceo_founder_id} onChanged={refresh} />
          </ProfileSection>
          <ProfileSection id="metrics" icon={LineChart} title={d('metricsTitle')} description={d('metricsDesc')}>
            <TrendBars snapshots={payload.snapshots} />
            <MetricsTable snapshots={payload.snapshots} onSave={saveYear} onDelete={deleteYear} />
          </ProfileSection>
          <ProfileSection id="programs" icon={Layers} title={d('programsTitle')} description={d('programsDesc')}>
            <ProgramsReadOnlyList programs={payload.programs} />
            <CertificateLinks programs={payload.programs} />
          </ProfileSection>
          <ProfileSection id="invitations" icon={MailPlus} title={d('invTitle')}>
            <CompanyInvitations companyId={company.id} />
          </ProfileSection>
          <ProfileSection id="merge" icon={GitMerge} title={d('mergeTitle')}>
            <CompanyMerge company={company} onMerged={refresh} />
          </ProfileSection>
        </>
      )}

      <SaveBar visible={dirty || busy} count={changeCount} busy={busy} onSave={save} onUndo={undo} saveLabel={create ? d('createLabel') : undefined} className="bottom-0" />
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

/** M3: /alumni/admin/company/:id (and /company/new): everything about one company for a manager. */
export default function CompanyPage() {
  const { id } = useParams()
  if (id === 'new') return <CompanyEditor key="new" create payload={{ company: {}, team: [], counts: {}, programs: [], snapshots: [] }} />
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
