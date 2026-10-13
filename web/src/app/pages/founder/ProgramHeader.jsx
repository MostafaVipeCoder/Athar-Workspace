import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Clock } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { describeTimeZone } from '../../../lib/time/tz.js'
import { Img } from '../../../ui/Img.jsx'
import { cn } from '../../../lib/cn.js'
import { StatusBadges } from './ProgramCard.jsx'
import { useDateRange } from './useDateRange.js'
import './i18n.js'

/**
 * Header of the Program page (always present for a participant): back link, the project cover (= the agenda cover) with the
 * program and project names, the status chips, and the dates + the project zone when the PM exposed an agenda. A withdrawn
 * participant gets no cover and no dates (the page sends none).
 */
export default function ProgramHeader({ project, participant, restricted = false }) {
  const { t, lang, pick } = useLanguage()
  const range = useDateRange()
  const programName = pick(project.program ?? {}, 'name')
  const projectName = pick(project, 'name')
  const dates = range(project.start_date, project.end_date)
  const card = { status: participant?.status, completed: project.completed, withdrawal_requested: participant?.withdrawal_requested }
  const showCover = !restricted

  return (
    <header className="space-y-3" data-testid="program-header">
      <Link to="/alumni/founder/programs" className="tap-target inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t('founder.page.back')}
      </Link>
      <div className="overflow-hidden rounded-card">
        {showCover && project.cover_path ? (
          <Img src={publicImageUrl(project.cover_path)} thumb={publicThumbUrl(project.cover_path)} alt="" aspect="16 / 9" priority overlay="hero" className="w-full md:max-h-72">
            <div className="space-y-0.5 p-4">
              <p className="text-sm font-semibold text-athar-grey-100/80" dir="auto">{programName}</p>
              <h1 className="text-page-title text-athar-grey-100" dir="auto">{projectName}</h1>
            </div>
          </Img>
        ) : (
          <div className={cn('space-y-0.5 bg-athar-ink p-4', showCover ? 'pt-10' : 'pt-6')}>
            <p className="text-sm font-semibold text-athar-grey-100/80" dir="auto">{programName}</p>
            <h1 className="text-page-title text-athar-grey-100" dir="auto">{projectName}</h1>
          </div>
        )}
      </div>
      <StatusBadges program={card} />
      {!restricted && (dates || project.timezone) && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {dates && <li className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />{dates}</li>}
          {project.timezone && dates && (
            <li className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" />{t('founder.header.timezone', { tz: describeTimeZone(project.timezone, lang) })}</li>
          )}
        </ul>
      )}
    </header>
  )
}
