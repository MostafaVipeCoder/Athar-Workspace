import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES, bookingColumns, confirmedBySlot, emailIndex, groupByDay, mergeProviders, normalizeBookingConfig, planSlots, slotState, splitPlan, syncState, validateBookingConfig } from './bookingConfig.js'

describe('bookingConfig', () => {
  it('normalises a migrated config (cc/admin only) and keeps the node-type defaults for the texts', () => {
    const c = normalizeBookingConfig({ emails: { booking_confirmation: { cc: ['a@x.io'], admin: ['b@x.io'] } } })
    expect(c.emails.booking_confirmation.cc).toEqual(['a@x.io'])
    expect(c.emails.booking_confirmation.subject).toBe(DEFAULT_TEMPLATES().booking_confirmation.subject)
    expect(c.emails.booking_cancellation.enabled).toBe(true)
    expect(c.slotDefaults).toEqual({ durationMin: 30, gapMin: 5, from: '10:00', to: '13:00' })
    expect(c.rules.max_bookings_per_email).toBeNull()
    expect(normalizeBookingConfig({ rules: { max_bookings_per_email: '2' }, slotDefaults: { from: 'nope', durationMin: 0 } })).toMatchObject({ rules: { max_bookings_per_email: 2 }, slotDefaults: { from: '10:00', durationMin: 30 } })
  })

  it('validates the settings draft: shared Meet mode needs an https link, unknown placeholders are refused', () => {
    const c = normalizeBookingConfig({})
    expect(validateBookingConfig(c, { meeting_link_mode: 'shared', shared_meet_link: '' })).toHaveProperty('shared_meet_link', 'booking.settings.sharedLinkRequired')
    expect(validateBookingConfig(c, { meeting_link_mode: 'shared', shared_meet_link: 'meet.google.com/x' })).toHaveProperty('shared_meet_link', 'booking.settings.sharedLinkInvalid')
    expect(validateBookingConfig(c, { meeting_link_mode: 'unique' })).toEqual({})
    const bad = { ...c, emails: { ...c.emails, booking_cancellation: { ...c.emails.booking_cancellation, body_html: 'x {{cancel_link}}' } } }
    expect(validateBookingConfig(bad, {})).toHaveProperty('emails.booking_cancellation', 'booking.emails.unknownPlaceholder')
  })

  it('plans whole slots in the PROJECT zone (toInstant) and splits overlaps against existing slots', () => {
    // 20 Nov 2026 Cairo = UTC+2 (no DST): 10:00 -> 08:00Z
    const plan = planSlots({ date: '2026-11-20', from: '10:00', to: '11:05', durationMin: 30, gapMin: 5, tz: 'Africa/Cairo' })
    expect(plan.map((s) => s.start)).toEqual(['10:00', '10:35'])
    expect(plan[0].startsAt).toBe('2026-11-20T08:00:00.000Z')
    expect(plan[1].endsAt).toBe('2026-11-20T09:05:00.000Z')
    const { fresh, overlapping } = splitPlan(plan, [{ starts_at: '2026-11-20T08:20:00Z', ends_at: '2026-11-20T08:40:00Z' }])
    expect(fresh.map((s) => s.start)).toEqual([])
    expect(overlapping).toHaveLength(2)
    expect(planSlots({ date: 'bad', from: '10:00', to: '11:00', durationMin: 30, tz: 'Africa/Cairo' })).toEqual([])
  })

  it('groups slots by day in the project zone and derives the slot state', () => {
    const slots = [
      { id: 's1', starts_at: '2026-11-20T22:30:00Z', ends_at: '2026-11-20T23:00:00Z', is_blocked: false }, // 00:30 on the 21st in Cairo
      { id: 's2', starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-20T08:30:00Z', is_blocked: true },
      { id: 's3', starts_at: '2026-11-20T09:00:00Z', ends_at: '2026-11-20T09:30:00Z', is_blocked: false },
    ]
    const days = groupByDay(slots, 'Africa/Cairo')
    expect(days.map((d) => d.date)).toEqual(['2026-11-20', '2026-11-21'])
    expect(days[0].slots.map((s) => s.id)).toEqual(['s2', 's3'])
    const bySlot = confirmedBySlot([{ id: 'b1', slot_id: 's3', status: 'confirmed' }, { id: 'b0', slot_id: 's2', status: 'cancelled' }])
    expect(slotState(slots[2], bySlot)).toBe('booked')
    expect(slotState(slots[1], bySlot, new Date('2026-01-01T00:00:00Z'))).toBe('blocked')
    expect(slotState(slots[0], bySlot, new Date('2027-01-01T00:00:00Z'))).toBe('past')
    expect(slotState(slots[0], bySlot, new Date('2026-01-01T00:00:00Z'))).toBe('free')
  })

  it('derives the calendar sync state from the job queue and the available connections', () => {
    const b = { id: 'b1', status: 'confirmed', legacy_calendar_event_id: null, meet_link: null }
    expect(syncState(b, [], []).key).toBe('none')
    expect(syncState({ ...b, legacy_calendar_event_id: 'abc' }, [], []).key).toBe('legacy')
    const pending = { booking_id: 'b1', kind: 'calendar_create', status: 'pending', connection_id: null, created_at: '1' }
    expect(syncState(b, [pending], []).key).toBe('waiting_connection')
    expect(syncState(b, [pending], [{ status: 'active' }]).key).toBe('pending')
    expect(syncState(b, [{ ...pending, status: 'done', created_at: '2' }, pending], []).key).toBe('synced')
    expect(syncState(b, [{ ...pending, status: 'failed', error: 'boom' }], []).key).toBe('failed')
    const cancelled = { ...b, status: 'cancelled' }
    expect(syncState(cancelled, [pending, { booking_id: 'b1', kind: 'calendar_cancel', status: 'done', created_at: '3' }], []).key).toBe('cancelled')
    expect(syncState(cancelled, [pending, { booking_id: 'b1', kind: 'calendar_cancel', status: 'pending', created_at: '3' }], []).key).toBe('waiting_connection')
  })

  it('merges list items with provider rows (by reference) and keeps orphans', () => {
    const items = [
      { id: 'i1', itemId: 'li1', entity: { title: { en: 'A', ar: '' }, email: 'a@x.io' }, missing: false },
      { id: 'virtual:x', itemId: null, entity: { title: { en: 'B', ar: '' }, email: null }, missing: false },
    ]
    const rows = mergeProviders(items, [{ id: 'p1', list_item_id: 'li1', is_active: true, booking_email: 'book@x.io', advance_notice_min: 60 }, { id: 'p9', list_item_id: 'gone', is_active: true }])
    expect(rows.map((r) => [r.key, r.enabled, r.email, r.notice, r.orphan])).toEqual([['i1', true, 'book@x.io', 60, false], ['virtual:x', false, '', null, false], ['orphan:p9', true, '', null, true]])
  })

  it('indexes outbox rows per booking and builds the Excel columns', () => {
    const idx = emailIndex([{ booking_id: 'b1', email_key: 'booking_confirmation', status: 'queued', created_at: '1' }, { booking_id: 'b1', email_key: 'booking_confirmation', status: 'sent', created_at: '2' }])
    expect(idx.b1.booking_confirmation).toMatchObject({ count: 2, last: { status: 'sent' } })
    const t = (k) => k
    const cols = bookingColumns(t, 'en', { tz: 'Africa/Cairo', providerNames: { p1: 'Mentor One' }, sync: { b1: { key: 'synced' } } })
    const row = { id: 'b1', booker_name: 'Mona', booker_email: 'm@x.io', company: 'Delta', provider_id: 'p1', starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-20T08:30:00Z', status: 'confirmed', meet_link: null, created_at: 'c' }
    expect(cols.map((c) => c.key(row))).toEqual(['Mona', 'm@x.io', 'Delta', 'Mentor One', '2026-11-20 10:00', '10:30', 'booking.status.confirmed', 'booking.sync.synced', '', 'c'])
  })
})
