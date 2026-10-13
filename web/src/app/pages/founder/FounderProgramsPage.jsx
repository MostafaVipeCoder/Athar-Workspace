import { useMemo, useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { useMyPrograms } from '../../../data/founder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import ProgramCard from './ProgramCard.jsx'
import { splitPrograms } from './programLogic.js'
import './i18n.js'

export function ProgramsSkeleton({ count = 2 }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="programs-skeleton">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}
    </div>
  )
}

/**
 * /alumni/founder/programs - one card per project the founder participates in (manually assigned or accepted through a
 * Selection). Active first, completed after. `withdrawn` participations are hidden from the list (02-7) and live in a collapsed
 * section as status-only cards (03-6). Mobile-first: one column, 16 px gutters, the whole card is the target.
 */
export default function FounderProgramsPage() {
  const { t, tn } = useLanguage()
  const q = useMyPrograms()
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const { active, withdrawn } = useMemo(() => splitPrograms(q.data), [q.data])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-section-title">{t('founder.programs.title')}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t('founder.programs.subtitle')}</p>
      </div>

      {q.isPending ? (
        <ProgramsSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} title={t('founder.programs.loadFailed')} onRetry={q.refetch} />
      ) : (
        <>
          {active.length === 0 ? (
            <EmptyState icon={Layers} title={t('founder.programs.empty')} body={t('founder.programs.emptyBody')} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2" data-testid="founder-programs">
              {active.map((p) => <li key={p.project_id} className="min-w-0"><ProgramCard program={p} /></li>)}
            </ul>
          )}
          {withdrawn.length > 0 && (
            <section className="space-y-3" data-testid="withdrawn-section">
              <button
                type="button"
                onClick={() => setShowWithdrawn((v) => !v)}
                aria-expanded={showWithdrawn}
                className="tap-target inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors duration-300 hover:text-primary"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showWithdrawn ? 'rotate-180' : ''}`} aria-hidden="true" />
                {tn('founder.programs.withdrawnToggle', withdrawn.length)}
              </button>
              {showWithdrawn && (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {withdrawn.map((p) => <li key={p.project_id} className="min-w-0"><ProgramCard program={p} /></li>)}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
