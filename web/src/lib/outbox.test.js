import { describe, expect, it } from 'vitest'
import {
  ALL_STATES, BLOCKED_REASONS, ERROR_CODES, FILTER_STATES, POLL_MS, activeCount, attentionCount, bulkTargets, emailKeyLabel, eventKey, explanationKey, expectedMessageId, gmailSearch, isRetryWaiting,
  nodeCounts, pollInterval, rowActions, senderUsage, stateKey, stateOf, totalCount, workerHealth,
} from './outbox.js'

describe('stateOf', () => {
  it('trusts the server state; derives it from status + blocked_reason otherwise; dead reads as failed', () => {
    expect(stateOf({ state: 'blocked', status: 'queued' })).toBe('blocked')
    expect(stateOf({ status: 'queued', blocked_reason: 'rate_limited' })).toBe('blocked')
    expect(stateOf({ status: 'queued' })).toBe('queued')
    expect(stateOf({ status: 'dead' })).toBe('failed')
    expect(stateOf({ status: 'needs_review' })).toBe('needs_review')
    expect(stateOf(null)).toBe('queued')
  })
  it('every state has a label key; an unknown state falls back to queued', () => {
    for (const s of ALL_STATES) expect(stateKey(s)).toBe(`outbox.state.${s}`)
    expect(stateKey('exploded')).toBe('outbox.state.queued')
  })
  it('the filter chips are the six states of the task, needs-me first', () => {
    expect([...FILTER_STATES].sort()).toEqual(['blocked', 'failed', 'needs_review', 'queued', 'sending', 'sent'])
    expect(FILTER_STATES[0]).toBe('needs_review')
  })
})

describe('explanations', () => {
  it('a blocked row explains the reason; a failed one the code; unknown codes get the generic sentence; needs_review always the unknown-outcome one', () => {
    for (const r of BLOCKED_REASONS) expect(explanationKey({ status: 'queued', blocked_reason: r })).toBe(`outbox.blocked.${r}`)
    for (const c of ERROR_CODES) expect(explanationKey({ status: 'failed', error_code: c })).toBe(`outbox.error.${c}`)
    expect(explanationKey({ status: 'failed', error_code: 'something_new' })).toBe('outbox.error.generic')
    expect(explanationKey({ status: 'failed' })).toBe('outbox.error.generic')
    expect(explanationKey({ status: 'needs_review', error_code: 'unknown_outcome' })).toBe('outbox.error.unknown_outcome')
    expect(explanationKey({ status: 'needs_review' })).toBe('outbox.error.unknown_outcome')
    expect(explanationKey({ status: 'sent' })).toBeNull()
    expect(explanationKey({ status: 'queued' })).toBeNull()
  })
  it('a retry that waits is a queued row with a streak', () => {
    expect(isRetryWaiting({ status: 'queued', fail_streak: 2 })).toBe(true)
    expect(isRetryWaiting({ status: 'queued', fail_streak: 0 })).toBe(false)
    expect(isRetryWaiting({ status: 'queued', blocked_reason: 'no_sender', fail_streak: 1 })).toBe(false)
    expect(isRetryWaiting({ status: 'failed', fail_streak: 6 })).toBe(false)
  })
  it('event and e-mail key labels have a fallback', () => {
    expect(eventKey('send_started')).toBe('outbox.event.send_started')
    expect(eventKey('whatever')).toBe('outbox.event.other')
    expect(emailKeyLabel('interview')).toBe('outbox.key.interview')
    expect(emailKeyLabel('welcome')).toBe('outbox.key.other')
  })
})

describe('rowActions: the same rules as the SQL', () => {
  const a = (status) => rowActions({ status })
  it('queued: retry now, cancel', () => expect(a('queued')).toEqual({ retry: true, cancel: true, markSent: false, resend: false }))
  it('failed / dead: retry, cancel, mark as sent', () => {
    expect(a('failed')).toEqual({ retry: true, cancel: true, markSent: true, resend: false })
    expect(a('dead')).toEqual({ retry: true, cancel: true, markSent: true, resend: false })
  })
  it('needs_review: mark as sent, resend, cancel; never a plain retry', () => expect(a('needs_review')).toEqual({ retry: false, cancel: true, markSent: true, resend: true }))
  it('sending / sent / cancelled: nothing', () => {
    for (const s of ['sending', 'sent', 'cancelled']) expect(a(s)).toEqual({ retry: false, cancel: false, markSent: false, resend: false })
  })
  it('bulkTargets lists the ids each action applies to', () => {
    const rows = [{ id: '1', status: 'failed' }, { id: '2', status: 'needs_review' }, { id: '3', status: 'sent' }, { id: '4', status: 'queued' }]
    expect(bulkTargets(rows)).toEqual({ retry: ['1', '4'], cancel: ['1', '2', '4'], markSent: ['1', '2'], resend: ['2'] })
    expect(bulkTargets(null)).toEqual({ retry: [], cancel: [], markSent: [], resend: [] })
  })
})

