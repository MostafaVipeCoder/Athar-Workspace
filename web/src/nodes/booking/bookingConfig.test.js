import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES, SYNC_RETRYABLE, SYNC_STATES, SYNC_TONE, bookingColumns, confirmedBySlot, emailIndex, googleCalendarEventUrl, groupByDay, mergeProviders, normalizeBookingConfig, overviewIndex, planSlots, providerName, slotState, splitPlan, syncCodeKey, syncState, validateBookingConfig } from './bookingConfig.js'

describe('bookingConfig: withdrawn providers (m40)', () => {
  it('a provider whose list item was marked WITHDRAWN is kept as a named "withdrawn" row, not an anonymous orphan', () => {
    const items = [{ id: 'li1', itemId: 'li1', entity: { title: { en: 'Alice', ar: '' } }, contact: {} }]
    const providers = [{ id: 'p1', list_item_id: 'li1', is_active: true }, { id: 'p2', list_item_id: 'w1', is_active: true }, { id: 'p3', list_item_id: 'gone', is_active: true }]
    const rows = mergeProviders(items, providers, new Map([['w1', { id: 'w1', name_en: 'Walid', name_ar: 'وليد' }]]))
    const w = rows.find((r) => r.provider.id === 'p2')
    expect(w).toMatchObject({ withdrawn: true, orphan: false, missing: false, item: null })
    expect(providerName(w, 'en')).toBe('Walid')
    expect(providerName(w, 'ar')).toBe('وليد')
    const orphan = rows.find((r) => r.provider.id === 'p3')
    expect(orphan).toMatchObject({ orphan: true, missing: true, withdrawn: false })
    expect(rows[0].withdrawn).toBeUndefined() // a live provider carries no flag
    expect(mergeProviders(items, providers).find((r) => r.provider?.id === 'p2').orphan).toBe(true) // without the extras it is an orphan as before
  })
})

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

  it('m63: the database-derived state wins over the queue rows; an unknown state degrades to none; every state has a tone and a label key', () => {
    const b = { id: 'b1', status: 'confirmed' }
    const idx = overviewIndex({ bookings: [{ booking_id: 'b1', state: 'shadow', job: { id: 'j' } }, { booking_id: 'b2', state: 'martian' }] })
    expect(Object.keys(idx)).toEqual(['b1', 'b2'])
    expect(syncState(b, [{ booking_id: 'b1', kind: 'calendar_create', status: 'done', created_at: '1' }], [], idx)).toMatchObject({ key: 'shadow', job: { id: 'j' } })
    expect(syncState({ id: 'b2' }, [], [], idx).key).toBe('none')
    expect(syncState({ id: 'b3', status: 'confirmed' }, [], [], idx).key).toBe('none') // not in the overview: the queue rows decide (none here)
    expect(overviewIndex(null)).toEqual({})
    for (const k of SYNC_STATES) expect(SYNC_TONE[k], k).toBeTruthy()
    expect(SYNC_RETRYABLE).toEqual(expect.arrayContaining(['failed', 'retrying', 'needs_connection']))
    expect(SYNC_RETRYABLE).not.toContain('synced')
  })

  it('m63: machine codes map to a message key (the status after the colon is dropped, anything unknown is generic)', () => {
    expect(syncCodeKey('rate_limited:429')).toBe('rate_limited')
    expect(syncCodeKey('server_error:503')).toBe('server_error')
    expect(syncCodeKey('shared_link_required')).toBe('shared_link_required')
    expect(syncCodeKey('a@b.com said no')).toBe('unknown')
    expect(syncCodeKey(null)).toBe('unknown')
  })

  it('m63: the Google Calendar link is the htmlLink of Google, else the eid link built from the event id and the calendar account (no padding)', () => {
    expect(googleCalendarEventUrl({ job: { html_link: 'https://www.google.com/calendar/event?eid=abc' } })).toBe('https://www.google.com/calendar/event?eid=abc')
    expect(googleCalendarEventUrl({ job: { html_link: 'https://evil.example/x' }, event_id: 'abc12', calendar_email: 'pm@athareg.com' })).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/event\?eid=/)
    const url = googleCalendarEventUrl({ event_id: 'abc12', calendar_email: 'pm@athareg.com' })
    const enc = decodeURIComponent(url.split('eid=')[1])
    expect(atob(enc + '='.repeat((4 - (enc.length % 4)) % 4))).toBe('abc12 pm@athareg.com')
    expect(url).not.toContain('%3D')
    expect(googleCalendarEventUrl({ event_id: 'abc12' })).toBeNull()
    expect(googleCalendarEventUrl(null)).toBeNull()
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
