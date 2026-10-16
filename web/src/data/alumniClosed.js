/**
 * Data layer of the CLOSED-company follow-up (owner decision 22; m70). ONE function per RPC; every function throws AppError (data/errors.js).
 *
 * A closed company answers "what are you doing now?" (`saveCompanyAfterClosing`): a new venture, a job, or something else. The LATEST answer is kept with its date (no per-edit history).
 * The manager reads the follow-up list (`listClosedFollowups`). Query keys live under ['alumni', 'closed', ...]: every alumni mutation invalidates everything under ['alumni'].
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'

const rpc = async (name, args) => unwrap(await db().rpc(name, args))
const ROOT = ['alumni', 'closed']

export const closedKeys = {
  root: () => ROOT,
  mine: (companyId) => [...ROOT, 'mine', companyId],
  followups: (params) => [...ROOT, 'followups', params],
}

/** `{ company_id, closed, closed_on, current_period, answered_this_period, answer: null | { answer_type, venture_name, field, venture_stage, venture_url, venture_description, wants_programs, employer, job_title, other_text, answered_at, answered_source } }`. */
export const getCompanyAfterClosing = (companyId) => rpc('get_company_after_closing', { p_company: companyId })
/** `data` = the WHOLE answer (see lib/alumniClosed `buildClosedPayload`); the previous answer is replaced. -> `{ saved: true, ...get_company_after_closing }`. */
export const saveCompanyAfterClosing = (companyId, data) => rpc('save_company_after_closing', { p_company: companyId, p_data: data })
/**
 * Manager: `{ current_period, counts: { total, answered, not_answered, new_startup, employed, other, interested }, total, limit, offset, rows: [{ id, name_en, name_ar, logo_path, closed_on, closing_reason,
 * founder: { name_en, name_ar, with_account }, answer: null | {...as above}, reminders: { count, last_at } }] }`. `status` = answered | not_answered; `type` = new_startup | employed | other; `interested` true | false.
 */
export const listClosedFollowups = ({ filters = {}, status = null, type = null, interested = null, limit = 50, offset = 0, sort = 'name', dir = 'asc' } = {}) =>
  rpc('list_alumni_closed_followups', { p_filters: filters, p_status: status, p_type: type, p_interested: interested, p_limit: limit, p_offset: offset, p_sort: sort, p_dir: dir })

export const useCompanyAfterClosing = (companyId, options = {}) =>
  useQuery({ queryKey: closedKeys.mine(companyId), queryFn: () => getCompanyAfterClosing(companyId), enabled: Boolean(companyId), staleTime: 15_000, refetchOnWindowFocus: true, ...options })
export const useClosedFollowups = (params = {}, options = {}) =>
  useQuery({ queryKey: closedKeys.followups(params), queryFn: () => listClosedFollowups(params), staleTime: 15_000, placeholderData: (prev) => prev, ...options })

/** A save refreshes everything under ['alumni'] except the vocabulary (the follow-up list, the directory column, the reminder audience). */
export function useSaveAfterClosing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, data }) => saveCompanyAfterClosing(companyId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alumni'], predicate: (q) => q.queryKey[1] !== 'lookups' }),
  })
}
