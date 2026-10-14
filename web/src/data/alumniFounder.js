/**
 * Data of the founder-side Alumni pages that is NOT an m49 RPC (design 09 F4 - F8): the opportunities and the applications (direct tables under RLS, hardened by
 * m50; the notifications are in founderNotifications.js, which the shell imports), the founder photo (private bucket, signed URL) and the two image uploads (always through data/storage.js).
 * The m49 RPCs live in data/alumni.js; pages never call `db()` themselves.
 *
 * The national ID never passes through this module.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { storeImage, uploadImage } from './storage.js'
import { listMyCertificates } from './certificates.js'
import { newId, thumbPath } from '../lib/image/paths.js'

export const founderAlumniKeys = {
  opportunities: () => ['alumniFounder', 'opportunities'],
  applications: () => ['alumniFounder', 'applications'],
  photo: (path) => ['alumniFounder', 'photo', path],
  certificates: () => ['alumniFounder', 'certificates'],
}

export const FOUNDER_BUCKET = 'founder-assets'

// ------------------------------------------------------------------ opportunities and applications
const OPPORTUNITY_COLUMNS = 'opportunity_id, type, title_ar, title_en, description_ar, description_en, deadline, eligibility, link, image_url, order_index, created_at'
const APPLICATION_COLUMNS = 'id, opportunity_id, company_id, status, notes, applied_at'

/** The ACTIVE opportunities (RLS hides the inactive ones from a founder). The table has no audience column: every founder sees the same list. */
export async function listOpportunities() {
  return unwrap(await db().from('opportunities').select(OPPORTUNITY_COLUMNS).eq('is_active', true).order('order_index', { ascending: true }).order('created_at', { ascending: false }).limit(200)) ?? []
}

/** The applications of the caller's own companies (RLS). */
export async function listMyApplications() {
  return unwrap(await db().from('opportunity_applications').select(APPLICATION_COLUMNS).order('applied_at', { ascending: false }).limit(500)) ?? []
}

/**
 * Express interest / apply with one of the caller's companies. The status, the date and the founder are set by the server (m50 guard: a typed status is ignored),
 * a closed / inactive opportunity is refused (`opportunity_closed`) and a company applies once (`conflict`, the unique key).
 */
export async function applyToOpportunity({ opportunityId, companyId, notes = null }) {
  const { data, error } = await db().from('opportunity_applications')
    .insert({ opportunity_id: opportunityId, company_id: companyId, notes: notes?.trim() || null })
    .select(APPLICATION_COLUMNS).single()
  if (error) {
    if (String(error.code) === '23505') throw new AppError('conflict', { messageKey: 'alumni.opp.alreadyApplied', cause: error, retryable: false })
    throw fromSupabase(error)
  }
  return data
}

export const useOpportunities = (options = {}) =>
  useQuery({ queryKey: founderAlumniKeys.opportunities(), queryFn: listOpportunities, staleTime: 60_000, refetchOnWindowFocus: true, ...options })

export const useMyApplications = (options = {}) =>
  useQuery({ queryKey: founderAlumniKeys.applications(), queryFn: listMyApplications, staleTime: 30_000, refetchOnWindowFocus: true, ...options })

export function useApplyMutation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: applyToOpportunity, onSuccess: () => qc.invalidateQueries({ queryKey: founderAlumniKeys.applications() }), meta: { silent: true } })
}

// ------------------------------------------------------------------ progress: every certificate the founder holds
/** All of the caller's own certificates (`list_my_certificates` without a project). */
export const useAllMyCertificates = (options = {}) =>
  useQuery({ queryKey: founderAlumniKeys.certificates(), queryFn: () => listMyCertificates(null), staleTime: 60_000, ...options })

// ------------------------------------------------------------------ images (WebP only: data/storage.js converts, the server re-checks)
/** Founder photo -> `founder-assets/founders/<uid>/photo/<uuid>.webp` (+ `_t.webp`); returns the path to send as `photo_path`. */
export async function uploadFounderPhoto(file, userId, { onProgress } = {}) {
  const stored = await storeImage(file, { bucket: FOUNDER_BUCKET, profile: 'avatar', path: (ext) => `founders/${userId}/photo/${newId()}.${ext}`, onProgress })
  return stored.path
}

/** Company logo -> `public-assets/alumni/<uid>/logo/<uuid>.webp` (no SVG: the server path rule is WebP only); returns the path to send as `logo_path`. */
export function uploadCompanyLogo(file, userId, { onProgress } = {}) {
  return uploadImage(file, { ownerId: `alumni/${userId}`, kind: 'logo', profile: 'avatar', onProgress })
}

/** A signed URL of a founder photo (private bucket); the thumbnail by default. */
export async function signedFounderPhotoUrl(path, { full = false, expiresIn = 3600 } = {}) {
  if (!path) return null
  const { data, error } = await db().storage.from(FOUNDER_BUCKET).createSignedUrl(full ? path : thumbPath(path), expiresIn)
  if (error || !data?.signedUrl) {
    // a photo stored without a thumbnail: fall back to the file itself
    if (!full) return signedFounderPhotoUrl(path, { full: true, expiresIn })
    throw fromSupabase(error ?? new Error('forbidden'))
  }
  return data.signedUrl
}

export const useFounderPhotoUrl = (path, options = {}) =>
  useQuery({ queryKey: founderAlumniKeys.photo(path), queryFn: () => signedFounderPhotoUrl(path), enabled: Boolean(path), staleTime: 50 * 60_000, retry: false, ...options })