describe('counts and refresh', () => {
  const counts = { sent: 10, failed: 2, needs_review: 1, blocked: 3, queued: 4, sending: 1, cancelled: 5 }
  it('attention = failed + needs_review + blocked; active = queued + blocked + sending; total = everything', () => {
    expect(attentionCount(counts)).toBe(6)
    expect(activeCount(counts)).toBe(8)
    expect(totalCount(counts)).toBe(26)
    expect(attentionCount(undefined)).toBe(0)
    expect(attentionCount({ failed: 'x' })).toBe(0)
  })
  it('polls every 10 s only while mail is on its way', () => {
    expect(pollInterval(counts)).toBe(POLL_MS)
    expect(pollInterval({ sent: 3, failed: 1 })).toBe(false)
    expect(pollInterval(undefined)).toBe(false)
    expect(pollInterval({ blocked: 1 })).toBe(POLL_MS)
  })
  it('nodeCounts reads one node out of the project payload', () => {
    expect(nodeCounts({ by_node: { a: { sent: 2 } } }, 'a')).toEqual({ sent: 2 })
    expect(nodeCounts({ by_node: {} }, 'a')).toEqual({})
    expect(nodeCounts(null, 'a')).toEqual({})
  })
})

describe('Message-ID helpers', () => {
  it('the Gmail search for a Message-ID', () => {
    expect(gmailSearch('<abc.1@athareg.com>')).toBe('rfc822msgid:abc.1@athareg.com')
    expect(gmailSearch('abc.1@athareg.com')).toBe('rfc822msgid:abc.1@athareg.com')
    expect(gmailSearch('')).toBe('')
    expect(gmailSearch(null)).toBe('')
  })
  it('the expected Message-ID of the attempt that may have left (the worker names it <outbox id.attempt@sender domain>)', () => {
    expect(expectedMessageId({ id: 'row-1', send_attempt: 2 }, 'pm@athareg.com')).toBe('<row-1.2@athareg.com>')
    expect(expectedMessageId({ id: 'row-1', send_attempt: 0 }, 'pm@athareg.com')).toBe('<row-1.1@athareg.com>')
    expect(expectedMessageId({ id: 'row-1', sender_email: 'startups@athareg.com' })).toBe('<row-1.1@athareg.com>')
    expect(expectedMessageId({}, 'x@y.z')).toBe('')
  })
})

describe('health', () => {
  const h = (age, q = {}) => ({ worker: { age_seconds: age }, queue: { ready: 0, waiting: 0, blocked: 0, ...q } })
  it('a worker that ran a moment ago is ok; silent for more than 3 minutes with mail waiting is stalled; never ran with mail waiting is "never"', () => {
    expect(workerHealth(h(20, { ready: 3 }))).toBe('ok')
    expect(workerHealth(h(600, { ready: 3 }))).toBe('stalled')
    expect(workerHealth(h(600, {}))).toBe('ok')
    expect(workerHealth(h(null, { waiting: 1 }))).toBe('never')
    expect(workerHealth(h(null, {}))).toBe('idle')
    expect(workerHealth({})).toBe('unknown')
  })
  it('sender usage is capped at 100 % of each limit', () => {
    expect(senderUsage({ started_1m: 15, started_24h: 300 })).toMatchObject({ minute: 15, day: 300, minuteRatio: 0.5, dayRatio: 0.2 })
    expect(senderUsage({ started_1m: 99, started_24h: 9999 })).toMatchObject({ minuteRatio: 1, dayRatio: 1 })
    expect(senderUsage(undefined)).toMatchObject({ minute: 0, day: 0 })
  })
})
