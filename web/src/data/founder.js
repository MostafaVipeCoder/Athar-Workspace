/**
 * Founder platform data (step 8, design 06 section 10, m39). The founder side is READ-ONLY and every authorisation decision is
 * the DB's: `list_my_programs` (the cards), `get_founder_program_page` (the header + the ordered list of ENABLED blocks) and
 * `get_founder_block` (the lazy payloads of the heavy blocks). The exposure RPCs of the nodes (list_founder_agendas / _libraries /
 * _landings, list_my_certificates) are not re-implemented here: the aggregate calls them and the block components reuse their shapes.
 */
import { useQuery } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/** Cards of the projects the signed-in founder participates in. `withdrawn` rows come back with the status and the names only. */
export async function listMyPrograms({ includeWithdrawn = true } = {}) {
  return unwrap(await db().rpc('list_my_programs', { p_include_withdrawn: includeWithdrawn })) ?? []
}

/** `{ project, participant, restricted, blocks: [{ type, node_id?, data }] }`; throws `forbidden` for a non-participant. */
export async function getFounderProgramPage(projectId) {
  return unwrap(await db().rpc('get_founder_program_page', { p_project: projectId }))
}

/** Lazy payload of one block: `{ type, node_id, viewer, data }`, or null when that node is not (or no longer) exposed. */
export async function getFounderBlock(projectId, type, nodeId, after = null) {
  return unwrap(await db().rpc('get_founder_block', { p_project: projectId, p_type: type, p_node: nodeId, p_after: after }))
}

// ------------------------------------------------------------------ hooks (refetch on focus: a PM change shows up without a socket, P2)
export const useMyPrograms = (options = {}) =>
  useQuery({ queryKey: keys.myPrograms(), queryFn: () => listMyPrograms(), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

export const useFounderProgramPage = (projectId, options = {}) =>
  useQuery({ queryKey: keys.founderProgram(projectId), queryFn: () => getFounderProgramPage(projectId), enabled: Boolean(projectId), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

export const useFounderBlock = (projectId, type, nodeId, options = {}) =>
  useQuery({ queryKey: keys.founderBlock(projectId, type, nodeId), queryFn: () => getFounderBlock(projectId, type, nodeId), enabled: Boolean(projectId && type && nodeId), staleTime: 30_000, ...options })
