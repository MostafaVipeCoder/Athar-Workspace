import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { normalizeCompany, normalizeExpert, toCompanyRow, toExpertRow } from '../lib/entities.js'

/**
 * The ONE way to reach experts (Athar Network, `network_experts`) and companies (`companies`) (design 06 section 5.4).
 * Replaces getExperts / getMasterExperts / getCompanies / getStartups / supabase.from('experts') of the old app.
 * Every function returns normalised EntityView objects (lib/entities.js); rows are read by reference (never copied).
 * RLS: experts are readable by all staff; a PM reads the companies of the projects they manage (pm_can_read_company),
 * alumni_manager/super_admin read all. Writes: PM may insert/update experts; companies: insert by PM (own rows),
 * update by alumni_manager/super_admin (03 section 8.3).
 */
const EXPERT_COLS = 'id, kind, name_en, name_ar, title_en, title_ar, company_en, company_ar, bio_en, bio_ar, photo_path, linkedin_url, email, updated_at'
const COMPANY_COLS = 'id, name_en, name_ar, industry_en, industry_ar, description_en, description_ar, location_en, location_ar, governorate_en, governorate_ar, stage, employees, founding_year, logo_path, website_url, linkedin_url, links, is_alumni, origin_project_id, updated_at'

const escapeLike = (s) => String(s).replace(/[%_\\]/g, (c) => `\\${c}`)

/** Athar Network search (name in either language, title, company). `kind`: 'expert' (default) | 'team' | null (both). */
export async function listNetworkExperts({ term = '', kind = 'expert', limit = 60 } = {}) {
  let q = db().from('network_experts').select(EXPERT_COLS).is('deleted_at', null).order('name_en', { ascending: true, nullsFirst: false }).limit(limit)
  if (kind) q = q.eq('kind', kind)
  const t = String(term ?? '').trim()
  if (t) {
    const p = `%${escapeLike(t)}%`
    q = q.or(`name_en.ilike.${p},name_ar.ilike.${p},title_en.ilike.${p},title_ar.ilike.${p},company_en.ilike.${p},company_ar.ilike.${p}`)
  }
  return (unwrap(await q) ?? []).map(normalizeExpert)
}

export async function getNetworkExpert(id) {
  return normalizeExpert(unwrap(await db().from('network_experts').select(EXPERT_COLS).eq('id', id).maybeSingle()))
}

/** Creates an Athar Network profile (PM/super_admin). `view` is an EntityView; returns the normalised row. */
export async function createNetworkExpert(view, { kind = 'expert' } = {}) {
  const row = { ...toExpertRow(view), kind }
  return normalizeExpert(unwrap(await db().from('network_experts').insert(row).select(EXPERT_COLS).single()))
}

/** "Update network profile": an explicit action that changes the shared profile; every list referencing it shows the new values. */
export async function updateNetworkExpert(id, view) {
  return normalizeExpert(unwrap(await db().from('network_experts').update(toExpertRow(view)).eq('id', id).select(EXPERT_COLS).single()))
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

/** Create/update people; every success invalidates the registry lists (and the caller invalidates its own list node). */
export function usePeopleMutations() {
  const qc = useQueryClient()
  const common = (root) => ({ onSuccess: () => qc.invalidateQueries({ queryKey: [root] }) })
  return {
    createExpert: useMutation({ mutationFn: ({ view, kind }) => createNetworkExpert(view, { kind }), ...common('experts') }),
    updateExpert: useMutation({ mutationFn: ({ id, view }) => updateNetworkExpert(id, view), ...common('experts') }),
    createCompany: useMutation({ mutationFn: ({ view, originProjectId, userId }) => createCompany(view, { originProjectId, userId }), ...common('companies') }),
    updateCompany: useMutation({ mutationFn: ({ id, view }) => updateCompany(id, view), ...common('companies') }),
  }
}
