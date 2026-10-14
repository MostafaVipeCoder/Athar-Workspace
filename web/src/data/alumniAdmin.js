/**
 * Data layer of the MANAGER-side Alumni pages (m51, builder task of 2026-10-14). Complements data/alumni.js (the shared contract of m49, which this file never edits):
 * the RPCs m51 added (programs, the wide table, the dashboard overview, server-side notifications, the import preview) and the direct, RLS-protected table access of the
 * opportunities hub, the application workflow and the snapshot grid. Pages import functions / hooks from here and from data/alumni.js; nothing talks to the client directly.
 *
 * Every function throws AppError (data/errors.js). Query keys live under ['alumni', 'admin', ...]: the shared `useAlumniMutations()` (which invalidates everything under
 * ['alumni']) refreshes them too, and `useAdminMutations()` below does the same for the writes of this file.
 *
 * The national ID never appears here: the table carries only `id_masked`, the full number comes from `getAlumniFounder(id, { reveal: true })` (data/alumni.js, audited) and
 * is never cached by a query key.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'

const rpc = async (name, args) => unwrap(await db().rpc(name, args))
const ROOT = ['alumni', 'admin']

export const adminKeys = {
  root: () => ROOT,
  programs: () => [...ROOT, 'programs'],
  table: (params) => [...ROOT, 'table', params],
  overview: () => [...ROOT, 'overview'],
  broadcasts: (params) => [...ROOT, 'broadcasts', params],
  audience: (key) => [...ROOT, 'audience', key],
  recipients: (id) => [...ROOT, 'recipients', id],
  opportunities: () => [...ROOT, 'opportunities'],
  applications: (id) => [...ROOT, 'applications', id],
  snapshots: (params) => [...ROOT, 'snapshots', params],
  founders: (q) => [...ROOT, 'founders', q],
  companyPick: (q) => [...ROOT, 'companyPick', q],
}

// ------------------------------------------------------------------ RPCs of m51
/** `{ programs: [{ id, name_en, name_ar, program_type, year, archived, companies, projects: [{ id, name_en, name_ar, completed, companies }] }] }` (the programs table is closed to an alumni manager). */
export const listAlumniPrograms = () => rpc('list_alumni_programs', {})

/** One page of the manager table: `{ total, limit, offset, year, sort, dir, as_of, rows[] }` (row shape: see m51 / alumniAdmin.contract in PROGRESS). `sort` / `dir` are server-side. */
export const listAlumniTable = ({ filters = {}, limit = 25, offset = 0, sort = 'name', dir = 'asc', year = null } = {}) =>
  rpc('list_alumni_table', { p_filters: filters, p_limit: limit, p_offset: offset, p_sort: sort, p_dir: dir, p_year: year })

/** Dashboard aggregates: companies, review state, completeness, founders (counts only), invitations, notifications of the last 30 days. */
export const getAlumniOverview = () => rpc('get_alumni_overview', {})

/** `audience` = `{ kind: 'all' | 'program' | 'company' | 'founder', program_id?, project_id?, company_ids?, founder_ids? }` -> `{ recipients, without_account, sample[] }`. */
export const previewNotificationAudience = (audience) => rpc('preview_notification_audience', { p_audience: audience })

/**
 * Sends ONE notification row per recipient (always with recipient_id), in each recipient's language. Plain text. -> `{ broadcast_id, recipients, without_account }`.
 * `link` (an in-app path or an http(s) URL) and `opportunityId` ride in the metadata the founder inbox already reads (a button that opens it).
 */
export const sendAlumniNotification = ({ audience, titleEn = null, titleAr = null, bodyEn = null, bodyAr = null, link = null, opportunityId = null }) =>
  rpc('send_alumni_notification', { p_audience: audience, p_title_en: titleEn, p_title_ar: titleAr, p_body_en: bodyEn, p_body_ar: bodyAr, p_link: link || null, p_opportunity: opportunityId || null })

