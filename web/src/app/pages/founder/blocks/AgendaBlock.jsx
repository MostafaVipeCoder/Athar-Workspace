import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { useFounderBlock } from '../../../../data/founder.js'
import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import { formatCalendarDate } from '../../../../lib/time/format.js'
import { to12h } from '../../../../lib/time/slots.js'
import { Badge } from '../../../../ui/Badge.jsx'
import { Skeleton } from '../../../../ui/States.jsx'
import FounderAgendaButtons from '../FounderAgendaButtons.jsx'
import { nextUp, slotTitle } from '../programLogic.js'
import '../i18n.js'

/** "Happening now / Next up": one line from the agenda payload (project-zone clock). Nothing while the agenda has no dated session left. */
function NextUp({ projectId, nodeId }) {
  const { t, lang } = useLanguage()
  const q = useFounderBlock(projectId, 'agenda', nodeId)
  const data = q.data?.data
  const next = useMemo(() => (data ? nextUp(data.days, data.timezone) : null), [data])
  if (q.isPending) return <Skeleton className="h-14 w-full" />
  if (q.error || !next) return null
  const title = slotTitle(next.slot, lang)
  // every time is its own bidi isolate: an Arabic AM/PM marker between two numbers would otherwise reorder the range
  const time = (
    <>
      <bdi>{to12h(next.slot.start, lang)}</bdi>
      {next.slot.end ? <> - <bdi>{to12h(next.slot.end, lang)}</bdi></> : null}
    </>
  )
  const label = next.kind === 'now' ? t('founder.agenda.now') : next.kind === 'next' ? t('founder.agenda.next') : t('founder.agenda.upcoming')
  const when = next.kind === 'upcoming' ? <>{formatCalendarDate(next.day.date, { lang, style: 'medium' })}{lang === 'ar' ? '، ' : ', '}{time}</> : time
  return (
    <div className="flex items-start gap-3 rounded-md bg-surface p-3" data-testid="agenda-next-up" data-kind={next.kind}>
      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <Badge tone={next.kind === 'now' ? 'amber' : 'blue'}>{label}</Badge>
        <p className="break-words font-semibold" dir="auto">{title || when}</p>
        {title && <p className="text-sm text-muted-foreground">{when}</p>}
      </div>
    </div>
  )
}

/**
 * The agenda block: one card per exposed agenda node = the "Program Agenda" button (FounderAgendaButtons, which opens THAT
 * project's agenda only) + what is next. The button needs no extra request (the rows come with the page).
 */
export default function AgendaBlock({ block, projectId }) {
  const items = block.data?.items ?? []
  return (
    <div className="space-y-3" data-testid="agenda-block">
      {items.map((a) => (
        <div key={a.node_id} className="panel space-y-3 p-4">
          <NextUp projectId={projectId} nodeId={a.node_id} />
          <FounderAgendaButtons projectId={projectId} items={[a]} className="grid [&>a]:w-full" />
        </div>
      ))}
    </div>
  )
}
