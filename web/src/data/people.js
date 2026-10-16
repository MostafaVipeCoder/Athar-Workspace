import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { normalizeCompany, normalizeExpert, toCompanyRow } from '../lib/entities.js'
import { entityViewToPayload, isExpertPhotoPath, normalizeCandidate, normalizePair, normalizeProfile, normalizeRegistryRow, normalizeTag, toListArgs } from '../lib/experts.js'
import { uploadImage, removeImage } from './storage.js'

/**
 * The ONE way to reach experts (Athar Network, `network_experts`) and companies (`companies`) (design 06 section 5.4).
 * Replaces getExperts / getMasterExperts / getCompanies / getStartups / supabase.from('experts') of the old app.
 * Every function returns normalised EntityView objects (lib/entities.js); rows are read by reference (never copied).
 * RLS: experts are readable by all staff; a PM reads the companies of the projects they manage (pm_can_read_company),
 * alumni_manager/super_admin read all. Companies: insert by PM (own rows), update by alumni_manager/super_admin (03 section 8.3).
 *
 * EXPERTS (m75 - m77, the registry): every read / write of the registry goes through an RPC (search, filters, participation numbers, duplicate check, merge are server work):
 *   `listRegistry` / `getExpertProfile` / `findSimilarExperts` / `listExpertTags` / `createExpert` / `updateExpert` / `setExpertArchived` / `deleteExpert` / `restoreExpert` /
 *   `mergeExperts` (+ `previewMerge`) / `listDuplicatePairs` / `dismissDuplicate` / `importExperts` and their hooks. The Lists node's picker still works through
 *   `listNetworkExperts` / `createNetworkExpert` (same canonical fields as an EntityView); both are now views of the same registry functions.
 */
const COMPANY_COLS = 'id, name_en, name_ar, industry_en, industry_ar, description_en, description_ar, location_en, location_ar, governorate_en, governorate_ar, stage, employees, founding_year, logo_path, website_url, linkedin_url, links, is_alumni, origin_project_id, updated_at'

const escapeLike = (s) => String(s).replace(/[%_\\]/g, (c) => `\\${c}`)
const rpc = async (name, args) => unwrap(await db().rpc(name, args))

// ------------------------------------------------------------------ the registry (experts)
/** The registry page of a list state -> `{ total, counts, limit, offset, rows: [RegistryRow] }` (see lib/experts.normalizeRegistryRow). */
export async function listRegistry(state, lang = 'en', { full = false } = {}) {
  const data = await rpc('list_network_experts', toListArgs(state, lang, { full }))
  return { total: data?.total ?? 0, counts: data?.counts ?? {}, limit: data?.limit ?? 0, offset: data?.offset ?? 0, rows: (data?.rows ?? []).map(normalizeRegistryRow) }
}

/** Every row of the current filter (the Excel export: up to 5000, the wide columns incl. e-mail, phone and notes). */
export async function listRegistryForExport(state, lang = 'en') {
  return (await listRegistry(state, lang, { full: true })).rows
}

/** One profile with its live participation history -> lib/experts.normalizeProfile. */
export async function getExpertProfile(id) {
  return normalizeProfile(await rpc('get_network_expert', { p_id: id }))
}

/** Records that look like the one being typed (names in either script, e-mail, LinkedIn) -> [Candidate]; `blocking` ones need a confirmation to create. */
export async function findSimilarExperts({ nameEn = null, nameAr = null, email = null, linkedin = null, exclude = null, kind = 'expert', limit = 6 } = {}) {
  const data = await rpc('find_similar_network_experts', { p_name_en: nameEn, p_name_ar: nameAr, p_email: email, p_linkedin: linkedin, p_exclude: exclude, p_kind: kind, p_limit: limit })
  return (data ?? []).map(normalizeCandidate)
}

/** The expertise vocabulary: [{ id, name:{en,ar}, archived, uses }]. */
export async function listExpertTags(includeArchived = false) {
  return ((await rpc('list_expert_tags', { p_include_archived: includeArchived })) ?? []).map(normalizeTag)
}

