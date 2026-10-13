import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { appBaseUrl } from '../lib/links.js'

/**
 * Booking node data (design 01 section 6.3, 02 section 3.8, 04 section 3.9 / 5.6; migrations m06d + m34).
 * - Providers are REFERENCES to list items of the connected List (`booking_providers.list_item_id` + overlay: booking
 *   e-mail, advance notice, enabled); names/photos come from the list resolver, never copied.
 * - Slots and bookings are read by the PM under RLS (raw rows, needed columns only); the calendar/Meet sync state lives
 *   in `app_private.integration_jobs` and the e-mails in `app_private.email_outbox`, both read through ONE RPC
 *   (`get_booking_extras`). Writes with logic are RPCs (bulk slots, cancel/restore/reschedule, retry); the simple
 *   provider/slot edits are row-level writes under the PM policies.
 * - The public page and the booking itself go through the anon-callable RPCs (`get_public_booking_page`,
 *   `create_booking`, `cancel_booking`): the DB validates the slot, the notice window, the invitation token and the
 *   per-e-mail limit, and the UNIQUE (slot_id) WHERE confirmed index makes a double booking impossible.
 */
export const BOOKING_LINK_KIND = 'booking'

const BOOKING_COLUMNS = 'id, slot_id, status, booker_email, booker_name, booker_item_id, booker_company_id, booker_company_name, invitation_id, meet_link, legacy_calendar_event_id, calendar_event_id, calendar_owner_connection_id, cancelled_at, cancel_reason, lang, created_at, updated_at'

// ------------------------------------------------------------------ PM reads
export async function getBookingAdmin(nodeId) {
  const [settings, providers, slots, bookings] = await Promise.all([
    db().from('booking_settings').select('node_id, mode, default_advance_notice_min, meeting_link_mode, shared_meet_link, organizer_connection_id').eq('node_id', nodeId).maybeSingle(),
    db().from('booking_providers').select('id, list_item_id, advance_notice_min, booking_email, is_active, sort_order, created_at').eq('node_id', nodeId).order('sort_order', { nullsFirst: false }).order('created_at'),
    db().from('booking_slots').select('id, provider_id, starts_at, ends_at, is_blocked, created_at').eq('node_id', nodeId).order('starts_at'),
    db().from('bookings').select(BOOKING_COLUMNS).eq('node_id', nodeId).order('created_at', { ascending: false }),
  ])
  return {
    settings: unwrap(settings) ?? null,
    providers: unwrap(providers) ?? [],
    slots: unwrap(slots) ?? [],
    bookings: unwrap(bookings) ?? [],
  }
}

export async function getBookingExtras(nodeId) {
  return unwrap(await db().rpc('get_booking_extras', { p_node: nodeId })) ?? {}
}

/** The node's public booking link (kind 'booking'). Migrated nodes carry one link per legacy provider id (view_key = the provider): any of them opens the page. */
export async function getBookingLink(nodeId) {
  const rows = unwrap(await db().from('public_links').select('id, is_enabled, view_key, created_at').eq('node_id', nodeId).eq('kind', BOOKING_LINK_KIND).order('created_at')) ?? []
  const link = rows.find((l) => !l.view_key) ?? rows[0] ?? null
  if (!link) return null
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', link.id).eq('is_current', true).maybeSingle())
  return { linkId: link.id, slug: slug?.slug ?? null, enabled: link.is_enabled }
}
export async function ensureBookingLink(nodeId) {
  const existing = await getBookingLink(nodeId)
  if (existing) return existing
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: BOOKING_LINK_KIND, p_view_key: null, p_project: null }))
  return getBookingLink(nodeId)
}

