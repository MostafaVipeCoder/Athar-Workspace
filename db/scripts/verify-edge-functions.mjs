#!/usr/bin/env node
// verify-edge-functions.mjs - END-TO-END proof that the Google OAuth edge functions work on the LOCAL stack's real Edge Runtime,
// through Kong, against the FAKE Google (db/scripts/fake-google). Run it after `bash db/scripts/dev-functions.sh up`.
//
//   node db/scripts/verify-edge-functions.mjs                  # expects Vault storage (TOKEN_STORAGE=auto on the local image)
//   node db/scripts/verify-edge-functions.mjs --storage aes    # expects AES-256-GCM storage (set TOKEN_STORAGE=aes in local-db/functions.env, `dev-functions.sh up`)
//
// What it proves (about 45 checks): gateway JWT checks, start -> consent URL (PKCE S256, exact redirect URI) -> fake consent -> callback ->
// redirect with ?google=connected, the row (status, storage, e-mail, scopes), WHERE the token is (encrypted in Vault, or an AES blob) and that no
// client role can read it (PostgREST: no table, schemas app_private / vault not exposed, google_secret_get refused for a PM and for anon, privileges),
// replayed / tampered / expired / never-issued state, a non-athareg.com account, another mailbox, Cancel, disconnect (revoked at Google, secret
// deleted), the system sender (wrong account refused, startups@ accepted, disconnect).
//
// Safety: refuses to run unless local-db/functions.env has ALLOW_FAKE_GOOGLE=1 AND the fake server answers (it can never reach the real Google);
// throwaway users are created with app_metadata.provisioned = true (no founder row, no alumni change-log entry), a staff role is granted by SQL,
// and EVERYTHING it created is deleted at the end (users, connections, Vault secrets). It never prints a token, key, secret or password.
// Exit code 0 = all checks passed.
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const EXPECT = argv.includes('--storage') ? argv[argv.indexOf('--storage') + 1] : 'vault'
if (!['vault', 'aes'].includes(EXPECT)) { console.error('--storage must be vault or aes'); process.exit(2) }
const API = process.env.SUPABASE_API_URL || 'http://127.0.0.1:54321'
const STACK = path.join(ROOT, 'local-db', 'stack')
const DB_CONTAINER = 'supabase_db_stack'