/**
 * Create a registry record. `payload` = lib/experts.formToPayload. Without `force`, a BLOCKING duplicate (same LinkedIn / e-mail / name) creates nothing and throws
 * AppError('conflict', messageKey experts.err.duplicate) carrying `.duplicates` (the candidates). -> { id, updatedAt }.
 */
export async function createExpert(payload, { force = false } = {}) {
  const res = await rpc('create_network_expert', { p: payload, p_force: force })
  if (!res?.created) {
    const err = new AppError('conflict', { messageKey: 'experts.err.duplicate', retryable: false })
    err.token = 'expert_duplicate'
    err.duplicates = (res?.duplicates ?? []).map(normalizeCandidate)
    throw err
  }
  return { id: res.id, updatedAt: res.updated_at }
}

/** Patch a record (only the keys of `patch` change). `expectedAt` = the `updatedAt` the caller loaded (a different value = somebody saved meanwhile: `experts.err.stale`). -> { id, updatedAt, oldPhotoPath }. */
export async function updateExpert(id, patch, expectedAt = null) {
  const res = await rpc('update_network_expert', { p_id: id, p: patch, p_expected: expectedAt })
  return { id: res.id, updatedAt: res.updated_at, oldPhotoPath: res.old_photo_path ?? null }
}

export const setExpertTags = (id, tags) => rpc('set_network_expert_tags', { p_expert: id, p_tags: tags })
export const setExpertArchived = (id, archived) => rpc('set_network_expert_archived', { p_id: id, p_archived: archived })
/** Soft delete (super_admin): refused while a list uses the expert (`experts.err.inUse`). */
export const deleteExpert = (id) => rpc('delete_network_expert', { p_id: id })
export const restoreExpert = (id) => rpc('restore_network_expert', { p_id: id })

/** Upload an expert photo through the central WebP pipeline (profile `avatar`: 512 px + a 320 px thumbnail) into the registry folder. -> the stored path. */
export const uploadExpertPhoto = (file, { onProgress } = {}) => uploadImage(file, { ownerId: 'global', kind: 'expert-photo', profile: 'avatar', onProgress })
/**
 * Remove a replaced / cleared photo (full + thumbnail), best effort: a failure never blocks the save that already happened. ONLY a registry photo path is ever removed (a record could
 * have been made to name another object of the bucket), and the server hands a path back only when no other record still shows it; the storage policy checks that again.
 */
export async function discardExpertPhoto(path) {
  if (!path || !isExpertPhotoPath(path)) return
  try {
    await removeImage(path)
  } catch {
    /* an orphaned file is harmless (report_orphan_assets lists it) */
  }
}

/** DRY RUN of a merge (writes nothing): `{ dry_run, blocked, blockers[], impact, merged, keep, drop }`. */
export const previewMerge = (keepId, dropId, fields = {}) => rpc('merge_network_experts', { p_keep: keepId, p_drop: dropId, p_dry_run: true, p_fields: fields })
/** The merge itself (super_admin): `{ merged, keep_id, drop_id, merge_id, impact }`. */
export const mergeExperts = (keepId, dropId, fields = {}) => rpc('merge_network_experts', { p_keep: keepId, p_drop: dropId, p_dry_run: false, p_fields: fields })

/** The probable duplicate PAIRS of the whole registry (super_admin): `{ pairs: [{ score, reasons, a, b }], dismissed }`. */
export async function listDuplicatePairs(limit = 60) {
  const data = await rpc('list_expert_duplicate_pairs', { p_limit: limit })
  return { pairs: (data?.pairs ?? []).map(normalizePair), dismissed: data?.dismissed ?? 0 }
}
export const dismissDuplicate = (a, b) => rpc('dismiss_expert_duplicate', { p_a: a, p_b: b })
export const updateExpertTag = (id, { nameEn = null, nameAr = null, archived = null } = {}) => rpc('update_expert_tag', { p_id: id, p_name_en: nameEn, p_name_ar: nameAr, p_archived: archived })