// ------------------------------------------------------------------ PM writes
/** Insert-or-update of the provider overlay row for a list item (unique (node_id, list_item_id)). */
export async function upsertProvider(nodeId, projectId, row) {
  return unwrap(await db().from('booking_providers').upsert({ ...row, node_id: nodeId, project_id: projectId }, { onConflict: 'node_id,list_item_id' }).select('id').single())
}
export async function updateProvider(providerId, patch) {
  unwrap(await db().from('booking_providers').update(patch).eq('id', providerId))
}
/** Hard delete of the overlay row; refused by the DB (23503) while slots exist. */
export async function deleteProvider(providerId) {
  unwrap(await db().from('booking_providers').delete().eq('id', providerId))
}
/** Bulk slot creation: [{ starts_at, ends_at }] (ISO instants). Overlaps are skipped by the DB, never an error. Returns { created, overlapped, invalid, ids }. */
export async function addBookingSlots(nodeId, providerId, slots) {
  return unwrap(await db().rpc('add_booking_slots', { p_node: nodeId, p_provider: providerId, p_slots: slots }))
}
export async function setSlotBlocked(slotId, blocked) {
  unwrap(await db().from('booking_slots').update({ is_blocked: blocked }).eq('id', slotId))
}
/** Hard delete of free slots; a booked slot is refused by the FK (23503). */
export async function deleteSlots(ids) {
  if (!ids.length) return
  unwrap(await db().from('booking_slots').delete().in('id', ids))
}
export async function cancelBooking(bookingId, token = null) {
  unwrap(await db().rpc('cancel_booking', { p_booking: bookingId, p_token: token }))
}
export async function restoreBooking(bookingId) {
  unwrap(await db().rpc('restore_booking', { p_booking: bookingId }))
}
export async function rescheduleBooking(bookingId, slotId) {
  return unwrap(await db().rpc('reschedule_booking', { p_booking: bookingId, p_slot: slotId }))
}
export async function retryCalendarJob(bookingId) {
  return unwrap(await db().rpc('retry_calendar_job', { p_booking: bookingId }))
}

// ------------------------------------------------------------------ public (anon or signed in; the DB decides the audience)
export async function getPublicBookingPage(ref, { host = null, invite = null } = {}) {
  return unwrap(await db().rpc('get_public_booking_page', { p_ref: ref, p_host: host ?? null, p_invite: invite ?? null }))
}
/** `booker` = { name, email, company_name?, lang? }; the app base URL travels along for the cancel link in the e-mail. */
export async function createBooking(ref, slotId, booker, invite = null) {
  return unwrap(await db().rpc('create_booking', { p_ref: ref, p_slot: slotId, p_booker: { ...booker, base_url: appBaseUrl() }, p_invite: invite ?? null }))
}

// ------------------------------------------------------------------ hooks
export const useBookingAdmin = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.bookingAdmin(nodeId), queryFn: () => getBookingAdmin(nodeId), enabled: Boolean(nodeId), refetchOnWindowFocus: true, staleTime: 15_000, ...options })

export const useBookingExtras = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.bookingExtras(nodeId), queryFn: () => getBookingExtras(nodeId), enabled: Boolean(nodeId), refetchOnWindowFocus: true, staleTime: 15_000, ...options })

export const useBookingLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.bookingLink(nodeId), queryFn: () => getBookingLink(nodeId), enabled: Boolean(nodeId), ...options })

/** The public page: refetched on focus (a slot may have been taken meanwhile; the DB is the authority anyway). */
export const usePublicBooking = (ref, { host = null, invite = null } = {}, options = {}) =>
  useQuery({ queryKey: keys.publicBooking(ref, host, invite), queryFn: () => getPublicBookingPage(ref, { host, invite }), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 20_000, ...options })

/** Every success invalidates the node's cache (admin payload + extras + outputs) and calls `onChanged` (graph refresh). */
export function useBookingMutations(nodeId, projectId, { onChanged } = {}) {
  const qc = useQueryClient()
  const after = async () => {
    await qc.invalidateQueries({ queryKey: keys.node(nodeId) })
    await onChanged?.()
  }
  const useM = (mutationFn) => useMutation({ mutationFn, onSuccess: after, meta: { silent: true } })
  const m = useM
  return {
    upsertProvider: m(({ row }) => upsertProvider(nodeId, projectId, row)),
    updateProvider: m(({ providerId, patch }) => updateProvider(providerId, patch)),
    deleteProvider: m(({ providerId }) => deleteProvider(providerId)),
    addSlots: m(({ providerId, slots }) => addBookingSlots(nodeId, providerId, slots)),
    setSlotBlocked: m(({ slotId, blocked }) => setSlotBlocked(slotId, blocked)),
    deleteSlots: m(({ ids }) => deleteSlots(ids)),
    cancel: m(({ bookingId }) => cancelBooking(bookingId)),
    restore: m(({ bookingId }) => restoreBooking(bookingId)),
    reschedule: m(({ bookingId, slotId }) => rescheduleBooking(bookingId, slotId)),
    retrySync: m(({ bookingId }) => retryCalendarJob(bookingId)),
    ensureLink: useMutation({ mutationFn: () => ensureBookingLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.bookingLink(nodeId) }), meta: { silent: true } }),
  }
}
