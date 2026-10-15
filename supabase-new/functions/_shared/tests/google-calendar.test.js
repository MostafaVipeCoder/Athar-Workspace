import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CalendarConfigError, buildEventInsert, buildEventPatch, conferenceStatus, deriveAttendees, eventIdFromBookingId, extractMeetLink, formatRfc3339InZone, isValidEventId, isValidTimeZone,
  offsetMinutesAt, requireSharedLink,
} from '../google-calendar.js'

const BOOKING = '9F2C0A1B-3D4E-4F50-8A6B-7C8D9E0F1A2B'

describe('event id = the booking uuid as hex', () => {
  test('32 lower-case hex digits, no dashes, valid for Google (a-v, 0-9, 5-1024)', () => {
    const id = eventIdFromBookingId(BOOKING)
    assert.equal(id, '9f2c0a1b3d4e4f508a6b7c8d9e0f1a2b')
    assert.equal(id.length, 32)
    assert.ok(isValidEventId(id))
    assert.equal(eventIdFromBookingId(BOOKING.toLowerCase()), id)
  })
  test('is deterministic (idempotency) and injective for different bookings', () => {
    const other = '9f2c0a1b-3d4e-4f50-8a6b-7c8d9e0f1a2c'
    assert.equal(eventIdFromBookingId(BOOKING), eventIdFromBookingId(BOOKING))
    assert.notEqual(eventIdFromBookingId(BOOKING), eventIdFromBookingId(other))
  })
  test('refuses anything that is not a uuid', () => {
    for (const bad of ['', 'abc', null, undefined, 42, '9f2c0a1b3d4e4f508a6b7c8d9e0f1a2b', `${BOOKING}0`, '9f2c0a1b-3d4e-4f50-8a6b-7c8d9e0f1a2z']) {
      assert.throws(() => eventIdFromBookingId(bad), (e) => e instanceof CalendarConfigError && e.code === 'invalid_booking_id', String(bad))
    }
    assert.equal(isValidEventId('ABC12'), false)
    assert.equal(isValidEventId('abcw1'), false)
    assert.equal(isValidEventId('abc'), false)
  })
})

describe('project time zone (DST-correct, never UTC guesses)', () => {
  // Egypt's DST (restored 2023): UTC+3 from the last Friday of April to the last Thursday of October, UTC+2 otherwise.
  test('Africa/Cairo: +02:00 in winter, +03:00 in summer, switching at the end of Thu 29 Oct 2026', () => {
    assert.equal(formatRfc3339InZone('2026-01-15T10:00:00Z', 'Africa/Cairo'), '2026-01-15T12:00:00+02:00')
    assert.equal(formatRfc3339InZone('2026-07-15T10:00:00Z', 'Africa/Cairo'), '2026-07-15T13:00:00+03:00')
    assert.equal(formatRfc3339InZone('2026-10-28T10:00:00Z', 'Africa/Cairo'), '2026-10-28T13:00:00+03:00')
    assert.equal(formatRfc3339InZone('2026-11-02T10:00:00Z', 'Africa/Cairo'), '2026-11-02T12:00:00+02:00')
    assert.equal(formatRfc3339InZone('2026-04-20T10:00:00Z', 'Africa/Cairo'), '2026-04-20T12:00:00+02:00')
    assert.equal(formatRfc3339InZone('2026-05-01T10:00:00Z', 'Africa/Cairo'), '2026-05-01T13:00:00+03:00')
  })
  test('the exact instant the clocks move (Cairo, Oct 2026): 20:59:59Z is still +03:00, 21:00:00Z is +02:00', () => {
    assert.equal(formatRfc3339InZone('2026-10-29T20:59:59Z', 'Africa/Cairo'), '2026-10-29T23:59:59+03:00')
    assert.equal(formatRfc3339InZone('2026-10-29T21:00:00Z', 'Africa/Cairo'), '2026-10-29T23:00:00+02:00')
  })
  test('America/New_York (US DST: second Sunday of March at 02:00), Asia/Kolkata (+05:30), Asia/Riyadh, UTC', () => {
    assert.equal(formatRfc3339InZone('2026-03-08T06:59:59Z', 'America/New_York'), '2026-03-08T01:59:59-05:00')
    assert.equal(formatRfc3339InZone('2026-03-08T07:00:00Z', 'America/New_York'), '2026-03-08T03:00:00-04:00')
    assert.equal(formatRfc3339InZone('2026-06-01T00:00:00Z', 'Asia/Kolkata'), '2026-06-01T05:30:00+05:30')
    assert.equal(formatRfc3339InZone('2026-06-01T00:00:00Z', 'Asia/Riyadh'), '2026-06-01T03:00:00+03:00')
    assert.equal(formatRfc3339InZone('2026-06-01T00:00:00Z', 'UTC'), '2026-06-01T00:00:00+00:00')
  })
  test('midnight is 00:00, not 24:00, and the local DATE can differ from the UTC date', () => {
    assert.equal(formatRfc3339InZone('2026-12-31T22:00:00Z', 'Africa/Cairo'), '2027-01-01T00:00:00+02:00')
    assert.equal(formatRfc3339InZone('2026-01-01T00:30:00Z', 'America/New_York'), '2025-12-31T19:30:00-05:00')
  })
  test('the offset reported agrees with the formatted text; the same instant round-trips', () => {
    for (const tz of ['Africa/Cairo', 'America/New_York', 'Asia/Kolkata', 'Europe/London', 'Australia/Lord_Howe']) {
      for (const iso of ['2026-01-15T10:00:00Z', '2026-07-15T10:00:00Z', '2026-10-29T21:00:00Z']) {
        const text = formatRfc3339InZone(iso, tz)
        assert.equal(Date.parse(text), Date.parse(iso), `${tz} ${iso}`)
        const m = /([+-])(\d\d):(\d\d)$/.exec(text)
        assert.equal((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])), offsetMinutesAt(Date.parse(iso), tz))
      }
    }
  })
  test('invalid zones and instants are errors, not silent UTC', () => {
    assert.throws(() => formatRfc3339InZone('2026-01-01T00:00:00Z', 'Mars/Base'), (e) => e.code === 'invalid_timezone')
    assert.throws(() => formatRfc3339InZone('2026-01-01T00:00:00Z', ''), (e) => e.code === 'invalid_timezone')
    assert.throws(() => formatRfc3339InZone('not a date', 'Africa/Cairo'), (e) => e.code === 'invalid_time')
    assert.equal(isValidTimeZone('Africa/Cairo'), true)
    assert.equal(isValidTimeZone('Africa/Nowhere'), false)
    assert.equal(isValidTimeZone(null), false)
  })
})

