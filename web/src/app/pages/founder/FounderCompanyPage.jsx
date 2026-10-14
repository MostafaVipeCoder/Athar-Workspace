import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Globe2, Layers, LineChart, MapPin, RefreshCw, Users } from 'lucide-react'
import {
  alumniKeys, getMyCompanyProfile, removeCompanyTeamMember, saveCompanyTeamMember, saveMyCompanyProfile, setCompanyCeo, upsertCompanySnapshot, useAlumniLookups, useMyCompanyProfile,
} from '../../../data/alumni.js'
import { publicThumbUrl, removeObjects } from '../../../data/storage.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { Img } from '../../../ui/Img.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { lookupLabel, parseAlumniError } from '../../../lib/alumni.js'
import { buildCompanyPatch, COMPANY_MISSING_SECTION, companyToForm, fieldErrorOf, validateCompanyForm } from '../../../lib/alumniForms.js'
import { safeHttpUrl } from '../../../lib/alumniFounder.js'
import { useAuth } from '../../AuthContext.js'
import { CompletenessMeter, ProfileSection } from '../../../shared/alumni/blocks.jsx'
import { scrollToSection } from '../../../shared/alumni/scrollToSection.js'
import { CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection, CompanyOnlineSection, CompanyStatusSection, DirectoryVisibilitySection } from '../../../shared/alumni/CompanySections.jsx'
import MetricsTable from '../../../shared/alumni/MetricsTable.jsx'
import ProgramsReadOnlyList from '../../../shared/alumni/ProgramsReadOnlyList.jsx'
import SaveBar from '../../../shared/alumni/SaveBar.jsx'
import TeamEditor from '../../../shared/alumni/TeamEditor.jsx'
import TrendBars from '../../../shared/alumni/TrendBars.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { useDraftForm } from '../../../shared/alumni/useDraftForm.js'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import CoFounderInvite from './CoFounderInvite.jsx'
import SectionNav from './SectionNav.jsx'
import './alumni.i18n.js'
import './alumni.company.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'

const sectionOfField = (field) => (['name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on'].includes(field) ? 'basics'
  : ['startup_type', 'sector', 'subsector', 'stage', 'legal_status'].includes(field) ? 'classification'
  : ['governorate', 'location_en', 'location_ar'].includes(field) ? 'location'
  : ['website_url', 'app_url', 'linkedin_url', 'links'].includes(field) || field.startsWith('links.') ? 'online'
  : ['operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note'].includes(field) ? 'status' : 'directory')

function CompanySkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="company-skeleton">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** The public-style card of the company: logo, names, the chips that classify it, where it is, how to reach it online. Shows the SAVED data, not the draft. */
function CompanyCard({ company, programsCount }) {
  const { t, tn, lang, pick } = useLanguage()
  const lookups = useAlumniLookups()
  const label = (kind, key) => (key ? lookupLabel(lookups.data, kind, key, lang) : '')
  const place = [label('governorate', company.governorate), pick(company, 'location')].filter(Boolean).join(' - ')
  const website = safeHttpUrl(company.website_url)
  const app = safeHttpUrl(company.app_url)
  return (
    <header className="overflow-hidden rounded-card border bg-card" data-testid="company-card">
      <div className="h-16 bg-primary" aria-hidden="true" />
      <div className="space-y-3 px-4 pb-4">
        <div className="-mt-9 flex items-end gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-card border-4 border-card bg-surface shadow-image">
            <Img src={company.logo_path ? publicThumbUrl(company.logo_path) : undefined} alt="" aspect="1 / 1" eager />
          </div>
          <div className="min-w-0 pb-1">
            <h1 className="text-section-title break-words" data-testid="company-name">{pick(company, 'name') || t('alumni.common.notSet')}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {company.sector && <Badge tone="blue">{label('sector', company.sector)}</Badge>}
          {company.subsector && <Badge tone="outline">{label('subsector', company.subsector)}</Badge>}
          {company.stage && <Badge tone="outline">{label('stage', company.stage)}</Badge>}
          {company.startup_type && <Badge tone="outline">{label('startup_type', company.startup_type)}</Badge>}
          <Badge tone={company.operating_status === 'closed' ? 'red' : 'green'}>{label('operating_status', company.operating_status)}</Badge>
          {company.is_alumni && <Badge tone="amber">{t('alumni.founder.company.alumniBadge')}</Badge>}
        </div>
        {pick(company, 'description') && <p dir="auto" className="whitespace-pre-line text-sm" data-testid="company-description">{pick(company, 'description')}</p>}
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {place && <div className="flex items-center gap-2"><dt className="sr-only">{t('alumni.common.governorate')}</dt><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd>{place}</dd></div>}
          {company.established_on && <div className="flex items-center gap-2"><dt className="text-muted-foreground">{t('alumni.founder.company.established')}</dt><dd>{company.established_on.slice(0, 4)}</dd></div>}
          {programsCount > 0 && <div className="flex items-center gap-2"><Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd>{tn('alumni.founder.company.programsCount', programsCount)}</dd></div>}
        </dl>
        {(website || app || (company.links ?? []).length > 0 || company.linkedin_url) && (
          <ul className="flex flex-wrap gap-2" aria-label={t('alumni.common.onlineTitle')}>
            {website && <li><a href={website} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm' })}><Globe2 className="h-4 w-4" aria-hidden="true" />{t('alumni.common.website')}</a></li>}
            {app && <li><a href={app} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('alumni.common.app')}</a></li>}
            {safeHttpUrl(company.linkedin_url) && <li><a href={safeHttpUrl(company.linkedin_url)} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('alumni.common.linkedin')}</a></li>}
            {(company.links ?? []).filter((l) => safeHttpUrl(l.url)).map((l) => (
              <li key={`${l.kind}-${l.url}`}><a href={safeHttpUrl(l.url)} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'ghost', size: 'sm' })}>{l.label || t(`alumni.common.link.${l.kind}`)}</a></li>
            ))}
          </ul>
        )}
      </div>
    </header>
  )
}

