import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { useMyPrograms } from '../../../data/founder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState } from '../../../ui/States.jsx'
import { useAuth } from '../../AuthContext.js'
import ProgramCard from './ProgramCard.jsx'
import { ProgramsSkeleton } from './FounderProgramsPage.jsx'
import { splitPrograms } from './programLogic.js'
import HomeAlumniCards from './HomeAlumniCards.jsx'
import './i18n.js'

/**
 * /alumni/founder/dashboard - the lean founder Home (step 8): a greeting and the programs the founder takes part in, with a link to
 * the whole list; step 10 added the Alumni part (profile completeness, the next step, yearly figures due, unread notifications, shortcuts: HomeAlumniCards).
 */
export default function FounderHomePage() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const q = useMyPrograms()
  const { active } = useMemo(() => splitPrograms(q.data), [q.data])
  const name = (profile?.full_name ?? '').trim()
  const shown = active.slice(0, 3)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-section-title">{name ? t('founder.home.hello', { name }) : t('founder.home.welcome')}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t('founder.home.subtitle')}</p>
      </div>

      <HomeAlumniCards />

      <section className="space-y-3" aria-labelledby="home-programs">
        <h2 id="home-programs" className="text-card-title">{t('founder.home.programs')}</h2>
        {q.isPending ? (
          <ProgramsSkeleton count={1} />
        ) : q.error ? (
          <ErrorState error={q.error} title={t('founder.programs.loadFailed')} onRetry={q.refetch} />
        ) : shown.length === 0 ? (
          <EmptyState icon={Layers} title={t('founder.programs.empty')} body={t('founder.programs.emptyBody')} />
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2" data-testid="home-programs">
              {shown.map((p) => <li key={p.project_id} className="min-w-0"><ProgramCard program={p} /></li>)}
            </ul>
            <Link to="/alumni/founder/programs" className={buttonClass({ variant: 'outline', size: 'md', className: 'w-full sm:w-auto' })}>{t('founder.home.seeAll')}</Link>
          </>
        )}
      </section>
    </div>
  )
}
