/**
 * Alumni data layer (design 09, m49): ONE function per RPC, nothing else talks to these RPCs. The founder-side and the manager-side pages both import from here.
 * Contract: ./alumni.contract.md. Every function throws AppError (data/errors.js) and returns the RPC's jsonb as it is.
 *
 * Two outcomes are NOT exceptions and must be checked by the caller:
 *   - `saveMyFounderProfile` returns `{ saved: false, error: 'national_id_conflict' }` when the number belongs to another founder (the failed call must still
 *     count against the probe limiter, so the server returns normally);
 *   - everything else that is refused is an AppError (`parseAlumniError` in lib/alumni.js reads the token and the `field:reason` detail).
 *
 * The national ID is sent only in the body of a POST (every RPC that takes or returns one is VOLATILE AND refuses GET / HEAD itself with HTTP 405: m52 `app_private.alumni_post_only`; volatile alone is not enough on PostgREST 14). Never put it in a URL,
 * a log line, a toast or a query key: `alumniKeys` below never contains one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, unwrap } from './errors.js'

export const alumniKeys = {
  root: () => ['alumni'],
  lookups: () => ['alumni', 'lookups'],
  me: () => ['alumni', 'me'],
  myCompany: (id) => ['alumni', 'company', id],
  directory: (params = {}) => ['alumni', 'directory', params],
  publicDirectory: (params = {}) => ['alumni', 'publicDirectory', params],
  adminCompany: (id) => ['alumni', 'admin', 'company', id],
  adminFounder: (id) => ['alumni', 'admin', 'founder', id], // never keyed by "reveal"
  analytics: (params = {}) => ['alumni', 'analytics', params],
  invitations: (params = {}) => ['alumni', 'invitations', params],
}

const rpc = async (name, args) => unwrap(await db().rpc(name, args))

// ------------------------------------------------------------------ vocabulary
/** `{ governorates, sectors[{subsectors}], stages, startup_types, legal_statuses, closing_reasons, after_closing, support_kinds, age_categories, genders, education_statuses, operating_statuses, directory_visibilities, version }`. Callable without signing in. */
export const getAlumniLookups = () => rpc('list_alumni_lookups', {})
/** Manager. `patch`: label_en, label_ar, sort_order, is_active, parent_key (creates the value when it does not exist). */
export const saveAlumniLookup = (kind, key, patch) => rpc('save_alumni_lookup', { p_kind: kind, p_key: key, p_patch: patch })
export const deleteAlumniLookup = (kind, key) => rpc('delete_alumni_lookup', { p_kind: kind, p_key: key })

/** What the typed number means, with the SAME SQL as the database: `{ valid:false, reason }` or `{ valid:true, birth_date, age, age_category, gender, governorate:{code,name_en,name_ar,is_abroad} }`. Stores nothing. */
export const previewNationalId = (id) => rpc('preview_national_id', { p_id: id })

// ------------------------------------------------------------------ founder side
/** `{ founder:{ ..., identity:{ source, national_id, id_masked, has_national_id, self_birth_date, self_gender, derived }, completeness }, companies[] }`. */
export const getMyAlumniProfile = () => rpc('get_my_alumni_profile', {})
/** Patch keys: name_en, name_ar, bio_en, bio_ar, phone, linkedin_url, photo_path, education_status, national_id, self_birth_date, self_gender. Returns `{ saved:true, replaced[], founder }` or `{ saved:false, error }`. */
export const saveMyFounderProfile = (patch) => rpc('save_my_founder_profile', { p_patch: patch })
/** Same call, but the soft failure THROWS (an AppError with `token = 'national_id_conflict'`): use it as a mutationFn so a conflict is an error state, not a success. */
export async function saveMyFounderProfileStrict(patch) {
  const r = await saveMyFounderProfile(patch)
  if (r?.saved === false) {
    const e = new AppError('conflict', { messageKey: 'alumni.err.nidConflict', retryable: false, detail: 'national_id:conflict' })
    e.token = r.error ?? 'national_id_conflict'
    throw e
  }
  return r
}
/** `{ company, team[], counts, ceo_founder_id, programs[], snapshots[] }`. */
export const getMyCompanyProfile = (companyId) => rpc('get_my_company_profile', { p_company: companyId })
/** `companyId` null creates the company (the founder becomes its primary founder). `expected` = the `company.updated_at` the form was loaded with. */
export const saveMyCompanyProfile = (companyId, patch, expected = null) => rpc('save_my_company_profile', { p_company: companyId ?? null, p_patch: patch, p_expected: expected })
/** `founderId` null adds a RECORD without an account. Patch: role, name_en, name_ar, phone, education_status, self_birth_date, self_gender (+ email, national_id for a manager). */
export const saveCompanyTeamMember = (companyId, founderId, patch) => rpc('save_company_team_member', { p_company: companyId, p_founder: founderId ?? null, p_patch: patch })
export const removeCompanyTeamMember = (companyId, founderId) => rpc('remove_company_team_member', { p_company: companyId, p_founder: founderId })
export const setCompanyCeo = (companyId, founderId) => rpc('set_company_ceo', { p_company: companyId, p_founder: founderId })
/** `data` keys: revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs (null clears, absent keys are kept). */
export const upsertCompanySnapshot = (companyId, year, data) => rpc('upsert_company_snapshot', { p_company: companyId, p_year: year, p_data: data })

