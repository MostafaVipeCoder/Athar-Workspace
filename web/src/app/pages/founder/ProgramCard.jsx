import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { publicThumbUrl } from '../../../data/storage.js'
import { Img } from '../../../ui/Img.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { cn } from '../../../lib/cn.js'
import { statusTone } from './programLogic.js'
import { useDateRange } from './useDateRange.js'
import './i18n.js'

export function StatusBadges({ program, className }) {
  const { t } = useLanguage()
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Badge tone={statusTone(program.status)} data-testid="status-badge" data-status={program.status}>{t(`founder.status.${program.status}`)}</Badge>
      {program.completed && <Badge tone="green" data-testid="completed-badge">{t('founder.status.completed')}</Badge>}
      {program.withdrawal_requested && program.status !== 'withdrawn' && <Badge tone="outline">{t('founder.status.withdrawalRequested')}</Badge>}
    </div>
  )
}

/**
 * One program/project card (the Programs list and the Home shortcut). Mobile-first: cover with the dark overlay and the names on
 * it, then status + dates + location and a full-width target. A `restricted` card (withdrawn) carries the names and the status
 * only: no cover, no dates, no link into the content (03-6).
 */
export default function ProgramCard({ program }) {
  const { t, pick } = useLanguage()
  const range = useDateRange()
  const programName = pick(program, 'program_name')
  const projectName = pick(program, 'project_name')
  const place = pick(program, 'location')
  const dates = range(program.start_date, program.end_date)
  const restricted = Boolean(program.restricted)
  const href = `/alumni/founder/programs/${program.project_id}`
  const names = (
    <div className="relative z-10 space-y-0.5 p-4">
      <p className="text-xs font-semibold text-athar-grey-100/80" dir="auto">{programName}</p>
      <h3 className="font-sans text-xl font-bold leading-snug tracking-heading text-athar-grey-100" dir="auto">{projectName}</h3>
    </div>
  )

  // ONE link per card (the button); its ::after stretches over the whole card so the cover is a pointer target too, and the heading stays readable by assistive tech
  return (
    <article className="panel group relative overflow-hidden" data-testid="program-card" data-status={program.status}>
      {restricted ? (
        <div className="bg-athar-ink">{names}</div>
      ) : (
        <Img src={publicThumbUrl(program.cover_path)} variant="thumb" alt="" aspect={program.cover_path ? '16 / 9' : '3 / 1'} overlay="card" className={cn(!program.cover_path && 'bg-athar-ink [&>div:first-child]:hidden')} imgClassName="transition-transform duration-300 group-hover:scale-105">
          {names}
        </Img>
      )}
      <div className="space-y-3 p-4">
        <StatusBadges program={program} />
        {restricted && <p className="text-sm text-muted-foreground" data-testid="withdrawn-note">{t('founder.programs.withdrawnNote')}</p>}
        {!restricted && (dates || place) && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {dates && (
              <li className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{dates}</span></li>
            )}
            {place && (
              <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words" dir="auto">{place}</span></li>
            )}
          </ul>
        )}
        {!restricted && (
          <Link to={href} aria-label={t('founder.programs.open', { name: projectName })} className="tap-target inline-flex w-full items-center justify-between rounded-md bg-surface px-4 text-sm font-semibold transition-colors duration-300 after:absolute after:inset-0 after:z-20 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:bg-primary group-hover:text-primary-foreground">
            {t('founder.programs.openCard')}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  )
}
