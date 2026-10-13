import { Navigate, useLocation, useParams } from 'react-router-dom'
import { MODULE_TO_NODE_TYPE } from './legacyRedirects.js'
import { useProjectGraph } from '../../data/canvas.js'
import { Loading } from '../../ui/States.jsx'

/** Static redirect: `to(params, search)` builds the new URL; query string (lang, tabs) is preserved when `to` has none. */
export function LegacyRedirect({ to }) {
  const params = useParams()
  const { search } = useLocation()
  const target = to(params, search)
  const hasQuery = target.includes('?')
  return <Navigate to={hasQuery ? target : `${target}${search}`} replace />
}

/**
 * /event(s)/:id/<module>: find the node of the matching type in project :id (design 06 section 2.7).
 * Exactly one match -> its edit page; none, several or no permission -> the project canvas.
 */
export function LegacyModuleRedirect({ module: fixed, moduleParam }) {
  const params = useParams()
  const moduleKey = fixed ?? params[moduleParam]
  const type = MODULE_TO_NODE_TYPE[moduleKey]
  const graph = useProjectGraph(type ? params.id : null)

  if (!type) return <Navigate to={`/projects/${params.id}`} replace />
  if (graph.isPending) return <Loading />
  const matches = (graph.data?.nodes ?? []).filter((n) => n.type === type)
  if (graph.isError || matches.length !== 1) return <Navigate to={`/projects/${params.id}`} replace />
  return <Navigate to={`/projects/${params.id}/nodes/${matches[0].id}/edit`} replace />
}
