import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { connectionHasScopes, resolveSender, senderDisplayName, senderFrom } from '../google-sender.js'
import { REQUIRED_SCOPES } from '../google-core.js'

const PM = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const own = (status = 'active', extra = {}) => ({ id: 'c-own', kind: 'user', owner_user_id: PM, status, email: 'pm.one@athareg.com', scopes: [...REQUIRED_SCOPES], ...extra })
const other = (status = 'active') => ({ id: 'c-other', kind: 'user', owner_user_id: OTHER, status, email: 'pm.two@athareg.com' })
const sys = (status = 'active') => ({ id: 'c-sys', kind: 'system', owner_user_id: null, status, email: 'startups@athareg.com' })

// The SAME table is asserted in SQL by db/verify/v61_google_oauth.sql for resolve_sender_connection(user_id).
const CASES = [
  ['own active wins over system', PM, [sys(), own()], 'c-own', 'user', false, null],
  ['own active, no system', PM, [own()], 'c-own', 'user', false, null],
  ['no own: falls back to system', PM, [sys(), other()], 'c-sys', 'system', true, 'user_not_connected'],
  ['own needs reconnect: system', PM, [own('needs_reconnect'), sys()], 'c-sys', 'system', true, 'user_needs_reconnect'],
  ['own revoked: system', PM, [own('revoked'), sys()], 'c-sys', 'system', true, 'user_not_connected'],
  ['own needs reconnect and no system: nobody', PM, [own('needs_reconnect')], null, null, false, 'user_needs_reconnect_no_system'],
  ['no connection at all', PM, [], null, null, false, 'no_connection'],
  ['only another PM is connected: nobody (never someone else\'s mailbox)', PM, [other()], null, null, false, 'no_connection'],
  ['system needs reconnect: nobody', PM, [system('needs_reconnect')], null, null, false, 'no_connection'],
  ['system revoked, own active: own', PM, [sys('revoked'), own()], 'c-own', 'user', false, null],
  ['no acting user (null): the system sender', null, [sys(), own()], 'c-sys', 'system', true, 'user_not_connected'],
  ['no acting user and no system', null, [own()], null, null, false, 'no_connection'],
  ['undefined user id never matches a NULL owner', undefined, [{ id: 'x', kind: 'user', owner_user_id: null, status: 'active' }], null, null, false, 'no_connection'],
]
function system(status) { return sys(status) }

describe('resolveSender', () => {
  for (const [name, userId, connections, id, source, fallback, reason] of CASES) {
    test(name, () => {
      const r = resolveSender({ userId, connections })
      assert.equal(r.connection?.id ?? null, id)
      assert.equal(r.source, source)
      assert.equal(r.fallback, fallback)
      assert.equal(r.reason, reason)
    })
  }
  test('tolerates junk input', () => {
    assert.equal(resolveSender().connection, null)
    assert.equal(resolveSender({ userId: PM, connections: [null, undefined, own()] }).connection.id, 'c-own')
    assert.equal(resolveSender({ userId: PM, connections: 'x' }).connection, null)
  })
})

describe('From header', () => {
  test('always the connected account; "<PM name> - Athar" for a PM, "Athar Startups" for the system sender', () => {
    const pm = resolveSender({ userId: PM, connections: [own()] })
    assert.deepEqual(senderFrom(pm, { pmName: '  Mona   Ahmed ' }), { email: 'pm.one@athareg.com', name: 'Mona Ahmed - Athar' })
    const fb = resolveSender({ userId: PM, connections: [sys()] })
    assert.deepEqual(senderFrom(fb, { pmName: 'Mona Ahmed' }), { email: 'startups@athareg.com', name: 'Athar Startups' })
    assert.equal(senderFrom({ connection: null }), null)
    assert.equal(senderDisplayName({ source: 'user', pmName: '' }), 'Athar')
    assert.equal(senderDisplayName({ source: 'user', pmName: 'x'.repeat(200) }).length, 80 + ' - Athar'.length)
  })
  test('both scopes are needed to count as usable', () => {
    assert.equal(connectionHasScopes(own()), true)
    assert.equal(connectionHasScopes(own('active', { scopes: ['https://www.googleapis.com/auth/gmail.send'] })), false)
    assert.equal(connectionHasScopes(null), false)
  })
})