/**
 * Excel import: `rows` = a CHUNK (<= 50) of lib/experts.sheetToImportRows().rows. `dryRun` (default true) = the PREVIEW (new / duplicate / invalid per row), nothing is written.
 * `seen` = the `seen` of the previous chunk's answer (so a repeat across chunks of one file is still reported). -> { dry_run, counts, rows, seen }.
 */
export const importExperts = (rows, { dryRun = true, duplicates = 'skip', seen = null } = {}) =>
  rpc('import_network_experts', { p_rows: rows, p_dry_run: dryRun, p_duplicates: duplicates, p_seen: seen })

// ------------------------------------------------------------------ the picker's view of the registry (EntityView)
/** Athar Network search for the pickers (name in either language, title, company, tags: the registry's own search). `kind`: 'expert' (default) | 'team' | null (both). Archived experts are not offered. */
export async function listNetworkExperts({ term = '', kind = 'expert', limit = 60 } = {}) {
  const filter = {}
  if (kind) filter.kind = kind
  const t = String(term ?? '').trim()
  if (t) filter.q = t
  const data = await rpc('list_network_experts', { p_filter: filter, p_sort: 'name', p_dir: 'asc', p_limit: limit, p_offset: 0, p_lang: 'en', p_full: false })
  return (data?.rows ?? []).map(normalizeExpert)
}

export async function getNetworkExpert(id) {
  const profile = await getExpertProfile(id)
  if (!profile) return null
  return normalizeExpert({
    id: profile.id, kind: profile.kind, name_en: profile.name.en, name_ar: profile.name.ar, title_en: profile.title.en, title_ar: profile.title.ar,
    company_en: profile.company.en, company_ar: profile.company.ar, bio_en: profile.bio.en, bio_ar: profile.bio.ar, photo_path: profile.photoPath,
    linkedin_url: profile.linkedin, website_url: profile.website, links: profile.links, email: profile.email,
  })
}

/**
 * Creates an Athar Network profile (staff) from an EntityView and returns the normalised row. Goes through the registry's create RPC: validated, stamped, and a BLOCKING duplicate is refused
 * (`.duplicates` on the thrown error) unless `force`: the picker that already asked the user passes `force: true`.
 */
export async function createNetworkExpert(view, { kind = 'expert', force = false } = {}) {
  const payload = entityViewToPayload(view, kind)
  const { id } = await createExpert(payload, { force })
  return normalizeExpert({ id, ...payload })
}

/** Companies the caller may read (RLS). Search on name/industry in both languages. */
export async function listCompanies({ term = '', limit = 60 } = {}) {
  let q = db().from('companies').select(COMPANY_COLS).is('deleted_at', null).order('name_en', { ascending: true, nullsFirst: false }).limit(limit)
  const t = String(term ?? '').trim()
  if (t) {
    const p = `%${escapeLike(t)}%`
    q = q.or(`name_en.ilike.${p},name_ar.ilike.${p},industry_en.ilike.${p},industry_ar.ilike.${p}`)
  }
  return (unwrap(await q) ?? []).map(normalizeCompany)
}

export async function getCompany(id) {
  return normalizeCompany(unwrap(await db().from('companies').select(COMPANY_COLS).eq('id', id).maybeSingle()))
}

/** Creates a canonical company row (created_by = caller, RLS). `originProjectId` records provenance only (04 3.6). */
export async function createCompany(view, { originProjectId = null, userId } = {}) {
  const row = { ...toCompanyRow(view), origin_project_id: originProjectId, created_by: userId }
  return normalizeCompany(unwrap(await db().from('companies').insert(row).select(COMPANY_COLS).single()))
}

export async function updateCompany(id, view) {
  return normalizeCompany(unwrap(await db().from('companies').update(toCompanyRow(view)).eq('id', id).select(COMPANY_COLS).single()))
}

