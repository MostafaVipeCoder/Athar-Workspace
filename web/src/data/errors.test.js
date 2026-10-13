import { describe, expect, it } from 'vitest'
import { AppError, fromSupabase, isRetryable, unwrap } from './errors.js'

describe('AppError mapping', () => {
  it('maps postgres codes', () => {
    expect(fromSupabase({ code: '42501', message: 'x' }).code).toBe('forbidden')
    expect(fromSupabase({ code: '23505', message: 'x' }).code).toBe('conflict')
    expect(fromSupabase({ code: '40001', message: 'conflict: current rev 3' }).code).toBe('conflict')
    expect(fromSupabase({ code: 'PGRST116', message: 'x' }).code).toBe('not_found')
    expect(fromSupabase({ code: '23514', message: 'x' }).code).toBe('validation')
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