/** History: one row per broadcast `{ broadcast_id, sent_at, audience_type, target_id, target_name_*, sent_by, title_*, body_*, recipients, reads }`. */
export const listAlumniBroadcasts = ({ limit = 20, offset = 0 } = {}) => rpc('list_alumni_broadcasts', { p_limit: limit, p_offset: offset })

/** DRY RUN of the Excel import (nothing is written): `rows` = objects keyed by the owner's headers (<= 500 per call). */
export const importAlumniPreview = (rows) => rpc('import_alumni_preview', { p_rows: rows })

/** The existing manager RPC (design 09 M3): the company `drop` is merged INTO `keep` and removed. Irreversible. */
export const mergeCompanies = (keep, drop) => rpc('merge_companies', { p_keep: keep, p_drop: drop })

// ------------------------------------------------------------------ notifications: direct reads (a manager reads every notification, RLS)
/** Who got a broadcast and who read it: `[{ id, is_read, created_at, founder: { id, name_en, name_ar } }]` (at most 500). */
export async function listBroadcastRecipients(broadcastId) {
  return unwrap(await db().from('notifications').select('id, is_read, created_at, founder:founders(id, name_en, name_ar)').eq('broadcast_id', broadcastId).order('created_at', { ascending: true }).limit(500))
}

/** Founders by name or e-mail (a manager reads every founder, RLS): the picker of "selected founders". `q` has its filter metacharacters removed. */
export async function searchFounders(q) {
  const term = String(q ?? '').replace(/[,()*%\\]/g, ' ').trim()
  if (term.length < 2) return []
  const like = `*${term}*`
  return unwrap(await db().from('founders').select('id, name_en, name_ar, email, auth_user_id').is('deleted_at', null).or(`name_en.ilike.${like},name_ar.ilike.${like},email.ilike.${like}`).order('name_en').limit(12))
}

// ------------------------------------------------------------------ opportunities (direct, RLS: manager CRUD; founders read the active ones they are targeted by)
const OPP_COLUMNS = ['type', 'title_ar', 'title_en', 'description_ar', 'description_en', 'provider_ar', 'provider_en', 'deadline', 'eligibility', 'link', 'is_active', 'archived_at', 'target', 'order_index']
const pickColumns = (patch) => Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => OPP_COLUMNS.includes(k)))

/** Every opportunity with its number of applications: `[{ ..., apps: [{ count }] }]`. */
export async function listOpportunities() {
  return unwrap(await db().from('opportunities').select('*, apps:opportunity_applications(count)').order('order_index', { ascending: true }).order('created_at', { ascending: false }))
}
/** `id` null creates. `patch` carries only the opportunity columns (a key the table does not have is dropped here, never sent). */
export async function saveOpportunity(id, patch) {
  const body = pickColumns(patch)
  if (id) return unwrap(await db().from('opportunities').update(body).eq('opportunity_id', id).select().single())
  return unwrap(await db().from('opportunities').insert(body).select().single())
}
export async function deleteOpportunity(id) {
  unwrap(await db().from('opportunities').delete().eq('opportunity_id', id))
}
/** Applications of one opportunity with the company and the applying founder. */
export async function listApplications(opportunityId) {
  return unwrap(await db().from('opportunity_applications')
    .select('id, opportunity_id, company_id, founder_id, status, notes, applied_at, company:companies(id, name_en, name_ar, logo_path), founder:founders(id, name_en, name_ar, email)')
    .eq('opportunity_id', opportunityId).order('applied_at', { ascending: false }))
}
export async function setApplicationStatus(id, status) {
  return unwrap(await db().from('opportunity_applications').update({ status }).eq('id', id).select('id, status').single())
}
/** The manager applies for a company (the founder side inserts through its own policy). */
export async function applyOnBehalf({ opportunityId, companyId, notes = null }) {
  return unwrap(await db().from('opportunity_applications').insert({ opportunity_id: opportunityId, company_id: companyId, notes: notes || null }).select('id, status').single())
}

