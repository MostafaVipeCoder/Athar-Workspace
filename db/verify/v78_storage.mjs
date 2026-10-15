#!/usr/bin/env node
// v78_storage.mjs - the expert-photo storage rules of m78 through the REAL Storage API (Storage refuses a direct SQL DELETE on storage.objects, so the delete policy can only be
// proven end to end):  a project manager can add a photo only as image/webp, can remove one only when NO record still shows it, and cannot reach any other object of the bucket.
//
//   node db/verify/v78_storage.mjs         (reads the LOCAL url / anon key from web/.env.local; never prints a key, a token or a password)
//
// It COMMITS throwaway rows (a project_manager and a super_admin with a random password, two experts, a few objects under global/) and removes everything in a finally
// block. Exit code 0 = every check passed.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'

const DB = 'supabase_db_stack'
let pass = 0
let fail = 0
const lines = []
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`) }

const env = Object.fromEntries(readFileSync(new URL('../../web/.env.local', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const URL_BASE = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_BASE)) throw new Error('web/.env.local does not point at the local stack: refusing to run')

function psql(sql) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ out: out.trim(), err: err.trim(), code }))
    p.stdin.end(sql)
  })
}
const one = async (sql) => {
  const r = await psql(sql)
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.slice(0, 300)}`)
  return r.out
}

const PM = '00000000-0000-4000-8000-00000000d781'
const SA = '00000000-0000-4000-8000-00000000d780'
const EX = '00000000-0000-4000-8000-00000000d791'
const PW = randomBytes(18).toString('base64url')
const mail = (k) => `zz-v78s-${k}@example.invalid`
const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>1</script></svg>')
const ids = { a: randomUUID(), b: randomUUID(), svg: randomUUID() }
const photo = (k) => `global/expert-photo/${ids[k]}.webp`
const canary = `global/v78s/${randomUUID()}.webp`

async function login(email) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
  const j = await r.json()
  if (!j.access_token) throw new Error(`login failed (${r.status})`)
  return j.access_token
}
const put = (token, path, body, type) => fetch(`${URL_BASE}/storage/v1/object/public-assets/${path}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': type, 'x-upsert': 'false' }, body })
const remove = async (token, paths) => (await fetch(`${URL_BASE}/storage/v1/object/public-assets`, { method: 'DELETE', headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) })).json()
const exists = async (path) => (await one(`select count(*) from storage.objects where bucket_id = 'public-assets' and name = '${path}';`)) === '1'

async function cleanup(saToken) {
  // the objects go through the API (a direct SQL delete is refused); the rows are plain SQL
  if (saToken) await remove(saToken, [photo('a'), photo('a').replace('.webp', '_t.webp'), photo('svg'), canary]).catch(() => {})
  await one(`delete from public.network_experts where id = '${EX}'; delete from public.user_roles where user_id in ('${PM}', '${SA}'); delete from auth.identities where user_id in ('${PM}', '${SA}'); delete from auth.users where id in ('${PM}', '${SA}');`)
}

let saToken = null
try {
  await one(`
    delete from public.user_roles where user_id in ('${PM}', '${SA}'); delete from auth.identities where user_id in ('${PM}', '${SA}'); delete from auth.users where id in ('${PM}', '${SA}');
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
      select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, extensions.crypt('${PW}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"],"provisioned":true}', '{"full_name":"V78S"}', now(), now(), '', '', '', ''
        from (values ('${PM}'::uuid, '${mail('pm')}'), ('${SA}'::uuid, '${mail('sa')}')) u(id, email);
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email), now(), now(), now() from (values ('${PM}'::uuid, '${mail('pm')}'), ('${SA}'::uuid, '${mail('sa')}')) u(id, email);
    insert into public.user_roles (user_id, role_key) values ('${PM}', 'project_manager'), ('${SA}', 'super_admin');
    insert into public.network_experts (id, kind, name_en) values ('${EX}', 'expert', 'V78S Photo Person');`)
  const pm = await login(mail('pm'))
  saToken = await login(mail('sa'))

  // 1. add
  let r = await put(pm, photo('a'), webp, 'image/webp')
  check('1 a project manager stores a photo as image/webp under global/expert-photo/', r.ok, String(r.status))
  r = await put(pm, photo('a').replace('.webp', '_t.webp'), webp, 'image/webp')
  check('1b ... and its thumbnail', r.ok, String(r.status))
  r = await put(pm, photo('svg'), svg, 'image/svg+xml')
  check('2 an SVG is refused under the registry folder (it was served as active content before m78)', !r.ok, String(r.status))
  check('2b ... nothing was stored', !(await exists(photo('svg'))))

  // 2. remove: a photo a record still shows stays
  await one(`update public.network_experts set photo_path = '${photo('a')}' where id = '${EX}';`)
  await remove(pm, [photo('a'), photo('a').replace('.webp', '_t.webp')])
  check('3 the project manager cannot remove the photo (nor the thumbnail) of a record that shows it', (await exists(photo('a'))) && (await exists(photo('a').replace('.webp', '_t.webp'))))
  // 3. once nothing shows it, it can go (full + thumbnail)
  await one(`update public.network_experts set photo_path = null where id = '${EX}';`)
  await remove(pm, [photo('a'), photo('a').replace('.webp', '_t.webp')])
  check('4 ... and once the record no longer shows it, the project manager removes both files', !(await exists(photo('a'))) && !(await exists(photo('a').replace('.webp', '_t.webp'))))
  // 4. nothing else of the bucket is reachable
  r = await put(saToken, canary, webp, 'image/webp')
  check('5a (setup) the super_admin stores an object elsewhere under global/', r.ok, String(r.status))
  await remove(pm, [canary])
  check('5 the project manager cannot remove an object outside the registry folder (the confused-deputy canary survives)', await exists(canary))
  r = await put(pm, canary.replace('v78s', 'v78s2'), webp, 'image/webp')
  check('6 nor can he add one there', !r.ok, String(r.status))
} catch (err) {
  check('the run itself', false, String(err.message ?? err).slice(0, 200))
} finally {
  try { await cleanup(saToken) } catch (err) { check('cleanup', false, String(err.message ?? err).slice(0, 200)) }
}
console.log(lines.join('\n'))
console.log(`\nv78 storage: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