describe('attendees', () => {
  test('lower-cased, de-duplicated, invalid dropped WITH a reason, order kept (booker, provider, cc, admin)', () => {
    const r = deriveAttendees({ booker: 'Founder@Example.com', provider: 'mentor@athareg.com', cc: 'a@athareg.com, FOUNDER@example.com; bad address', admin: ['Admin@athareg.com', 'a@athareg.com', '', null] })
    assert.deepEqual(r.attendees, [{ email: 'founder@example.com' }, { email: 'mentor@athareg.com' }, { email: 'a@athareg.com' }, { email: 'admin@athareg.com' }])
    assert.deepEqual(r.dropped.map((d) => [d.email, d.reason]), [['founder@example.com', 'duplicate'], ['bad address', 'invalid'], ['a@athareg.com', 'duplicate']])
  })
  test('one bad address never fails the others; the organizer is not listed; a limit applies', () => {
    const r = deriveAttendees({ booker: 'x@@y', provider: 'ok@athareg.com' }, { organizerEmail: 'OK@athareg.com' })
    assert.deepEqual(r.attendees, [])
    assert.deepEqual(r.dropped.map((d) => d.reason), ['invalid', 'duplicate'])
    const many = deriveAttendees({ cc: Array.from({ length: 60 }, (_, i) => `u${i}@example.com`) }, { limit: 50 })
    assert.equal(many.attendees.length, 50)
    assert.equal(many.dropped.filter((d) => d.reason === 'limit').length, 10)
  })
  test('nothing at all is fine', () => {
    assert.deepEqual(deriveAttendees(), { attendees: [], dropped: [] })
  })
})

