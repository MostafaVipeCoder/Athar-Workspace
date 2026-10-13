import { useLocation, useParams } from 'react-router-dom'
import AgendaHost from './agenda/AgendaHost.jsx'

/**
 * /agenda/:ref/:tab? - the public view page of a project or of one Agenda node (design 06 section 2.4). `:ref` is a
 * public link slug (or a legacy event id); `:tab` deep-links a tab by its slug. The DB decides the audience.
 */
export default function AgendaPage() {
  const { ref, tab } = useParams()
  const location = useLocation()
  return <AgendaHost refValue={ref} tabParam={tab ?? null} basePath={`/agenda/${encodeURIComponent(ref ?? '')}`} signInPath={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />
}
