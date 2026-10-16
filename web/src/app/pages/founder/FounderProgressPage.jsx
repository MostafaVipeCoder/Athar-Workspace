import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Award, CheckCircle2, Circle, Compass, Layers, LineChart, Rocket } from 'lucide-react'
import { useMyAlumniProfile } from '../../../data/alumni.js'
import { useAllMyCertificates } from '../../../data/alumniFounder.js'
import { useMyPrograms } from '../../../data/founder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '../../../ui/States.jsx'
import { buildMilestones, milestonePercent, nextMilestone, overallCompleteness } from '../../../lib/alumniProgress.js'
import { cn } from '../../../lib/cn.js'
import { CompletenessMeter, ProfileSection } from '../../../shared/alumni/blocks.jsx'
import FiguresPanel from '../../../shared/alumni/FiguresPanel.jsx'
import { statusTone } from './programLogic.js'
import './i18n.js'
import './alumni.i18n.js'
import './alumni.progress.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.company.js'
import '../../../shared/alumni/i18n.quarters.js'
import '../../../shared/alumni/i18n.closed.js'

/** The figures of the company the founder picked (the company of a reminder link comes in `?company=`): the quarter's draft, "confirm", and the closed quarters with their graphs. */
function CompaniesFigures({ companies, focus }) {
  const { t, pick } = useLanguage()
  const [picked, setPicked] = useState(null)
  const current = companies.find((c) => c.id === (picked ?? focus)) ?? companies[0]
  return (
    <div className="space-y-3" data-testid="progress-companies">
      {companies.length > 1 && (
        <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {companies.map((c) => (
            <button key={c.id} role="tab" type="button" aria-selected={c.id === current.id} onClick={() => setPicked(c.id)} className={cn('inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', c.id === current.id ? 'border-foreground bg-foreground text-background' : 'border-input bg-background hover:border-foreground')}>{pick(c, 'name')}</button>
          ))}
        </div>
      )}
      {current.operating_status === 'closed' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-accent bg-accent/20 p-4" data-testid="progress-company-closed">
          <Compass className="h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="font-bold">{t('alumni.closed.progressCardTitle')}</p><p className="text-sm">{t('alumni.closed.progressCardBody')}</p></div>
          <Link to={`/alumni/founder/after-closing?company=${current.id}`} className={buttonClass({ size: 'sm' })}>{t('alumni.closed.progressCardCta')}</Link>
        </div>
      ) : (
        <div className="rounded-card border bg-card p-4" data-testid="progress-company">
          <FiguresPanel key={current.id} companyId={current.id} audience="founder" companyName={pick(current, 'name')} />
        </div>
      )}
    </div>
  )
}