// ------------------------------------------------------------------ snapshots (the grid of the M&E workspace; a manager reads every yearly row, RLS)
const SNAP_COLUMNS = 'company_id, period_year, revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs, source, updated_at'
/** The ANNUAL rows of `year` for a set of companies (one query for a page of the grid): `[{ company_id, period_year, ... }]`. */
export async function listSnapshotsForCompanies(companyIds, year) {
  if (!companyIds?.length) return []
  return unwrap(await db().from('company_snapshots').select(SNAP_COLUMNS).in('company_id', companyIds).eq('snapshot_type', 'annual').eq('period_year', year))
}

// ------------------------------------------------------------------ hooks
export const useAlumniPrograms = (options = {}) => useQuery({ queryKey: adminKeys.programs(), queryFn: listAlumniPrograms, staleTime: 5 * 60_000, ...options })
export const useAlumniTable = (params, options = {}) => useQuery({ queryKey: adminKeys.table(params), queryFn: () => listAlumniTable(params), staleTime: 15_000, placeholderData: (prev) => prev, ...options })
export const useAlumniOverview = (options = {}) => useQuery({ queryKey: adminKeys.overview(), queryFn: getAlumniOverview, staleTime: 30_000, ...options })
export const useAlumniBroadcasts = (params = {}, options = {}) => useQuery({ queryKey: adminKeys.broadcasts(params), queryFn: () => listAlumniBroadcasts(params), staleTime: 15_000, placeholderData: (prev) => prev, ...options })
export const useAudiencePreview = (audience, key, options = {}) => useQuery({ queryKey: adminKeys.audience(key), queryFn: () => previewNotificationAudience(audience), staleTime: 20_000, retry: false, ...options })
export const useBroadcastRecipients = (broadcastId, options = {}) => useQuery({ queryKey: adminKeys.recipients(broadcastId), queryFn: () => listBroadcastRecipients(broadcastId), enabled: Boolean(broadcastId), staleTime: 15_000, ...options })
export const useFounderSearch = (q, options = {}) => useQuery({ queryKey: adminKeys.founders(q), queryFn: () => searchFounders(q), enabled: String(q ?? '').trim().length >= 2, staleTime: 30_000, ...options })
export const useOpportunities = (options = {}) => useQuery({ queryKey: adminKeys.opportunities(), queryFn: listOpportunities, staleTime: 15_000, ...options })
export const useApplications = (opportunityId, options = {}) => useQuery({ queryKey: adminKeys.applications(opportunityId), queryFn: () => listApplications(opportunityId), enabled: Boolean(opportunityId), staleTime: 10_000, ...options })
export const useSnapshotRows = (companyIds, year, options = {}) =>
  useQuery({ queryKey: adminKeys.snapshots({ ids: companyIds, year }), queryFn: () => listSnapshotsForCompanies(companyIds, year), enabled: Boolean(companyIds?.length) && Boolean(year), staleTime: 10_000, ...options })

/**
 * Writes of the manager pages. Every success refreshes everything under ['alumni'] EXCEPT the vocabulary (the payloads are small and one write changes several of them:
 * the table, the overview, the analytics). `sendNotification` also refreshes the history through the same prefix.
 */
export function useAdminMutations() {
  const qc = useQueryClient()
  const all = () => qc.invalidateQueries({ queryKey: ['alumni'], predicate: (q) => q.queryKey[1] !== 'lookups' })
  return {
    sendNotification: useMutation({ mutationFn: sendAlumniNotification, onSuccess: all }),
    saveOpportunity: useMutation({ mutationFn: ({ id, patch }) => saveOpportunity(id, patch), onSuccess: all }),
    deleteOpportunity: useMutation({ mutationFn: deleteOpportunity, onSuccess: all }),
    setApplicationStatus: useMutation({ mutationFn: ({ id, status }) => setApplicationStatus(id, status), onSuccess: all }),
    applyOnBehalf: useMutation({ mutationFn: applyOnBehalf, onSuccess: all }),
    merge: useMutation({ mutationFn: ({ keep, drop }) => mergeCompanies(keep, drop), onSuccess: all }),
  }
}