/** The form + the team + the yearly figures + the derived programs of one company. */
function CompanyEditor({ payload }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const location = useLocation()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const { refresh, fetchFresh } = useAlumniRefresh()
  const { company } = payload
  const hash = location.hash
  // a link such as /company/<id>#metrics (the Progress page, the Home) lands on its section
  useEffect(() => { if (hash) scrollToSection(hash.slice(1)) }, [hash])

  const form = useDraftForm(() => companyToForm(company), {
    version: company.updated_at,
    isDirty: (values, base) => Object.keys(buildCompanyPatch(base, values)).length > 0,
    onDiscard: (paths) => removeObjects('public-assets', paths.flatMap((p) => [p, p.replace(/\.webp$/, '_t.webp')])),
  })
  const { values, base } = form
  const { set: setField, setMany: setManyFields } = form
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

  const set = useCallback((key, value) => {
    setField(key, value)
    setServerErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e))
  }, [setField])
  const setMany = useCallback((patchValues) => {
    setManyFields(patchValues)
    setServerErrors((e) => (Object.keys(patchValues).some((k) => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patchValues))) : e))
  }, [setManyFields])

  function undo() {
    form.reset()
    setServerErrors({})
    setSubmitted(false)
    setStale(false)
  }

  async function save() {
    setSubmitted(true)
    setServerErrors({})
    const found = Object.keys(clientErrors)
    if (found.length) { scrollToSection(sectionOfField(found[0])); return }
    setBusy(true)
    try {
      const saved = await saveMyCompanyProfile(company.id, patch, form.version)
      await refresh()
      form.rebase(companyToForm(saved.company), saved.company.updated_at)
      setStale(false)
      toast.success(t('alumni.founder.saved'))
    } catch (err) {
      const parsed = parseAlumniError(err)
      if (parsed.token === 'alumni_stale') {
        setStale(true)
      } else {
        const fe = fieldErrorOf(parsed)
        if (fe) {
          setServerErrors({ [fe.field]: t(fe.key) })
          scrollToSection(sectionOfField(fe.field))
        }
        toast.error(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  // someone else saved first: take their version and put MY edits back on top (only the keys I changed)
  async function reloadKeepingMine() {
    const fresh = await fetchFresh(alumniKeys.myCompany(company.id), () => getMyCompanyProfile(company.id))
    form.rebase(companyToForm(fresh.company), fresh.company.updated_at, Object.keys(patch))
    setStale(false)
  }

  const team = {
    save: async (founderId, p) => { await saveCompanyTeamMember(company.id, founderId, p); await refresh() },
    remove: async (founderId) => { await removeCompanyTeamMember(company.id, founderId); await refresh() },
    ceo: async (founderId) => { await setCompanyCeo(company.id, founderId); await refresh() },
  }
  const saveYear = async (year, data) => { await upsertCompanySnapshot(company.id, year, data); await refresh() }

  const sections = [
    { id: 'basics', label: t('alumni.founder.nav.basics') }, { id: 'classification', label: t('alumni.founder.nav.classification') },
    { id: 'location', label: t('alumni.founder.nav.location') }, { id: 'online', label: t('alumni.founder.nav.online') },
    { id: 'status', label: t('alumni.founder.nav.status') }, { id: 'directory', label: t('alumni.founder.nav.directory') },
    { id: 'team', label: t('alumni.founder.nav.team') }, { id: 'metrics', label: t('alumni.founder.nav.metrics') }, { id: 'programs', label: t('alumni.founder.nav.programs') },
  ]

  return (
    <div className="space-y-5 pb-28" data-testid="founder-company">
      <UnsavedGuard when={dirty && !busy} />
      <Link to="/alumni/founder/profile" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('alumni.founder.company.back')}</Link>
      {location.state?.created && (
        <div role="status" className="rounded-card border border-accent bg-accent/20 p-4 text-sm" data-testid="created-banner">
          <p className="font-bold">{t('alumni.founder.company.createdTitle')}</p>
          <p>{t('alumni.founder.company.createdBody')}</p>
        </div>
      )}
      <CompanyCard company={company} programsCount={payload.programs?.length ?? 0} />
      <div className="rounded-card border bg-card p-4">
        <CompletenessMeter
          title={t('alumni.founder.company.completeness')}
          percent={company.completeness?.percent}
          missing={company.completeness?.missing ?? []}
          labelFor={(k) => t(`alumni.common.missing.${k}`)}
          sectionFor={(k) => COMPANY_MISSING_SECTION[k]}
        />
      </div>
      <SectionNav sections={sections} label={t('alumni.founder.nav.label')} />

      {stale && (
        <div role="alert" className="space-y-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="stale-banner">
          <p className="font-bold">{t('alumni.err.stale')}</p>
          <p>{t('alumni.founder.company.staleBody')}</p>
          <Button variant="outline" size="sm" onClick={reloadKeepingMine}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('alumni.founder.company.staleReload')}</Button>
        </div>
      )}

      <CompanyBasicsSection values={values} set={set} setMany={setMany} errors={errors} userId={user?.id} track={form.track} disabled={busy} />
      <CompanyClassificationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <CompanyLocationSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <CompanyOnlineSection values={values} set={set} errors={errors} disabled={busy} />
      <CompanyStatusSection values={values} set={set} setMany={setMany} errors={errors} disabled={busy} />
      <DirectoryVisibilitySection values={values} set={set} errors={errors} disabled={busy} blocked={company.directory_blocked} isAlumni={company.is_alumni} />

      <ProfileSection id="team" icon={Users} title={t('alumni.founder.company.teamTitle')} description={t('alumni.founder.company.teamDesc')}>
        <TeamEditor team={payload.team} counts={payload.counts} ceoFounderId={payload.ceo_founder_id} onSaveMember={team.save} onRemove={team.remove} onSetCeo={team.ceo} />
        <CoFounderInvite companyId={company.id} />
      </ProfileSection>

      <ProfileSection id="metrics" icon={LineChart} title={t('alumni.founder.company.metricsTitle')} description={t('alumni.founder.company.metricsDesc')}>
        <TrendBars snapshots={payload.snapshots} />
        <MetricsTable snapshots={payload.snapshots} onSave={saveYear} />
      </ProfileSection>

      <ProfileSection id="programs" icon={Layers} title={t('alumni.founder.company.programsTitle')} description={t('alumni.founder.company.programsDesc')}>
        <ProgramsReadOnlyList programs={payload.programs} />
      </ProfileSection>

      <SaveBar visible={dirty || busy} count={changeCount} busy={busy} onSave={save} onUndo={undo} />
    </div>
  )
}

/** /alumni/founder/company/:id */
export default function FounderCompanyPage() {
  const { id } = useParams()
  const { t } = useLanguage()
  const q = useMyCompanyProfile(id)
  if (q.isPending) return <CompanySkeleton />
  if (q.error?.code === 'forbidden' || q.error?.code === 'not_found') {
    return (
      <EmptyState
        title={t('alumni.founder.company.notAvailable')}
        body={t('alumni.founder.company.notAvailableBody')}
        action={<Link to="/alumni/founder/profile" className={buttonClass({ variant: 'outline', className: 'mt-2' })}>{t('alumni.founder.company.back')}</Link>}
      />
    )
  }
  if (q.error) return <ErrorState error={q.error} title={t('alumni.founder.company.loadFailed')} onRetry={q.refetch} />
  return <CompanyEditor key={id} payload={q.data} />
}
