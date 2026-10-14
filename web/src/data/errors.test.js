import { describe, expect, it } from 'vitest'
import { AppError, fromSupabase, isRetryable, unwrap } from './errors.js'

describe('AppError mapping', () => {
  it('maps postgres codes', () => {
    expect(fromSupabase({ code: '42501', message: 'x' }).code).toBe('forbidden')
    expect(fromSupabase({ code: '23505', message: 'x' }).code).toBe('conflict')
    expect(fromSupabase({ code: '40001', message: 'conflict: current rev 3' }).code).toBe('conflict')
    expect(fromSupabase({ code: '40001', message: 'serialization failure' }).code).toBe('conflict')
    expect(fromSupabase({ code: 'PGRST116', message: 'x' }).code).toBe('not_found')
    expect(fromSupabase({ code: '23514', message: 'x' }).code).toBe('validation')
  })
  it('maps the save_node revision conflict (P0001 + the revision_conflict token, m52) to a conflict with the node.conflict text and keeps the current revision', () => {
    const e = fromSupabase({ code: 'P0001', message: 'revision_conflict: current rev 7', hint: 'revision_conflict', details: '7' })
    expect(e.code).toBe('conflict')
    expect(e.messageKey).toBe('node.conflict')
    expect(e.token).toBe('revision_conflict')
    expect(e.detail).toBe('7')
    expect(e.retryable).toBe(false)
    // the stale alumni save is the same kind of refusal
    expect(fromSupabase({ code: 'P0001', message: 'alumni_stale: reload', hint: 'alumni_stale' }).code).toBe('conflict')
  })
  it('maps network failures as retryable', () => {
    const e = fromSupabase(new TypeError('Failed to fetch'))
    expect(e.code).toBe('network')
    expect(e.retryable).toBe(true)
  })
  it('maps invalid credentials', () => {
    const err = Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 })
    const e = fromSupabase(err)
    expect(e.code).toBe('unauthenticated')
    expect(e.messageKey).toBe('errors.invalidCredentials')
  })
  it('maps http status and unknown', () => {
    expect(fromSupabase({ status: 404, message: 'm' }).code).toBe('not_found')
    expect(fromSupabase({ status: 500, message: 'm' }).retryable).toBe(true)
    expect(fromSupabase({ message: 'weird' }).code).toBe('unknown')
  })
  it('returns AppError untouched and null for no error', () => {
    const a = new AppError('forbidden')
    expect(fromSupabase(a)).toBe(a)
    expect(fromSupabase(null)).toBeNull()
  })
  it('unwrap throws AppError, never swallows', () => {
    expect(() => unwrap({ data: null, error: { code: '42501', message: 'x' } })).toThrow(AppError)
    expect(unwrap({ data: [1], error: null })).toEqual([1])
  })
  it('maps the m40 withdrawn tokens to specific messages', () => {
    expect(fromSupabase({ code: '22023', message: 'withdrawn_invalid: the reason is too long', hint: 'withdrawn_invalid' }).messageKey).toBe('entity.withdraw.err.invalid')
    expect(fromSupabase({ code: '22023', message: 'item_withdrawn: item x is withdrawn', hint: 'item_withdrawn' }).messageKey).toBe('entity.withdraw.err.itemWithdrawn')
  })
  it('retry policy', () => {
    expect(isRetryable(new AppError('forbidden'))).toBe(false)
    expect(isRetryable(new AppError('network'))).toBe(true)
  })
})