// ------------------------------------------------------------------ invitations (the sign-up / invitation pages and the co-founder invitation)
/** Anonymous: `{ valid, company_name, masked_email }` (existing RPC). */
export const validateInvitation = (token) => rpc('validate_invitation', { p_token: token })
/** Signed-in founder whose e-mail is the invitation's: links him to the invitation's company (not as primary). */
export const acceptInvitation = (token) => rpc('accept_invitation', { p_token: token })
/** Manager (any company) or a founder of that company. Returns the clear `token` and `link` ONCE. */
export const createAlumniInvitation = ({ companyId, email, language = 'en', appUrl = null }) =>
  rpc('create_alumni_invitation', { p_company: companyId, p_email: email, p_language: language, p_app_url: appUrl })
export const revokeAlumniInvitation = (id) => rpc('revoke_alumni_invitation', { p_id: id })
/** status: pending | accepted | expired | revoked | null (all). Never carries a token. */
export const listAlumniInvitations = ({ status = null, limit = 50, offset = 0 } = {}) => rpc('list_alumni_invitations', { p_status: status, p_limit: limit, p_offset: offset })

// ------------------------------------------------------------------ directory (members) and the public directory
/** Filters: q, program_id, project_id, sector, subsector, stage, startup_type, legal_status, governorate, operating_status; manager only: scope, ceo_governorate, ceo_gender, age_category, has_female_founder, reviewed, directory_visibility, directory_hidden, incomplete. */
export const listAlumniDirectory = ({ filters = {}, limit = 24, offset = 0, sort = 'name' } = {}) => rpc('list_alumni_directory', { p_filters: filters, p_limit: limit, p_offset: offset, p_sort: sort })
/** Anonymous; only the companies a manager marked alumni AND whose founders chose "public". */
export const listPublicAlumniDirectory = ({ filters = {}, limit = 24, offset = 0 } = {}) => rpc('list_public_alumni_directory', { p_filters: filters, p_limit: limit, p_offset: offset })

// ------------------------------------------------------------------ manager side
export const getAlumniCompany = (companyId) => rpc('get_alumni_company', { p_company: companyId })
/** `reveal` = true returns the full national ID and is LOGGED on the server: ask only on an explicit click. */
export const getAlumniFounder = (founderId, { reveal = false } = {}) => rpc('get_alumni_founder', { p_founder: founderId, p_reveal: reveal })
/** Like the founder patch plus `is_alumni` and `internal: { hint, directory_hidden, reviewed }`; `companyId` null creates a company. */
export const saveAlumniCompany = (companyId, patch, expected = null) => rpc('save_alumni_company', { p_company: companyId ?? null, p_patch: patch, p_expected: expected })
export const saveAlumniFounder = (founderId, patch) => rpc('save_alumni_founder', { p_founder: founderId, p_patch: patch })
export const setCompaniesAlumni = (ids, value) => rpc('set_companies_alumni', { p_ids: ids, p_value: value })
export const deleteCompanySnapshot = (companyId, year) => rpc('delete_company_snapshot', { p_company: companyId, p_year: year })
/** `{ columns[38], rows[][38], meta }` in the owner's header order; `year` null = the latest year with data. */
export const exportAlumniRows = ({ filters = {}, year = null, lang = 'en', asOf = null } = {}) => rpc('export_alumni_rows', { p_filters: filters, p_year: year, p_lang: lang, p_as_of: asOf })
export const getAlumniAnalytics = ({ filters = {}, year = null } = {}) => rpc('get_alumni_analytics', { p_filters: filters, p_year: year })