/** /alumni/founder/progress: REAL progress only (design 09 F6): the milestones are decided by the server's own completeness and lists, never by a mock. */
export default function FounderProgressPage() {
  const { t, pick, formatDate } = useLanguage()
  const [search] = useSearchParams()
  const profileQ = useMyAlumniProfile()
  const programsQ = useMyPrograms()
  const certsQ = useAllMyCertificates()

  if (profileQ.isPending || programsQ.isPending) return <div className="space-y-4" role="status" aria-busy="true"><span className="sr-only">{t('common.loading')}</span><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
  if (profileQ.error) return <ErrorState error={profileQ.error} title={t('alumni.founder.progress.loadFailed')} onRetry={profileQ.refetch} />

  const profile = profileQ.data
  const focused = profile.companies.find((c) => c.id === search.get('company'))
  if (focused?.operating_status === 'closed') return <Navigate to={`/alumni/founder/after-closing?company=${focused.id}`} replace />
  const programs = (programsQ.data ?? []).filter((p) => p.status !== 'withdrawn')
  const certificates = certsQ.data ?? []
  const milestones = buildMilestones({ profile, programs: programsQ.data ?? [], certificates })
  const percent = milestonePercent(milestones)
  const next = nextMilestone(milestones)
  const overall = overallCompleteness(profile)

  return (
    <div className="space-y-5" data-testid="founder-progress">
      <div>
        <h1 className="text-section-title">{t('alumni.founder.progress.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('alumni.founder.progress.subtitle')}</p>
      </div>

      <section aria-labelledby="journey" className="space-y-4 rounded-card border bg-card p-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="journey" className="text-card-title">{t('alumni.founder.progress.journey')}</h2>
            <span className="text-lg font-bold" data-testid="journey-percent">{percent}%</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-labelledby="journey" className="h-2.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{t('alumni.founder.progress.journeyCount', { done: milestones.filter((m) => m.done).length, total: milestones.length })}</p>
        </div>
        <ol className="space-y-2">
          {milestones.map((m) => (
            <li key={m.key} className={cn('flex items-center gap-3 rounded-input border p-3', m.done ? 'border-success/30 bg-success/5' : 'bg-background')} data-testid="milestone" data-done={m.done}>
              {m.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 text-sm font-medium">{t(`alumni.founder.progress.milestone.${m.key}`)}<span className="sr-only"> - {m.done ? t('alumni.founder.progress.done') : t('alumni.founder.progress.todo')}</span></span>
              {!m.done && m.to && <Link to={m.to} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('alumni.founder.progress.doIt')}</Link>}
            </li>
          ))}
        </ol>
        {next?.to && (
          <p className="flex items-center gap-2 rounded-input bg-accent/20 p-3 text-sm" data-testid="next-step">
            <Rocket className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">{t('alumni.founder.progress.nextStep')}</span> {t(`alumni.founder.progress.milestone.${next.key}`)}</span>
          </p>
        )}
      </section>

      {overall !== null && (
        <div className="rounded-card border bg-card p-4">
          <CompletenessMeter title={t('alumni.founder.progress.completeness')} percent={overall} missing={[]} />
        </div>
      )}

      <ProfileSection id="progress-programs" icon={Layers} title={t('alumni.founder.progress.programsTitle')}>
        {programsQ.error ? (
          <p role="alert" className="text-sm text-destructive-text">{t('alumni.founder.progress.blockFailed')}</p>
        ) : programs.length === 0 ? (
          <EmptyState icon={Layers} title={t('founder.programs.empty')} body={t('founder.programs.emptyBody')} />
        ) : (
          <ul className="space-y-2" data-testid="progress-programs">
            {programs.map((p) => (
              <li key={p.project_id} className="flex flex-wrap items-center gap-2 rounded-input border p-3">
                <Link to={`/alumni/founder/programs/${p.project_id}`} className="min-w-0 flex-1 break-words font-semibold text-primary hover:underline">{pick(p, 'project_name') || pick(p, 'program_name')}</Link>
                <Badge tone={statusTone(p.status)}>{t(`founder.status.${p.status}`)}</Badge>
                {p.completed && <Badge tone="green">{t('founder.status.completed')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection id="progress-certificates" icon={Award} title={t('alumni.founder.progress.certificatesTitle')}>
        {certsQ.isPending ? <Skeleton className="h-16 w-full" /> : certsQ.error ? (
          <p role="alert" className="text-sm text-destructive-text">{t('alumni.founder.progress.blockFailed')}</p>
        ) : certificates.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-certificates">{t('alumni.founder.progress.noCertificates')}</p>
        ) : (
          <ul className="space-y-2" data-testid="progress-certificates">
            {certificates.map((c) => (
              <li key={c.certificate_id} className="flex flex-wrap items-center gap-2 rounded-input border p-3 text-sm">
                <span className="min-w-0 flex-1 break-words font-semibold">{c.project_name || c.program_name}</span>
                {c.issued_at && <span className="text-xs text-muted-foreground">{formatDate(c.issued_at, { dateStyle: 'medium' })}</span>}
                {c.project_id && <Link to={`/alumni/founder/programs/${c.project_id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('alumni.founder.progress.openCertificate')}</Link>}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection id="progress-figures" icon={LineChart} title={t('alumni.founder.progress.figuresTitle')} description={t('alumni.founder.progress.figuresDesc')}>
        {profile.companies.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title={t('alumni.founder.progress.noCompany')}
            body={t('alumni.founder.progress.noCompanyBody')}
            action={<Link to="/alumni/founder/company/new" className={buttonClass({ className: 'mt-2' })}>{t('alumni.founder.profile.createCompany')}</Link>}
          />
        ) : (
          <CompaniesFigures companies={profile.companies} focus={search.get('company')} />
        )}
      </ProfileSection>
    </div>
  )
}
