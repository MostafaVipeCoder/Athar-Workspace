import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useFounderAgendas } from '../../../data/agenda.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import '../../../nodes/agenda/i18n.js'

/**
 * Founder exposure of the Agenda node (docs/13 sections 4 + 11, design 01 section 3.1): one "Program Agenda" button per
 * agenda node the PM exposed (show_to_participants + platform/public visibility), labelled with the node's name, opening
 * only this project's agenda inside the founder shell. Nothing is rendered while nothing is exposed (00 section 6:
 * nothing appears by default). The step-8 founder Program page embeds this component.
 */
export default function FounderAgendaButtons({ projectId, items, className }) {
  const { t, pick, lang } = useLanguage()
  // `items` = the rows the Program page already holds (get_founder_program_page): no second request
  const q = useFounderAgendas(projectId, { enabled: Boolean(projectId) && !items })
  const list = (items ?? q.data ?? []).filter((a) => a.ref)
  if (!list.length) return null
  return (
    <div className={className} data-testid="founder-agenda-buttons">
      {list.map((a) => (
        <Link key={a.node_id} to={`/alumni/founder/programs/${projectId}/agenda?node=${a.node_id}&lang=${lang}`} className={buttonClass({ variant: 'primary', size: 'md' })} aria-label={t('agenda.founder.open', { name: pick(a, 'name') })}>
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {pick(a, 'name') || t('agenda.founder.button')}
        </Link>
      ))}
    </div>
  )
}