// ------------------------------------------------------------------ hooks
/** One cached call for every select / chip / filter. The vocabulary changes rarely: a long stale time, refresh on a manager edit. */
export const useAlumniLookups = (options = {}) =>
  useQuery({ queryKey: alumniKeys.lookups(), queryFn: getAlumniLookups, staleTime: 60 * 60_000, ...options })
export const useMyAlumniProfile = (options = {}) =>
  useQuery({ queryKey: alumniKeys.me(), queryFn: getMyAlumniProfile, staleTime: 30_000, refetchOnWindowFocus: true, ...options })
export const useMyCompanyProfile = (companyId, options = {}) =>
  useQuery({ queryKey: alumniKeys.myCompany(companyId), queryFn: () => getMyCompanyProfile(companyId), enabled: Boolean(companyId), staleTime: 30_000, ...options })
export const useAlumniCompany = (companyId, options = {}) =>
  useQuery({ queryKey: alumniKeys.adminCompany(companyId), queryFn: () => getAlumniCompany(companyId), enabled: Boolean(companyId), staleTime: 30_000, ...options })
export const useAlumniAnalytics = (params = {}, options = {}) =>
  useQuery({ queryKey: alumniKeys.analytics(params), queryFn: () => getAlumniAnalytics(params), staleTime: 60_000, ...options })
export const useAlumniInvitations = (params = {}, options = {}) =>
  useQuery({ queryKey: alumniKeys.invitations(params), queryFn: () => listAlumniInvitations(params), staleTime: 15_000, ...options })

/**
 * Mutations: every success refreshes everything under ['alumni'] (the payloads are small and a save changes several of them: profile, company, directory,
 * analytics); the lookups are refreshed only by the vocabulary mutations. `saveMyFounderProfile` may RESOLVE with `{ saved: false }`: check it.
 */
export function useAlumniMutations() {
  const qc = useQueryClient()
  // everything under ['alumni'] EXCEPT the vocabulary (static: refreshed only by the vocabulary mutations)
  const all = () => qc.invalidateQueries({ queryKey: alumniKeys.root(), predicate: (q) => q.queryKey[1] !== 'lookups' })
  const lookups = () => qc.invalidateQueries({ queryKey: alumniKeys.lookups() })
  return {
    saveFounder: useMutation({ mutationFn: saveMyFounderProfileStrict, onSuccess: all }), // a national_id_conflict is an ERROR state (err.token)
    saveCompany: useMutation({ mutationFn: ({ companyId, patch, expected }) => saveMyCompanyProfile(companyId, patch, expected), onSuccess: all }),
    saveTeamMember: useMutation({ mutationFn: ({ companyId, founderId, patch }) => saveCompanyTeamMember(companyId, founderId, patch), onSuccess: all }),
    removeTeamMember: useMutation({ mutationFn: ({ companyId, founderId }) => removeCompanyTeamMember(companyId, founderId), onSuccess: all }),
    setCeo: useMutation({ mutationFn: ({ companyId, founderId }) => setCompanyCeo(companyId, founderId), onSuccess: all }),
    saveSnapshot: useMutation({ mutationFn: ({ companyId, year, data }) => upsertCompanySnapshot(companyId, year, data), onSuccess: all }),
    deleteSnapshot: useMutation({ mutationFn: ({ companyId, year }) => deleteCompanySnapshot(companyId, year), onSuccess: all }),
    createInvitation: useMutation({ mutationFn: createAlumniInvitation, onSuccess: all }),
    revokeInvitation: useMutation({ mutationFn: revokeAlumniInvitation, onSuccess: all }),
    saveAdminCompany: useMutation({ mutationFn: ({ companyId, patch, expected }) => saveAlumniCompany(companyId, patch, expected), onSuccess: all }),
    saveAdminFounder: useMutation({ mutationFn: ({ founderId, patch }) => saveAlumniFounder(founderId, patch), onSuccess: all }),
    markAlumni: useMutation({ mutationFn: ({ ids, value }) => setCompaniesAlumni(ids, value), onSuccess: all }),
    saveLookup: useMutation({ mutationFn: ({ kind, key, patch }) => saveAlumniLookup(kind, key, patch), onSuccess: lookups }),
    deleteLookup: useMutation({ mutationFn: ({ kind, key }) => deleteAlumniLookup(kind, key), onSuccess: lookups }),
  }
}
