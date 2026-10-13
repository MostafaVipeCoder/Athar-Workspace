import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/**
 * Project participants (design 00 section 7, 02 section 7.3, 04 section 5.4, decisions 01-6 / 02-7; RPCs of m06c + m33).
 * Rows are lazy: an applicant accepted by a Selection stage whose "accepted -> participants" toggle is on is a VIRTUAL
 * participant (`virtual: true`, `participant_id: null`) until the PM first acts on it (`ensureParticipant`), or until
 * "Enroll all accepted" (`enrollAccepted`). Manual participants reference a company (or a founder account).
 * Status model: accepted -> attended / withdrawn (PM), corrections allowed; certificates read `attended` only.
 */
export const PARTICIPANT_STATUSES = ['accepted', 'attended', 'withdrawn']

/** ParticipantView: { id, virtual, source, sourceNodeId, status, companyId, userId, formResponseId, needsReview, withdrawalRequestedAt, notes, email, name{en,ar}, logoPath, createdAt, statusChangedAt } */
export function normalizeParticipant(row) {
  const d = row.display ?? {}
  return {
    id: row.participant_id ?? `virtual:${row.source_node_id ?? 'x'}:${row.form_response_id ?? row.company_id}`,
    participantId: row.participant_id ?? null,
    virtual: Boolean(row.virtual),
    source: row.source ?? 'manual',
    sourceNodeId: row.source_node_id ?? null,
    status: row.status ?? 'accepted',
    companyId: row.company_id ?? null,
    userId: row.user_id ?? null,
    formResponseId: row.form_response_id ?? null,
    needsReview: Boolean(row.needs_review),
    withdrawalRequestedAt: row.withdrawal_requested_at ?? null,
    notes: row.notes ?? null,
    email: row.email ?? null,
    name: { en: d.name_en ?? '', ar: d.name_ar ?? '' },
    logoPath: d.logo_path ?? null,
    createdAt: row.created_at ?? null,
    statusChangedAt: row.status_changed_at ?? null,
  }
}

export async function listParticipants(projectId, status = null) {
  const rows = unwrap(await db().rpc('list_participants', { p_project: projectId, p_status: status })) ?? []
  return rows.map(normalizeParticipant)
}

/** One eligible applicant -> participants row (idempotent). Returns the participant id. */
export async function ensureParticipant(projectId, selectionNodeId, { companyId = null, formResponseId = null } = {}) {
  return unwrap(await db().rpc('ensure_participant', { p_project: projectId, p_selection_node: selectionNodeId, p_company: companyId, p_form_response: formResponseId }))
}
/** Every accepted item of an enrolling stage -> rows. Returns how many were created. */
export async function enrollAccepted(projectId, selectionNodeId) {
  return unwrap(await db().rpc('enroll_accepted', { p_project: projectId, p_selection_node: selectionNodeId })) ?? 0
}
export async function assignParticipant(projectId, { companyId = null, userId = null } = {}) {
  return unwrap(await db().rpc('assign_participant', { p_project: projectId, p_company: companyId, p_user: userId }))
}
export async function setParticipantStatus(participantId, status) {
  unwrap(await db().rpc('set_participant_status', { p_participant: participantId, p_status: status }))
}
/** Decision 01-6: every `accepted` row becomes `attended`; the PM then unmarks absentees one by one. */
export async function markAllAttended(projectId) {
  return unwrap(await db().rpc('mark_all_attended', { p_project: projectId })) ?? 0
}

export const useParticipants = (projectId, options = {}) =>
  useQuery({ queryKey: keys.participants(projectId), queryFn: () => listParticipants(projectId), enabled: Boolean(projectId), refetchOnWindowFocus: true, ...options })

/** Mutations of the Participants page; virtual rows are materialised first where the RPC needs a row. */
export function useParticipantMutations(projectId) {
  const qc = useQueryClient()
  const after = () => qc.invalidateQueries({ queryKey: keys.participants(projectId) })
  const materialize = async (p) => {
    if (p.participantId) return p.participantId
    return ensureParticipant(projectId, p.sourceNodeId, { companyId: p.companyId, formResponseId: p.companyId ? null : p.formResponseId })
  }
  const useM = (mutationFn) => useMutation({ mutationFn, onSuccess: after, meta: { silent: true } })
  const m = useM
  return {
    setStatus: m(async ({ participant, status }) => setParticipantStatus(await materialize(participant), status)),
    enroll: m(({ participant }) => materialize(participant)),
    enrollAll: m(async ({ selectionNodeIds }) => {
      let n = 0
      for (const id of selectionNodeIds) n += await enrollAccepted(projectId, id)
      return n
    }),
    assign: m(({ companyId, userId }) => assignParticipant(projectId, { companyId, userId })),
    /** Materialises every virtual accepted row of the given stages, then marks every accepted row attended. */
    markAllAttended: m(async ({ selectionNodeIds = [] }) => {
      for (const id of selectionNodeIds) await enrollAccepted(projectId, id)
      return markAllAttended(projectId)
    }),
  }
}
