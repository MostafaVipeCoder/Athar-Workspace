import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./client.js', () => ({ db: () => ({ rpc: mocks.rpc }) }))

const O = await import('./outbox.js')
const { keys } = await import('./queryKeys.js')
const { fromSupabase } = await import('./errors.js')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: {}, error: null })
})

describe('RPC names and arguments (pinned to m62)', () => {
  it('list_email_outbox: states / node / search are NULL when unset, the search is trimmed, defaults 50 / 0', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 2, counts: { sent: 2 }, rows: [{ id: 'a' }] }, error: null })
    const out = await O.listOutbox('p1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_email_outbox', { p_project: 'p1', p_states: null, p_node: null, p_search: null, p_limit: 50, p_offset: 0 })
    expect(out).toEqual({ total: 2, counts: { sent: 2 }, rows: [{ id: 'a' }] })
    await O.listOutbox('p1', { states: ['failed', 'needs_review'], nodeId: 'n1', search: '  ali@x.org ', limit: 25, offset: 50 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_email_outbox', { p_project: 'p1', p_states: ['failed', 'needs_review'], p_node: 'n1', p_search: 'ali@x.org', p_limit: 25, p_offset: 50 })
    await O.listOutbox('p1', { states: [], search: '   ' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_email_outbox', expect.objectContaining({ p_states: null, p_search: null }))
  })
  it('an empty answer is an empty list, never undefined', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await O.listOutbox('p1')).toEqual({ total: 0, counts: {}, rows: [] })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await O.getOutboxCounts('p1')).toEqual({ counts: {}, by_node: {}, attention: 0 })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await O.listStaffInvitationDelivery()).toEqual([])
  })
  it('item, counts, health, delivery and send-now call the contracted names', async () => {
    await O.getOutboxItem('x')
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_email_outbox_item', { p_id: 'x' })
    await O.getOutboxCounts('p1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_email_outbox_counts', { p_project: 'p1' })
    await O.getEmailHealth()
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_email_health')
    await O.listStaffInvitationDelivery()
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_staff_invitation_delivery')
    await O.sendNow('p1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('email_outbox_send_now', { p_project: 'p1' })
  })
  it('the four actions send de-duplicated ids (at most 500) and skip the call for an empty list', async () => {
    mocks.rpc.mockResolvedValue({ data: { requested: 2, updated: 2, skipped: 0 }, error: null })
    expect(await O.retryEmails(['a', 'b', 'a', null, ''])).toEqual({ requested: 2, updated: 2, skipped: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('email_outbox_retry', { p_ids: ['a', 'b'] })
    await O.cancelEmails(['a'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('email_outbox_cancel', { p_ids: ['a'] })
    await O.markEmailsSent(['a'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('email_outbox_mark_sent', { p_ids: ['a'] })
    await O.resendEmails(['a'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('email_outbox_resend', { p_ids: ['a'] })
    mocks.rpc.mockClear()
    expect(await O.retryEmails([])).toEqual({ requested: 0, updated: 0, skipped: 0 })
    expect(await O.cancelEmails(null)).toEqual({ requested: 0, updated: 0, skipped: 0 })
    expect(mocks.rpc).not.toHaveBeenCalled()
    await O.retryEmails(Array.from({ length: 700 }, (_, i) => `id-${i}`))
    expect(mocks.rpc.mock.calls[0][1].p_ids).toHaveLength(500)
  })
})

describe('errors', () => {
  it('a forbidden PM becomes an AppError(forbidden); a bad request carries the outbox token key', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden', hint: 'forbidden' } })
    await expect(O.listOutbox('p1')).rejects.toMatchObject({ code: 'forbidden' })
    const e = fromSupabase({ code: '22023', message: 'email_invalid: too many rows', hint: 'email_invalid', details: 'ids:too_many' })
    expect(e.messageKey).toBe('outbox.err.invalid')
  })
})

describe('query keys: ONE prefix per project', () => {
  it('the list, the counts and the node badges of a project share the prefix the actions invalidate', () => {
    expect(keys.outbox('p1', { a: 1 }).slice(0, 2)).toEqual(['outbox', 'p1'])
    expect(keys.outboxCounts('p1').slice(0, 2)).toEqual(['outbox', 'p1'])
    expect(keys.outboxItem('x')).toEqual(['outbox', 'item', 'x'])
    expect(keys.emailHealth()).toEqual(['emailHealth'])
    expect(keys.staffInvitationDelivery()).toEqual(['staff', 'invitationDelivery'])
  })
})