describe('event bodies', () => {
  const common = { bookingId: BOOKING, summary: 'Mentor Session: Nile Co with Dr. Mona', description: 'Node A - Project B', startsAt: '2026-07-15T10:00:00Z', endsAt: '2026-07-15T10:30:00Z', timeZone: 'Africa/Cairo', attendees: [{ email: 'a@example.com' }] }

  test('unique mode: hex id, project-zone times with offset AND zone, createRequest with requestId = booking id, conferenceDataVersion=1', () => {
    const { id, event, query } = buildEventInsert({ ...common, meetMode: 'unique' })
    assert.equal(id, '9f2c0a1b3d4e4f508a6b7c8d9e0f1a2b')
    assert.equal(event.id, id)
    assert.deepEqual(event.start, { dateTime: '2026-07-15T13:00:00+03:00', timeZone: 'Africa/Cairo' })
    assert.deepEqual(event.end, { dateTime: '2026-07-15T13:30:00+03:00', timeZone: 'Africa/Cairo' })
    assert.deepEqual(event.conferenceData, { createRequest: { requestId: BOOKING.toLowerCase(), conferenceSolutionKey: { type: 'hangoutsMeet' } } })
    assert.deepEqual(query, { conferenceDataVersion: 1, sendUpdates: 'all' })
    assert.equal(event.guestsCanModify, false)
    assert.equal(event.guestsCanInviteOthers, false)
    assert.deepEqual(event.attendees, [{ email: 'a@example.com' }])
    assert.equal(event.location, undefined)
  })

  test('shared mode: the link goes to location + description, NO conferenceData, no conferenceDataVersion', () => {
    const { event, query } = buildEventInsert({ ...common, meetMode: 'shared', sharedLink: ' https://meet.google.com/abc-defg-hij ' })
    assert.equal(event.location, 'https://meet.google.com/abc-defg-hij')
    assert.ok(event.description.endsWith('https://meet.google.com/abc-defg-hij'))
    assert.ok(event.description.startsWith('Node A - Project B'))
    assert.equal('conferenceData' in event, false)
    assert.equal(query.conferenceDataVersion, 0)
  })

  test('an EMPTY shared link is an error (never a silent switch to unique); so is a non-https link', () => {
    for (const link of [null, undefined, '', '   ']) {
      assert.throws(() => buildEventInsert({ ...common, meetMode: 'shared', sharedLink: link }), (e) => e instanceof CalendarConfigError && e.code === 'shared_link_required', String(link))
    }
    for (const link of ['meet.google.com/abc', 'http://meet.google.com/abc', 'javascript:alert(1)', 'ftp://x']) {
      assert.throws(() => requireSharedLink(link), (e) => e.code === 'shared_link_invalid', link)
    }
    assert.equal(requireSharedLink('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij')
  })

  test('validates time order, zone, mode and booking id', () => {
    assert.throws(() => buildEventInsert({ ...common, endsAt: common.startsAt }), (e) => e.code === 'invalid_time')
    assert.throws(() => buildEventInsert({ ...common, startsAt: 'x' }), (e) => e.code === 'invalid_time')
    assert.throws(() => buildEventInsert({ ...common, timeZone: 'Nope/Zone' }), (e) => e.code === 'invalid_timezone')
    assert.throws(() => buildEventInsert({ ...common, meetMode: 'both' }), (e) => e.code === 'invalid_meet_mode')
    assert.throws(() => buildEventInsert({ ...common, bookingId: 'x' }), (e) => e.code === 'invalid_booking_id')
  })

  test('text fields are cleaned of control characters and bounded; the summary has a default', () => {
    const { event } = buildEventInsert({ ...common, summary: `S\u0000\u0007${'x'.repeat(400)}`, description: 'd'.repeat(9000) })
    assert.ok(!/[\u0000-\u0008]/.test(event.summary))
    assert.equal(event.summary.length, 250)
    assert.equal(event.description.length, 4000)
    assert.equal(buildEventInsert({ ...common, summary: '' }).event.summary, 'Athar session')
  })

  test('reschedule patch: new times in the project zone; attendees optional; never touches the id or the Meet link', () => {
    const { event, query } = buildEventPatch({ startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T09:30:00Z', timeZone: 'Africa/Cairo' })
    assert.deepEqual(event, { start: { dateTime: '2026-12-01T11:00:00+02:00', timeZone: 'Africa/Cairo' }, end: { dateTime: '2026-12-01T11:30:00+02:00', timeZone: 'Africa/Cairo' } })
    assert.deepEqual(query, { sendUpdates: 'all' })
    assert.deepEqual(buildEventPatch({ attendees: [{ email: 'x@y.co' }] }).event, { attendees: [{ email: 'x@y.co' }] })
    assert.throws(() => buildEventPatch({ startsAt: '2026-12-01T09:00:00Z' }), (e) => e.code === 'invalid_time')
    assert.throws(() => buildEventPatch({ startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T09:30:00Z', timeZone: 'bad' }), (e) => e.code === 'invalid_timezone')
  })
})

describe('reading an event back', () => {
  const ready = { conferenceData: { createRequest: { status: { statusCode: 'success' } }, entryPoints: [{ entryPointType: 'more', uri: 'https://tel.meet/x' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } }
  test('the Meet link: hangoutLink first, else the video entry point, else null', () => {
    assert.equal(extractMeetLink({ hangoutLink: 'https://meet.google.com/zzz' }), 'https://meet.google.com/zzz')
    assert.equal(extractMeetLink(ready), 'https://meet.google.com/abc-defg-hij')
    assert.equal(extractMeetLink({}), null)
    assert.equal(extractMeetLink(null), null)
  })
  test('conference status: success / pending / failure / none', () => {
    assert.equal(conferenceStatus(ready), 'success')
    assert.equal(conferenceStatus({ conferenceData: { createRequest: { status: { statusCode: 'pending' } } } }), 'pending')
    assert.equal(conferenceStatus({ conferenceData: { createRequest: { status: { statusCode: 'failure' } } } }), 'failure')
    assert.equal(conferenceStatus({ summary: 'no conference' }), 'none')
    assert.equal(conferenceStatus({ hangoutLink: 'https://meet.google.com/q' }), 'success')
  })
})
