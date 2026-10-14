import { Layers } from 'lucide-react'
import { useAlumniLookups } from '../../data/alumni.js'
import { lookupLabel } from '../../lib/alumni.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { EmptyState } from '../../ui/States.jsx'
import './i18n.company.js'

/**
 * Program Scope / Program Name / Support provided of one company (design 09 4.3): DERIVED from its participations, never typed. `programs` = the payload's `programs[]`.
 * Each entry reads "Program (the umbrella) > Project (the cohort)" with the support the project's nodes imply as chips (labels from the `support_kind` vocabulary).
 */
export default function ProgramsReadOnlyList({ programs = [], className }) {
  const { t, pick, lang, formatDate } = useLanguage()
  const lookups = useAlumniLookups()
  if (!programs.length) return <EmptyState icon={Layers} title={t('alumni.common.programsEmpty')} body={t('alumni.common.programsEmptyBody')} className={className} />
  return (
    <ul className={`space-y-3 ${className ?? ''}`} data-testid="programs-list">
      {programs.map((p) => {
        const dates = [p.start_date, p.end_date].filter(Boolean).map((d) => formatDate(`${String(d).slice(0, 10)}T12:00:00`, { dateStyle: 'medium' })).join(' - ')
        return (
          <li key={`${p.program_id}-${p.project_id}`} className="space-y-2 rounded-card border bg-card p-4" data-testid="program-entry">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{pick(p, 'program_name')}</p>
                <p className="text-base font-bold">{pick(p, 'project_name')}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {p.program_type && <Badge tone="outline">{p.program_type}</Badge>}
                {p.completed && <Badge tone="green">{t('alumni.common.programCompleted')}</Badge>}
              </div>
            </div>
            {dates && <p className="text-xs text-muted-foreground">{dates}</p>}
            {Array.isArray(p.support) && p.support.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('alumni.common.supportProvided')}</span>
                {p.support.map((k) => <Badge key={k} tone="blue">{lookupLabel(lookups.data, 'support_kind', k, lang)}</Badge>)}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