// ---- configuration: the same env file the functions read (values are used, never printed)
const envPath = path.join(ROOT, 'local-db', 'functions.env')
let env
try {
  env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
} catch {
  console.error('local-db/functions.env not found: run `bash db/scripts/dev-functions.sh up` first'); process.exit(2)
}
if (env.ALLOW_FAKE_GOOGLE !== '1') { console.error('refusing: ALLOW_FAKE_GOOGLE is not 1 in local-db/functions.env (this test must only ever talk to the FAKE Google)'); process.exit(2) }
const FAKE = (env.GOOGLE_AUTH_BASE || '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(FAKE)) { console.error('refusing: GOOGLE_AUTH_BASE is not a loopback address'); process.exit(2) }
const APP_URL = env.APP_URL
const APP_ORIGIN = new URL(APP_URL).origin
const STATE_SECRET = env.OAUTH_STATE_SECRET
try { const h = await fetch(`${FAKE}/__health`); if (!h.ok) throw new Error() } catch { console.error(`refusing: the fake Google does not answer on ${FAKE} (bash db/scripts/dev-functions.sh up)`); process.exit(2) }

const statusEnv = execSync('npx supabase status -o env', { cwd: STACK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const kv = Object.fromEntries(statusEnv.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const ANON = kv.ANON_KEY
const SERVICE = kv.SERVICE_ROLE_KEY
if (!ANON || !SERVICE) { console.error('cannot read the local stack keys (is it running?)'); process.exit(2) }

const { signState, newNonce, deriveCodeVerifier, codeChallengeS256 } = await import(pathToFileURL(path.join(ROOT, 'supabase-new', 'functions', '_shared', 'google-core.js')).href)

// ---- helpers
let pass = 0
let fail = 0
const lines = []
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}
const sql = (q) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-c', q], { encoding: 'utf8' }).trim()
const sqlOne = (q) => sql(q).split('\n')[0]
const json = async (res) => { try { return await res.json() } catch { return null } }
const H = (token, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra })
const fakeState = async () => json(await fetch(`${FAKE}/__state?include_tokens=1`))
const nextAccount = (a) => fetch(`${FAKE}/__control/next-account`, { method: 'POST', body: JSON.stringify(a), headers: { 'content-type': 'application/json' } })
const rid = crypto.randomBytes(3).toString('hex')
const created = { userIds: [], emails: [], systemCreated: false }

// A staff account is created like the other verification scripts do it: a direct insert with raw_app_meta_data.provisioned = true, so that
// handle_new_user adds NO founder row and NO role (the admin API would make a founder first, and every founder row writes an
// append-only alumni change-log entry that nobody may delete). The role is then granted by SQL.
async function createStaff(email, role) {
  const password = `Pw-${crypto.randomBytes(18).toString('base64url')}`
  const id = crypto.randomUUID()
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"],"provisioned":true}', '{"full_name":"Edge Verify"}', now(), now(), '', '', '', '', '', '', '', '')`)
  created.userIds.push(id); created.emails.push(email)
  sql(`insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
       select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now() from auth.users u where u.id = '${id}'`)
  sql(`insert into public.user_roles(user_id, role_key) values ('${id}', '${role}') on conflict do nothing`)
  return { id, email, password }
}
async function login(u) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) })
  const b = await json(r)
  if (!b?.access_token) throw new Error(`login failed: HTTP ${r.status}`)
  return b.access_token
}
async function startOAuth(token, body = {}) {
  const r = await fetch(`${API}/functions/v1/google-oauth-start`, { method: 'POST', headers: H(token, { Origin: APP_ORIGIN }), body: JSON.stringify(body) })
  return { status: r.status, body: await json(r), acao: r.headers.get('access-control-allow-origin') }
}
async function runConsent(url) { // consent URL -> (fake) redirect with code + state -> callback through Kong -> final redirect to the app
  const a = await fetch(url, { redirect: 'manual' })
  const loc = a.headers.get('location') || ''
  const cb = await fetch(loc, { redirect: 'manual' })
  return { callbackUrl: loc, callbackStatus: cb.status, final: cb.headers.get('location') || '' }
}
const outcome = (final) => { const u = new URL(final || 'http://x/?'); return { google: u.searchParams.get('google'), reason: u.searchParams.get('reason'), target: u.searchParams.get('target') } }
const vaultCount = () => Number(sqlOne('select count(*) from vault.secrets'))
const connRow = (uid) => sql(`select status||'|'||token_storage||'|'||email||'|'||case when is_system then 'sys' else 'user' end from app_private.google_connections where owner_user_id='${uid}'`).split('|')
const keysOf = (v, acc = new Set()) => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysOf(x, acc) } return acc }