// ------------------------------------------------------------------ hooks
export const useNetworkExperts = (filter = {}, options = {}) =>
  useQuery({ queryKey: keys.experts(filter), queryFn: () => listNetworkExperts(filter), staleTime: 60_000, ...options })

export const useCompanies = (filter = {}, options = {}) =>
  useQuery({ queryKey: keys.companies(filter), queryFn: () => listCompanies(filter), staleTime: 60_000, ...options })

/** The registry page of a list state (the previous page stays on screen while the next loads: no flicker while typing / paging). */
export const useExpertRegistry = (state, lang, options = {}) =>
  useQuery({ queryKey: keys.expertRegistry(state, lang), queryFn: () => listRegistry(state, lang), staleTime: 20_000, placeholderData: keepPreviousData, ...options })

export const useExpertProfile = (id, options = {}) =>
  useQuery({ queryKey: keys.expertProfile(id), queryFn: () => getExpertProfile(id), enabled: Boolean(id), staleTime: 15_000, refetchOnWindowFocus: true, ...options })

export const useExpertTags = (includeArchived = false, options = {}) =>
  useQuery({ queryKey: keys.expertTags(includeArchived), queryFn: () => listExpertTags(includeArchived), staleTime: 120_000, ...options })

/** Similar records of the form being typed (the caller debounces `args`); an unusable signal (`enabled: false`) makes no call. */
export const useSimilarExperts = (args, options = {}) =>
  useQuery({ queryKey: keys.expertSimilar(args), queryFn: () => findSimilarExperts(args), staleTime: 30_000, placeholderData: keepPreviousData, ...options })

export const useDuplicatePairs = (options = {}) => useQuery({ queryKey: keys.expertPairs(), queryFn: () => listDuplicatePairs(), staleTime: 30_000, ...options })

/**
 * Registry writes. Every success refreshes everything under ['experts'] (list, profile, tags, duplicate finder); an edit / merge / archive also refreshes the open node views
 * (a Lists node shows the profile by reference, so its card changes with the profile).
 */
export function useExpertActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['experts'] })
  const refreshWithNodes = () => {
    refresh()
    qc.invalidateQueries({ queryKey: ['node'] })
  }
  return {
    create: useMutation({ mutationFn: ({ payload, force }) => createExpert(payload, { force }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch, expectedAt }) => updateExpert(id, patch, expectedAt), onSuccess: refreshWithNodes }),
    archive: useMutation({ mutationFn: ({ id, archived }) => setExpertArchived(id, archived), onSuccess: refreshWithNodes }),
    remove: useMutation({ mutationFn: ({ id }) => deleteExpert(id), onSuccess: refresh }),
    restore: useMutation({ mutationFn: ({ id }) => restoreExpert(id), onSuccess: refresh }),
    merge: useMutation({ mutationFn: ({ keepId, dropId, fields }) => mergeExperts(keepId, dropId, fields), onSuccess: refreshWithNodes }),
    dismiss: useMutation({ mutationFn: ({ a, b }) => dismissDuplicate(a, b), onSuccess: refresh }),
    import: useMutation({ mutationFn: ({ rows, duplicates }) => importExperts(rows, { dryRun: false, duplicates }), onSuccess: refresh }),
  }
}

/** Create/update people; every success invalidates the registry lists (and the caller invalidates its own list node). */
export function usePeopleMutations() {
  const qc = useQueryClient()
  const common = (root) => ({ onSuccess: () => qc.invalidateQueries({ queryKey: [root] }) })
  return {
    createExpert: useMutation({ mutationFn: ({ view, kind, force }) => createNetworkExpert(view, { kind, force }), ...common('experts') }),
    createCompany: useMutation({ mutationFn: ({ view, originProjectId, userId }) => createCompany(view, { originProjectId, userId }), ...common('companies') }),
    updateCompany: useMutation({ mutationFn: ({ id, view }) => updateCompany(id, view), ...common('companies') }),
  }
}
