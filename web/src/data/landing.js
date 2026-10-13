import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { IMAGE } from '../lib/constants.js'

/**
 * Landing Page node data (design 01 section 3.9, 04 sections 3.11 + 3.12, 07 sections 5 + 6):
 * - the PM reads the definition (cards + their share presets + frames) under RLS (raw rows) and writes it ONLY through
 *   save_node children (`app_private.save_children_landing_page`: stable card ids, validation, one transaction with the config);
 * - the public page reads `get_public_landing(ref)` (own link) or `get_public_tab` (Agenda tab); both return the same
 *   whitelisted payload `{ config, cards[+presets, +cta_link/share_link], frames }` built by `app_private.landing_public_payload`;
 * - analytics are written through the anon RPC `track_landing_event` (closed vocabulary, rate limited, no PII) and read by
 *   PMs through `get_landing_analytics`;
 * - the node's own page is a `view` link with view_key 'landing' (`/view/<slug>/landing`).
 * Frame PNGs are stored AS IS (lossless, alpha kept) in the public-assets bucket under `<project>/landing/<uuid>.png`.
 */
export const LANDING_LINK_KIND = 'view'
export const LANDING_VIEW_KEY = 'landing'
/** Event vocabulary of the anon RPC (the DB ignores anything else). */
export const LANDING_EVENTS = ['tab_view', 'card_share', 'share_copy', 'cta_click', 'image_upload', 'image_download']

// ------------------------------------------------------------------ PM reads
export async function getLandingDefinition(nodeId) {
  const cards = unwrap(await db().from('landing_cards')
    .select('id, sort_order, cover_path, chip_label_en, chip_label_ar, title_en, title_ar, body_en, body_ar, see_more_lines, cta_label_en, cta_label_ar, cta_url, cta_node_id, cta_dot, share_enabled, share_url, share_node_id')
    .eq('node_id', nodeId).order('sort_order').order('created_at')) ?? []
  const frames = unwrap(await db().from('landing_frames')
    .select('id, name, image_path, aspect, window_x, window_y, window_w, window_h, window_shape, sort_order')
    .eq('node_id', nodeId).order('sort_order')) ?? []
  const presets = cards.length
    ? unwrap(await db().from('landing_share_presets').select('card_id, platform, body').in('card_id', cards.map((c) => c.id))) ?? []
    : []
  const byCard = new Map()
  for (const p of presets) byCard.set(p.card_id, { ...(byCard.get(p.card_id) ?? {}), [p.platform]: p.body })
  return { cards: cards.map((c) => ({ ...c, presets: byCard.get(c.id) ?? {} })), frames }
}

async function slugOf(linkId) {
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', linkId).eq('is_current', true).maybeSingle())
  return slug?.slug ?? null
}
/** The node's own public page link: kind 'view' + view_key 'landing' -> `/view/<slug>/landing`. */
export async function getLandingLink(nodeId) {
  const link = unwrap(await db().from('public_links').select('id, is_enabled').eq('node_id', nodeId).eq('kind', LANDING_LINK_KIND).eq('view_key', LANDING_VIEW_KEY).maybeSingle())
  if (!link) return null
  return { linkId: link.id, slug: await slugOf(link.id), enabled: link.is_enabled }
}
export async function ensureLandingLink(nodeId) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: LANDING_LINK_KIND, p_view_key: LANDING_VIEW_KEY, p_project: null }))
  return getLandingLink(nodeId)
}

/** Founder exposure (m37): the landing pages a participant may be offered -> [{ node_id, name_en, name_ar, ref }]. */
export async function listFounderLandings(projectId) {
  return unwrap(await db().rpc('list_founder_landings', { p_project: projectId })) ?? []
}

export async function getLandingAnalytics(nodeId, days = 90) {
  return unwrap(await db().rpc('get_landing_analytics', { p_node: nodeId, p_days: days }))
}

// ------------------------------------------------------------------ public reads / writes (the DB decides the audience)
export async function getPublicLanding(ref) {
  return unwrap(await db().rpc('get_public_landing', { p_ref: ref }))
}

/**
 * Fire-and-forget analytics write. Never throws and never blocks the UI: a failure only means one event is missing.
 * `nodeId` is passed when the landing page is shown as a TAB of an Agenda/project page (the ref is then the host's).
 */
export function trackLandingEvent(ref, type, { cardId = null, platform = null, nodeId = null } = {}) {
  if (!ref || !LANDING_EVENTS.includes(type)) return Promise.resolve(false)
  try {
    return Promise.resolve(db().rpc('track_landing_event', { p_ref: ref, p_type: type, p_card: cardId, p_platform: platform, p_node: nodeId }))
      .then((r) => !r?.error, () => false)
  } catch {
    return Promise.resolve(false)
  }
}

// ------------------------------------------------------------------ frame files (PNG kept as is: alpha + exact pixels)
const frameFolder = (projectId) => `${projectId}/landing`

/** Upload a validated PNG frame; returns the stored path. */
export async function uploadFramePng(file, { projectId }) {
  if (!file || file.type !== 'image/png') throw new AppError('validation', { messageKey: 'landing.frames.err.type', retryable: false })
  if (file.size > IMAGE.maxBytes) throw new AppError('validation', { messageKey: 'landing.frames.err.size', retryable: false })
  const path = `${frameFolder(projectId)}/${crypto.randomUUID()}.png`
  const { error } = await db().storage.from(IMAGE.bucket).upload(path, file, { contentType: 'image/png', cacheControl: '31536000', upsert: false })
  if (error) throw fromSupabase(error)
  return path
}
/** Best-effort removal of stored files (covers: full + thumb handled by the caller through data/storage.removeImage). */
export async function removeFiles(paths) {
  const list = (paths ?? []).filter(Boolean)
  if (!list.length) return
  const { error } = await db().storage.from(IMAGE.bucket).remove(list)
  if (error) throw fromSupabase(error)
}
export function framePublicUrl(path) {
  return path ? db().storage.from(IMAGE.bucket).getPublicUrl(path).data.publicUrl : ''
}

// ------------------------------------------------------------------ hooks
export const useLandingDefinition = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.landingDef(nodeId), queryFn: () => getLandingDefinition(nodeId), enabled: Boolean(nodeId), ...options })

export const useLandingLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.landingLink(nodeId), queryFn: () => getLandingLink(nodeId), enabled: Boolean(nodeId), ...options })

export const useLandingAnalytics = (nodeId, days = 90, options = {}) =>
  useQuery({ queryKey: keys.landingAnalytics(nodeId, days), queryFn: () => getLandingAnalytics(nodeId, days), enabled: Boolean(nodeId), staleTime: 15_000, ...options })

export const useFounderLandings = (projectId, options = {}) =>
  useQuery({ queryKey: keys.founderLandings(projectId), queryFn: () => listFounderLandings(projectId), enabled: Boolean(projectId), ...options })

/** The public page: refetched on focus (a PM's edit shows up when a visitor returns to the tab), no polling. */
export const usePublicLanding = (ref, options = {}) =>
  useQuery({ queryKey: keys.publicLanding(ref), queryFn: () => getPublicLanding(ref), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

export function useLandingMutations(nodeId) {
  const qc = useQueryClient()
  return {
    ensureLink: useMutation({ mutationFn: () => ensureLandingLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.landingLink(nodeId) }), meta: { silent: true } }),
  }
}