async function resetFake() {
  await fetch(`${FAKE}/__reset`, { method: 'POST' })
  await fetch(`${FAKE}/__control/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUris: [env.GOOGLE_REDIRECT_URI] }) })
}

// ------------------------------------------------------------------------------------------------------------------------ the PM flow
async function phasePm() {
  const vault0 = vaultCount()
  const pm = await createStaff(`edge-verify-pm-${rid}@athareg.com`, 'project_manager')
  const pm2 = await createStaff(`edge-verify-pm2-${rid}@athareg.com`, 'project_manager')
  const tok = await login(pm)
  const tok2 = await login(pm2)
  await resetFake()

  // gateway and start
  const hello = await fetch(`${API}/functions/v1/hello-world?db=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  const helloBody = await json(hello)
  check('hello-world answers through Kong with a database round trip (service key injected, Vault reported)', hello.status === 200 && helloBody?.db?.ok === true, `HTTP ${hello.status}, vault=${helloBody?.db?.capabilities?.vault}`)
  check('hello-world sees OUR env file (names only, never values)', helloBody?.env?.OAUTH_STATE_SECRET === true && helloBody?.env?.GOOGLE_CLIENT_ID === true && helloBody?.env?.ALLOW_FAKE_GOOGLE === true)
  const noAuth = await fetch(`${API}/functions/v1/google-oauth-start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  check('start without any JWT -> 401 from the gateway', noAuth.status === 401, `HTTP ${noAuth.status}`)
  const anonCall = await startOAuth(ANON)
  check('start with the anon key (a valid JWT but no user) -> 401 unauthenticated', anonCall.status === 401, `HTTP ${anonCall.status}`)
  const cb0 = await fetch(`${API}/functions/v1/google-oauth-callback`, { redirect: 'manual' })
  check('callback needs NO JWT (verify_jwt = false) and refuses a missing state', cb0.status === 302 && outcome(cb0.headers.get('location')).reason === 'invalid_state', `HTTP ${cb0.status}`)
  const sysAsPm = await startOAuth(tok, { system: true })
  check('a PM asking for the system sender -> 403', sysAsPm.status === 403, `HTTP ${sysAsPm.status}`)

  // connect
  const s = await startOAuth(tok, { returnTo: '/profile' })
  check('PM start -> 200 + consent URL on the fake Google', s.status === 200 && String(s.body?.url).startsWith(`${FAKE}/o/oauth2/v2/auth`), `HTTP ${s.status}`)
  check('consent URL: PKCE S256, offline access, state, the exact redirect URI, no client secret', (() => {
    const u = new URL(s.body.url)
    return u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('access_type') === 'offline' && !!u.searchParams.get('state')
      && u.searchParams.get('redirect_uri') === env.GOOGLE_REDIRECT_URI && !s.body.url.includes(env.GOOGLE_CLIENT_SECRET)
  })())
  const consent = await runConsent(s.body.url)
  const out = outcome(consent.final)
  check('consent -> callback -> redirect to the app with google=connected', consent.callbackStatus === 302 && consent.final.startsWith(`${APP_URL}/profile`) && out.google === 'connected', `google=${out.google} reason=${out.reason}`)
  const row = connRow(pm.id)
  check(`connection row: active, ${EXPECT} storage, e-mail = the PM, not the system row`, row[0] === 'active' && row[1] === EXPECT && row[2] === pm.email && row[3] === 'user', `${row[0]}/${row[1]}`)
  const scopes = sql(`select array_to_string(scopes, ' ') from app_private.google_connections where owner_user_id='${pm.id}'`)
  check('granted scopes include gmail.send and calendar.events', scopes.includes('gmail.send') && scopes.includes('calendar.events'))

  // where the token is, and that it is not readable
  const st = await fakeState()
  const rt = st?.refreshTokens?.find?.((x) => x.email === pm.email && !x.revoked)?.token || null
  check('the fake issued a refresh token (needed to prove where it is stored)', !!rt)
  const connId = sqlOne(`select id from app_private.google_connections where owner_user_id='${pm.id}'`)
  if (EXPECT === 'vault') {
    check('exactly one new Vault secret', vaultCount() === vault0 + 1, `${vault0} -> ${vaultCount()}`)
    const enc = sqlOne(`select secret from vault.secrets where id = (select vault_secret_id from app_private.google_connections where id='${connId}')`)
    const dec = sqlOne(`select decrypted_secret from vault.decrypted_secrets where id = (select vault_secret_id from app_private.google_connections where id='${connId}')`)
    check('Vault stores it ENCRYPTED (the raw refresh token is not in vault.secrets.secret)', !!enc && !!rt && !enc.includes(rt))
    check('decrypting it (superuser only) yields the real refresh token', !!rt && dec.includes(rt))
    check('no row in google_connection_secrets (the AES table is unused)', Number(sqlOne(`select count(*) from app_private.google_connection_secrets where connection_id='${connId}'`)) === 0)
  } else {
    check('no new Vault secret', vaultCount() === vault0, `${vault0} -> ${vaultCount()}`)
    const blob = sqlOne(`select ciphertext from app_private.google_connection_secrets where connection_id='${connId}'`)
    check('an AES ciphertext row exists and is NOT the raw refresh token', !!blob && !!rt && !blob.includes(rt) && blob.length >= 40, `length ${blob.length}`)
    check('the row has no vault_secret_id', sqlOne(`select vault_secret_id is null from app_private.google_connections where id='${connId}'`) === 't')
  }
  const probe = (p, opts = {}) => fetch(`${API}/rest/v1/${p}`, { ...opts, headers: H(tok, opts.headers) })
  const t1 = await probe('google_connections?select=*')
  check('PostgREST: there is no google_connections table for a PM', t1.status !== 200, `HTTP ${t1.status}`)
  const t2 = await probe('google_connections?select=*', { headers: { 'Accept-Profile': 'app_private' } })
  check('PostgREST: schema app_private is not exposed', [403, 404, 406].includes(t2.status), `HTTP ${t2.status}`)
  const t3 = await probe('secrets?select=*', { headers: { 'Accept-Profile': 'vault' } })
  check('PostgREST: schema vault is not exposed', [403, 404, 406].includes(t3.status), `HTTP ${t3.status}`)
  const t4 = await probe('rpc/google_secret_get', { method: 'POST', body: JSON.stringify({ p_connection: connId }) })
  const t4b = await t4.text()
  check('PostgREST: google_secret_get is refused for a PM and leaks nothing', t4.status >= 400 && !(rt && t4b.includes(rt)), `HTTP ${t4.status}`)
  const t5 = await fetch(`${API}/rest/v1/rpc/google_secret_get`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_connection: connId }) })
  check('PostgREST: google_secret_get is refused for anon', t5.status >= 400, `HTTP ${t5.status}`)
  const t6 = await probe('rpc/list_my_google_connections', { method: 'POST', body: '{}' })
  const t6b = await t6.text()
  const t6keys = [...keysOf(JSON.parse(t6b))]
  check('client RPC list_my_google_connections: metadata only (no token / secret / ciphertext / vault key)', t6.status === 200 && !t6keys.some((k) => /token|secret|cipher|vault/i.test(k) && k !== 'token_storage') && !(rt && t6b.includes(rt)), `keys: ${t6keys.join(',')}`)
  const t7 = await probe('rpc/get_google_connection_status', { method: 'POST', body: '{}' })
  const t7b = await t7.text()
  check('client RPC get_google_connection_status shows the connected e-mail and no secret', t7.status === 200 && t7b.includes(pm.email) && !(rt && t7b.includes(rt)), `HTTP ${t7.status}`)
  const priv = sql(`select concat_ws(',',
     has_table_privilege('authenticated','app_private.google_connections','select')::text, has_table_privilege('anon','app_private.google_connections','select')::text,
     has_table_privilege('authenticated','app_private.google_connection_secrets','select')::text, has_table_privilege('authenticated','vault.secrets','select')::text,
     has_table_privilege('authenticated','vault.decrypted_secrets','select')::text, has_table_privilege('anon','vault.decrypted_secrets','select')::text,
     has_function_privilege('authenticated','public.google_secret_get(uuid)','execute')::text, has_function_privilege('anon','public.google_secret_get(uuid)','execute')::text,
     has_function_privilege('service_role','public.google_secret_get(uuid)','execute')::text)`)
  check('privileges: only service_role can execute google_secret_get; no client role can select a token table', priv === 'false,false,false,false,false,false,false,false,true', priv)

  // replay / tamper / expired / never issued
  const replay = await fetch(consent.callbackUrl, { redirect: 'manual' })
  const ro = outcome(replay.headers.get('location'))
  check('replaying the used callback link is refused', ro.google === 'error' && /state_replayed|invalid_state/.test(ro.reason || ''), `reason=${ro.reason}`)
  const goodState = new URL(consent.callbackUrl).searchParams.get('state')
  const tUrl = new URL(consent.callbackUrl)
  tUrl.searchParams.set('state', goodState.slice(0, -3) + (goodState.endsWith('AAA') ? 'BBB' : 'AAA'))
  const tr = outcome((await fetch(tUrl, { redirect: 'manual' })).headers.get('location'))
  check('a tampered state is refused', tr.google === 'error' && tr.reason === 'invalid_state', `reason=${tr.reason}`)
  const n1 = newNonce()
  const c1 = await codeChallengeS256(await deriveCodeVerifier(STATE_SECRET, n1))
  const eUrl = new URL(consent.callbackUrl)
  eUrl.searchParams.set('state', await signState({ secret: STATE_SECRET, userId: pm.id, nonce: n1, challenge: c1, now: Date.now() - 11 * 60 * 1000 }))
  const er = outcome((await fetch(eUrl, { redirect: 'manual' })).headers.get('location'))
  check('an expired state (correctly signed, 11 minutes old) is refused', er.google === 'error' && er.reason === 'state_expired', `reason=${er.reason}`)
  const n2 = newNonce()
  const c2 = await codeChallengeS256(await deriveCodeVerifier(STATE_SECRET, n2))
  const uUrl = new URL(consent.callbackUrl)
  uUrl.searchParams.set('state', await signState({ secret: STATE_SECRET, userId: pm.id, nonce: n2, challenge: c2 }))
  const ur = outcome((await fetch(uUrl, { redirect: 'manual' })).headers.get('location'))
  check('a correctly signed state whose nonce was never issued is refused', ur.google === 'error', `reason=${ur.reason}`)

  // refusals on the second PM
  const connsBefore = Number(sqlOne('select count(*) from app_private.google_connections'))
  const vaultBefore = vaultCount()
  await nextAccount({ email: 'outsider.verify@gmail.com', hd: null })
  const o2 = outcome((await runConsent((await startOAuth(tok2)).body.url)).final)
  check('a non-athareg.com Google account (personal Gmail, no hosted domain) is rejected', o2.google === 'error' && o2.reason === 'wrong_domain', `reason=${o2.reason}`)
  await nextAccount({ email: `someone.else.${rid}@athareg.com`, hd: 'athareg.com' })
  const o3 = outcome((await runConsent((await startOAuth(tok2)).body.url)).final)
  check('another @athareg.com mailbox than the platform login is rejected (same_email policy)', o3.google === 'error' && o3.reason === 'email_mismatch', `reason=${o3.reason}`)
  await nextAccount({ deny: true })
  const o4 = outcome((await runConsent((await startOAuth(tok2)).body.url)).final)
  check('Cancel on the Google screen -> access_denied', o4.google === 'error' && o4.reason === 'access_denied', `reason=${o4.reason}`)
  check('the refusals stored nothing (no connection row, no Vault secret)', Number(sqlOne('select count(*) from app_private.google_connections')) === connsBefore && vaultCount() === vaultBefore)
  const revokes = ((await fakeState())?.calls ?? []).filter((c) => String(c.path || c.url || '').includes('/revoke')).length
  check('the refused grants were revoked at the (fake) Google', revokes >= 2, `revoke calls=${revokes}`)

  // disconnect
  const noAuthD = await fetch(`${API}/functions/v1/google-disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  check('disconnect without a JWT -> 401', noAuthD.status === 401, `HTTP ${noAuthD.status}`)
  const dr = await fetch(`${API}/functions/v1/google-disconnect`, { method: 'POST', headers: H(tok, { Origin: APP_ORIGIN }), body: '{}' })
  const db = await json(dr)
  check('disconnect -> ok, disconnected, revoked at Google', dr.status === 200 && db?.ok === true && db?.disconnected === true && db?.revoked_at_google === true, JSON.stringify(db))
  const after = connRow(pm.id)
  const gone = EXPECT === 'vault' ? vaultCount() === vault0 : Number(sqlOne(`select count(*) from app_private.google_connection_secrets where connection_id='${connId}'`)) === 0
  check('the row is revoked and the stored secret is deleted', after[0] === 'revoked' && gone, `${after[0]}`)
  const st2 = await fakeState()
  check('the fake Google shows the refresh token revoked', !!rt && st2?.refreshTokens?.find?.((x) => x.token === rt)?.revoked === true)
  const t8 = await probe('rpc/get_google_connection_status', { method: 'POST', body: '{}' })
  check('the status after disconnect is "not connected"', t8.status === 200 && !JSON.stringify(await json(t8)).includes('"active"'))
}

// ------------------------------------------------------------------------------------------------------------------------ the system sender
async function phaseSystem() {
  if (Number(sqlOne("select count(*) from app_private.google_connections where kind = 'system'")) > 0) {
    lines.push('SKIP  system sender phase: a system connection already exists (this script never touches it)')
    return
  }
  const vault0 = vaultCount()
  const admin = await createStaff(`edge-verify-admin-${rid}@athareg.com`, 'super_admin')
  const tok = await login(admin)
  await resetFake()
  await nextAccount({ email: `not.startups.${rid}@athareg.com`, hd: 'athareg.com' })
  const o1 = outcome((await runConsent((await startOAuth(tok, { system: true })).body.url)).final)
  check('[system] a super_admin linking the WRONG account is refused, target=system', o1.google === 'error' && o1.reason === 'wrong_system_account' && o1.target === 'system', `reason=${o1.reason}`)
  await nextAccount({ email: 'startups@athareg.com', hd: 'athareg.com' })
  const o2 = outcome((await runConsent((await startOAuth(tok, { system: true })).body.url)).final)
  check('[system] linking startups@athareg.com works', o2.google === 'connected' && o2.target === 'system', `google=${o2.google} reason=${o2.reason}`)
  created.systemCreated = true
  const sr = sql("select status||'|'||case when is_system then 'sys' else 'user' end||'|'||email||'|'||case when owner_user_id is null then 't' else 'f' end from app_private.google_connections where kind='system'")
  check('[system] one system row: active, no owner, startups@athareg.com', sr === 'active|sys|startups@athareg.com|t', sr)
  const adm = await fetch(`${API}/rest/v1/rpc/list_google_connections_admin`, { method: 'POST', headers: H(tok), body: '{}' })
  const admB = await adm.text()
  check('[system] the super_admin overview lists it without any secret', adm.status === 200 && admB.includes('startups@athareg.com') && !/refresh|ciphertext|vault_secret/i.test(admB), `HTTP ${adm.status}`)
  const d = await fetch(`${API}/functions/v1/google-disconnect`, { method: 'POST', headers: H(tok, { Origin: APP_ORIGIN }), body: JSON.stringify({ system: true }) })
  const db = await json(d)
  check('[system] the super_admin disconnects the system sender (revoked at Google)', d.status === 200 && db?.ok === true && db?.revoked_at_google === true, JSON.stringify(db))
  check('[system] Vault is back to its starting count', vaultCount() === vault0, `${vault0} -> ${vaultCount()}`)
}

// ------------------------------------------------------------------------------------------------------------------------ cleanup
async function cleanup() {
  // connection rows of the throwaway accounts (deleting a user already revoked the row and deleted its secret; the row stays, owner NULL)
  try {
    const mine = created.emails.map((e) => `'${e}'`).join(',')
    if (mine) {
      const ids = sql(`select id from app_private.google_connections where email::text in (${mine})`).split('\n').filter(Boolean)
      for (const id of ids) sql(`delete from vault.secrets where name = 'google-refresh-token:${id}'`)
      sql(`delete from app_private.google_connections where email::text in (${mine})`)
    }
    if (created.systemCreated) {
      const id = sqlOne("select id from app_private.google_connections where kind='system'")
      if (id) { sql(`delete from vault.secrets where name = 'google-refresh-token:${id}'`); sql(`delete from app_private.google_connections where id='${id}'`) }
    }
  } catch (e) { lines.push(`WARN  cleanup of connection rows: ${String(e.message).slice(0, 120)}`) }
  for (const id of created.userIds) {
    try {
      const r = await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })
      if (r.status >= 300) lines.push(`WARN  could not delete a throwaway user (HTTP ${r.status})`)
    } catch (e) { lines.push(`WARN  could not delete a throwaway user: ${String(e.message).slice(0, 80)}`) }
  }
  try {
    const mine = created.emails.map((e) => `'${e}'`).join(',')
    if (mine) {
      // the owner-deleted trigger left the rows with owner NULL: remove them and any Vault secret that is no longer referenced
      sql(`delete from app_private.google_connections where email::text in (${mine})`)
    }
  } catch { /* ignore */ }
}

try {
  await phasePm()
  await phaseSystem()
} catch (e) {
  check('script error', false, String(e?.message || e).slice(0, 300))
} finally {
  await cleanup()
}
const left = {
  users: Number(sqlOne("select count(*) from auth.users where email like 'edge-verify-%'")),
  connections: Number(sqlOne('select count(*) from app_private.google_connections')),
  vault: vaultCount(),
}
check('cleanup: no throwaway user left', left.users === 0, `users=${left.users}`)
console.log(lines.join('\n'))
console.log(`\nstorage mode expected: ${EXPECT}; connections left: ${left.connections}; vault secrets left: ${left.vault}`)
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
