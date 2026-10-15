// An in-memory twin of the service-role RPC adapter (google-edge.js createRpcDb) for the unit tests. It mirrors the semantics of
// the SQL functions of m61 (db/migrations/m61_google_oauth.sql): one-time nonces with an expiry, staff-only connect, super_admin-only
// system sender, one user connection per owner, a unique e-mail, the secret stored in a Vault map or a ciphertext map, a revoked
// connection loses its secret. db/verify/v61 tests the real SQL; tests/rpc-contract.test.js checks that both agree on names + args.

import { DbError } from '../../google-edge.js'

export function createMemoryDb({ users = {}, vault = true, maxOpenStates = 20, now = () => Date.now() } = {}) {
  // users: { [id]: { email, roles: ['project_manager', ...] } }
  const states = new Map() // nonceHash -> { userId, isSystem, expiresAt, consumedAt }
  const connections = new Map() // id -> row
  const vaultSecrets = new Map() // connection id -> plaintext token (stands for Supabase Vault)
  const ciphertexts = new Map() // connection id -> ciphertext
  let seq = 0
  const calls = []

  const isStaff = (u) => Boolean(u?.roles?.some((r) => ['super_admin', 'project_manager', 'alumni_manager'].includes(r)))
  const isSuper = (u) => Boolean(u?.roles?.includes('super_admin'))

  const db = {
    calls,
    states,
    connections,
    vaultSecrets,
    ciphertexts,
    async storageCapabilities() {
      calls.push('storageCapabilities')
      return { vault }
    },
    async oauthBegin({ userId, nonceHash, isSystem, expiresAt }) {
      calls.push('oauthBegin')
      const u = users[userId]
      if (!isStaff(u)) throw new DbError('forbidden')
      if (isSystem && !isSuper(u)) throw new DbError('forbidden')
      const open = [...states.values()].filter((s) => s.userId === userId && !s.consumedAt && s.expiresAt > now()).length
      if (open >= maxOpenStates) throw new DbError('too_many_attempts')
      states.set(nonceHash, { userId, isSystem: Boolean(isSystem), expiresAt: Date.parse(expiresAt), consumedAt: null })
      return { ok: true }
    },
    async oauthConsume({ nonceHash }) {
      calls.push('oauthConsume')
      const s = states.get(nonceHash)
      if (!s || s.consumedAt || s.expiresAt <= now()) return null
      s.consumedAt = now()
      const u = users[s.userId]
      if (!isStaff(u) || (s.isSystem && !isSuper(u))) return null
      return { user_id: s.userId, is_system: s.isSystem, user_email: u.email, is_super_admin: isSuper(u) }
    },
    async upsertConnection({ ownerUserId, actorId, isSystem, email, googleSub, scopes, storage, secret }) {
      calls.push('upsertConnection')
      const actor = users[actorId]
      if (isSystem && !isSuper(actor)) throw new DbError('forbidden')
      if (!isSystem && ownerUserId !== actorId) throw new DbError('forbidden')
      if (!['vault', 'aes'].includes(storage) || (storage === 'vault' && !vault)) throw new DbError('storage_unavailable')
      const mail = email.toLowerCase()
      const sameEmail = [...connections.values()].find((c) => c.email === mail)
      let row = isSystem ? [...connections.values()].find((c) => c.kind === 'system') : [...connections.values()].find((c) => c.kind === 'user' && c.owner_user_id === ownerUserId)
      if (sameEmail && sameEmail !== row) throw new DbError('email_in_use')
      if (!row) {
        row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, kind: isSystem ? 'system' : 'user', owner_user_id: isSystem ? null : ownerUserId }
        connections.set(row.id, row)
      }
      Object.assign(row, { email: mail, google_sub: googleSub, scopes: [...scopes], status: 'active', last_error: null, connected_at: new Date(now()).toISOString(), token_storage: storage })
      vaultSecrets.delete(row.id)
      ciphertexts.delete(row.id)
      if (storage === 'vault') vaultSecrets.set(row.id, secret)
      else ciphertexts.set(row.id, secret)
      return { connection_id: row.id }
    },
    async getSecret(connectionId) {
      calls.push('getSecret')
      const row = connections.get(connectionId)
      if (!row || row.status === 'revoked') return null
      const value = row.token_storage === 'vault' ? vaultSecrets.get(row.id) : ciphertexts.get(row.id)
      return value ? { storage: row.token_storage, value, email: row.email } : null
    },
    async lookupConnection({ userId, system }) {
      calls.push('lookupConnection')
      const u = users[userId]
      if (system && !isSuper(u)) throw new DbError('forbidden')
      const row = [...connections.values()].find((c) => (system ? c.kind === 'system' : c.kind === 'user' && c.owner_user_id === userId))
      return row ? { id: row.id, status: row.status, email: row.email, token_storage: row.token_storage } : null
    },
    async markConnection(connectionId, status, errorCode = null) {
      calls.push(`markConnection:${status}`)
      const row = connections.get(connectionId)
      if (!row) return null
      row.status = status
      row.last_error = errorCode
      if (status === 'revoked') {
        vaultSecrets.delete(row.id)
        ciphertexts.delete(row.id)
      }
      return { ok: true }
    },
    async touchConnection(connectionId) {
      calls.push('touchConnection')
      const row = connections.get(connectionId)
      if (row) row.last_used_at = new Date(now()).toISOString()
      return null
    },
    async resolveSender(userId) {
      const own = [...connections.values()].find((c) => c.kind === 'user' && c.owner_user_id === userId && c.status === 'active')
      const sys = [...connections.values()].find((c) => c.kind === 'system' && c.status === 'active')
      return (own ?? sys)?.id ?? null
    },
  }
  return db
}
