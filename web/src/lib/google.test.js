import { describe, expect, it } from 'vitest'
import { GOOGLE_REASONS, ltr, mineState, parseGoogleReturn, senderState, stateTone, stripGoogleParams, systemState } from './google.js'

describe('parseGoogleReturn', () => {
  it('reads ?google=connected, with and without the system target', () => {
    expect(parseGoogleReturn('?google=connected')).toEqual({ result: 'connected', reason: null, system: false })
    expect(parseGoogleReturn('?google=connected&target=system')).toEqual({ result: 'connected', reason: null, system: true })
  })
  it('reads a known reason of an error and ignores the target value it does not know', () => {
    expect(parseGoogleReturn('?google=error&reason=wrong_domain')).toEqual({ result: 'error', reason: 'wrong_domain', system: false })
    expect(parseGoogleReturn('?google=error&reason=email_mismatch&target=system')).toMatchObject({ reason: 'email_mismatch', system: true })
    expect(parseGoogleReturn('?google=error&reason=x&target=other').system).toBe(false)
  })
  it('NEVER trusts the reason text: anything off the list becomes server_error', () => {
    for (const bad of ['<script>alert(1)</script>', 'javascript:alert(1)', '../../x', '', 'WRONG_DOMAIN', 'a'.repeat(500)]) {
      expect(parseGoogleReturn(`?google=error&reason=${encodeURIComponent(bad)}`).reason).toBe('server_error')
    }
    expect(parseGoogleReturn('?google=error').reason).toBe('server_error')
  })
  it('is not a Google return when the parameter is missing or has another value', () => {
    for (const s of ['', '?', '?lang=en', '?google=maybe', '?reason=wrong_domain', null, undefined]) expect(parseGoogleReturn(s).result).toBeNull()
  })
  it('every reason of the list has a translation in both languages', async () => {
    await import('../shared/google/i18n.js')
    const { getMessages } = await import('../i18n/core.js')
    for (const lang of ['en', 'ar']) for (const r of GOOGLE_REASONS) expect(getMessages(lang)[`google.reason.${r}`], `${lang} ${r}`).toBeTruthy()
  })
})

describe('stripGoogleParams', () => {
  it('removes only the Google parameters', () => {
    expect(stripGoogleParams('?google=error&reason=wrong_domain&target=system&lang=en')).toBe('?lang=en')
    expect(stripGoogleParams('?google=connected')).toBe('')
    expect(stripGoogleParams('')).toBe('')
  })
})

describe('senderState (what would send for this user)', () => {
  const status = (over) => ({ mine: null, system: null, effective: { source: null, email: null, fallback: false, reason: 'no_connection' }, ...over })
  it('mine: the user\'s own account sends', () => {
    expect(senderState(status({ mine: { status: 'active', email: 'a@athareg.com' }, effective: { source: 'user', email: 'a@athareg.com', fallback: false, reason: null } }))).toEqual({ kind: 'mine', email: 'a@athareg.com' })
  })
  it('fallback: not connected, the system sender sends', () => {
    expect(senderState(status({ system: { email: 's@athareg.com', status: 'active' }, effective: { source: 'system', email: 's@athareg.com', fallback: true, reason: 'user_not_connected' } }))).toMatchObject({ kind: 'fallback', email: 's@athareg.com' })
  })
  it('fallbackReconnect: his connection stopped working, the system sender sends meanwhile', () => {
    expect(senderState(status({ mine: { status: 'needs_reconnect', email: 'a@athareg.com' }, effective: { source: 'system', email: 's@athareg.com', fallback: true, reason: 'user_needs_reconnect' } }))).toMatchObject({ kind: 'fallbackReconnect', mineEmail: 'a@athareg.com' })
  })
  it('none / noneReconnect: nobody can send', () => {
    expect(senderState(status({}))).toMatchObject({ kind: 'none', email: null })
    expect(senderState(status({ mine: { status: 'needs_reconnect' }, effective: { source: null, email: null, fallback: false, reason: 'user_needs_reconnect_no_system' } }))).toMatchObject({ kind: 'noneReconnect' })
  })
  it('unknown for a missing / odd status', () => {
    for (const s of [null, undefined, 'x', 0]) expect(senderState(s).kind).toBe('unknown')
  })
})

describe('connection states', () => {
  it('mine: connected only when active with both scopes; a stopped one needs reconnecting; none is not connected', () => {
    expect(mineState({ mine: { status: 'active', scopes_ok: true } })).toBe('connected')
    expect(mineState({ mine: { status: 'active', scopes_ok: false } })).toBe('needs_reconnect')
    expect(mineState({ mine: { status: 'needs_reconnect' } })).toBe('needs_reconnect')
    expect(mineState({ mine: null })).toBe('not_connected')
    expect(mineState(undefined)).toBe('not_connected')
  })
  it('system + tones', () => {
    expect(systemState({ system: { status: 'active' } })).toBe('connected')
    expect(systemState({ system: { status: 'needs_reconnect' } })).toBe('needs_reconnect')
    expect(systemState({ system: null })).toBe('not_connected')
    expect([stateTone('connected'), stateTone('needs_reconnect'), stateTone('not_connected')]).toEqual(['green', 'amber', 'neutral'])
  })
  it('ltr isolates an address with bidi controls and leaves nothing for an empty value', () => {
    expect(ltr('a@b.co')).toBe('⁦a@b.co⁩')
    expect(ltr('')).toBe('')
    expect(ltr(null)).toBe('')
  })
})
