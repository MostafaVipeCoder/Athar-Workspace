import { useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useFounderAgendas } from '../../../data/agenda.js'
import { EmptyState, ErrorState, Loading } from '../../../ui/States.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import AgendaHost from '../agenda/AgendaHost.jsx'
import '../../../nodes/agenda/i18n.js'

/**
 * /alumni/founder/programs/:projectId/agenda/:tab? - the agenda of ONE project inside the founder shell. The agenda to
 * open is picked from `list_founder_agendas` (only nodes the PM exposed; `?node=` chooses one when several exist); the
 * page itself is the same host as the public page, so what the founder sees is what the link shows (audience decided by
 * the DB: a participant on a platform agenda is `participant`).
 */
export default function FounderAgendaPage() {
  const { projectId, tab } = useParams()
  const [search] = useSearchParams()
  const { t } = useLanguage()
  const q = useFounderAgendas(projectId)
  if (q.isPending) return <Loading />
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />
  const list = (q.data ?? []).filter((a) => a.ref)
  const wanted = search.get('node')
  const agenda = list.find((a) => a.node_id === wanted) ?? list[0] ?? null
  if (!agenda) return <EmptyState icon={CalendarDays} title={t('agenda.founder.none')} />
  const basePath = `/alumni/founder/programs/${projectId}/agenda`
  return <AgendaHost refValue={agenda.ref} tabParam={tab ?? null} basePath={basePath} />
}
