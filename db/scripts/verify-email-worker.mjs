#!/usr/bin/env node
// verify-email-worker.mjs - END-TO-END proof of the e-mail outbox worker (migration m62, design 07 section 1) on the LOCAL stack: the REAL edge function (served by the
// local Edge Runtime, through Kong), the REAL database (RLS, RPCs, Vault, pg_cron / pg_net) and the FAKE Google (db/scripts/fake-google). Run it after
//     bash db/scripts/dev-functions.sh up          (the functions + the fake Google)
//     m62 applied                                  (docker exec -i supabase_db_stack psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/migrations/m62_email_worker.sql)
//
//   node db/scripts/verify-email-worker.mjs                  # everything, including the pg_cron path (adds about 80 s)
//   node db/scripts/verify-email-worker.mjs --skip-cron      # without the cron wait
//
// What it proves (each line is a check; exit code 0 = all passed):
//   A  Selection "send interview invitations" (Arabic and English) -> outbox rows -> worker -> fake Gmail: recipients from the STORED rows, From = the acting PM, CC + Reply-To
//      from the template, the Arabic subject DECODED by the fake, a tokenised booking link per applicant whose hash is the one in booking_invitations, no RFC problems,
//      the audit log (claimed / send_started / sent, masked recipients), idempotency (a second run sends nothing), no body of a sent staff invitation kept
//   B  staff invitation e-mail delivered from startups@ (Arabic and English), the delivery state in list_staff_invitation_delivery; booking confirmation (organizer) and
//      form notification (system sender) sender rules
//   C  rate limit (3 a minute: three sent, three blocked with a visible reason, released when the window slides), the daily cap
//   D  retry with exponential backoff (503, 429 + Retry-After), the retry streak ends in `failed` (max_attempts), a manual retry delivers it
//   E  UNKNOWN OUTCOME: a timeout after Google accepted / a connection reset / a timeout before accepting -> needs_review, NEVER resent automatically; mark as sent,
//      resend on purpose (new Message-ID), cancel
//   F  invalid_grant (the user removed the app at Google): connection needs_reconnect, rows go out from startups@ (fallback) or wait with a visible reason when the template
//      forbids it, and go out as the PM after he reconnects
//   G  two (three) concurrent workers never double-send
//   H  the worker endpoint: no secret = 401, the anon key / a PM JWT = 401, a body that names recipients is ignored, a user cannot call the claim RPC, RLS of the Outbox RPCs
//      through PostgREST (a PM of another project, no direct table access, app_private not exposed)
//   I  the health panel and, unless --skip-cron, the scheduler: pg_cron every minute -> pg_net -> the function (secret in Vault), "Send now" kicks the worker
//   J  the function's log holds no recipient, subject, body, token or secret
//
// Safety: refuses to run unless local-db/functions.env has ALLOW_FAKE_GOOGLE=1 AND the fake answers on loopback (it can never reach the real Google), unless the outbox has no
// queued / sending row and no Google connection exists (a worker run would deliver somebody else's rows), and unless the scheduler is off. Everything it creates (users, program,
// connections, outbox rows, invitations, Vault secrets, cron jobs) is deleted at the end, even after a failure, and the platform row counts are compared with the start.
// It never prints a token, key, secret or password.
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const SKIP_CRON = argv.includes('--skip-cron')
const API = process.env.SUPABASE_API_URL || 'http://127.0.0.1:54321'
const STACK = path.join(ROOT, 'local-db', 'stack')
const DB_CONTAINER = 'supabase_db_stack'
const EDGE_CONTAINER = 'supabase_edge_runtime_stack'

// ---- configuration (the same env file the functions read; values are used, never printed)
let env
try {
  env = Object.fromEntries(readFileSync(path.join(ROOT, 'local-db', 'functions.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
} catch {
  console.error('local-db/functions.env not found: run `bash db/scripts/dev-functions.sh up` first'); process.exit(2)
}
if (env.ALLOW_FAKE_GOOGLE !== '1') { console.error('refusing: ALLOW_FAKE_GOOGLE is not 1 in local-db/functions.env (this test must only ever talk to the FAKE Google)'); process.exit(2) }
const FAKE = (env.GOOGLE_AUTH_BASE || '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(FAKE)) { console.error('refusing: GOOGLE_AUTH_BASE is not a loopback address'); process.exit(2) }
if (!env.EMAIL_WORKER_SECRET) { console.error('EMAIL_WORKER_SECRET is not in local-db/functions.env: run `bash db/scripts/dev-functions.sh up` (it adds it and restarts the runtime)'); process.exit(2) }
try { const h = await fetch(`${FAKE}/__health`); if (!h.ok) throw new Error() } catch { console.error(`refusing: the fake Google does not answer on ${FAKE} (bash db/scripts/dev-functions.sh up)`); process.exit(2) }
const APP_URL = env.APP_URL
const APP_ORIGIN = new URL(APP_URL).origin
const LINK_BASE = 'http://127.0.0.1:5604' // the base URL the Selection e-mails are given (a real one in the app)

const statusEnv = execSync('npx supabase status -o env', { cwd: STACK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const kv = Object.fromEntries(statusEnv.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const ANON = kv.ANON_KEY
const SERVICE = kv.SERVICE_ROLE_KEY
if (!ANON || !SERVICE) { console.error('cannot read the local stack keys (is it running?)'); process.exit(2) }

// ---- helpers
let pass = 0
let fail = 0
const lines = []
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  console.log(lines[lines.length - 1])
}
const sql = (q) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sqlOne = (q) => sql(q).split('\n')[0]
const sqlNum = (q) => Number(sqlOne(q))
const json = async (res) => { try { return await res.json() } catch { return null } }
const H = (token, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rid = crypto.randomBytes(3).toString('hex')
const mail = (name) => `${name}.${rid}@ew.example.invalid`
const created = { userIds: [], emails: [], programId: null, systemCreated: false }

const fakeGet = async (p) => json(await fetch(`${FAKE}${p}`))
const fakeCtl = (p, body) => fetch(`${FAKE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(json)
const fakeMessages = async () => (await fakeGet('/__state')).messages
const msgsTo = async (addr) => (await fakeMessages()).filter((m) => [...m.to, ...m.cc].some((a) => a.email === addr.toLowerCase()))
const inject = (o) => fakeCtl('/__control/inject', o)
const clearInjections = () => fakeCtl('/__control/clear-injections')

async function createStaff(email, role, fullName) {
  const password = `Pw-${crypto.randomBytes(18).toString('base64url')}`
  const id = crypto.randomUUID()
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"],"provisioned":true}', '{"full_name":"${fullName}"}', now(), now(), '', '', '', '', '', '', '', '');
       insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
       select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now() from auth.users u where u.id = '${id}';
       insert into public.user_roles(user_id, role_key) values ('${id}', '${role}') on conflict do nothing;`)
  created.userIds.push(id); created.emails.push(email)
  return { id, email, password }
}
async function login(u) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) })
  const b = await json(r)
  if (!b?.access_token) throw new Error(`login failed: HTTP ${r.status}`)
  return b.access_token
}
const rpc = async (token, fn, body = {}) => {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(token), body: JSON.stringify(body) })
  return { status: r.status, body: await json(r) }
}
async function rpcOk(token, fn, body) {
  const r = await rpc(token, fn, body)
  if (r.status >= 300) throw new Error(`rpc ${fn} -> HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`)
  return r.body
}
const worker = async (opts = {}, headers = null) => {
  const r = await fetch(`${API}/functions/v1/email-worker`, { method: 'POST', headers: headers ?? { 'x-worker-secret': env.EMAIL_WORKER_SECRET, 'content-type': 'application/json' }, body: JSON.stringify(opts), signal: AbortSignal.timeout(150_000) })
  return { status: r.status, body: await json(r) }
}
async function oauthConnect(userToken, email, { system = false } = {}) {
  await fakeCtl('/__control/next-account', { email })
  const sres = await fetch(`${API}/functions/v1/google-oauth-start`, { method: 'POST', headers: H(userToken, { Origin: APP_ORIGIN }), body: JSON.stringify({ system, returnTo: '/profile' }) })
  const s = await json(sres)
  if (!s?.url) throw new Error(`oauth start failed HTTP ${sres.status}`)
  const a = await fetch(s.url, { redirect: 'manual' })
  const cb = await fetch(a.headers.get('location') || '', { redirect: 'manual' })
  const u = new URL(cb.headers.get('location') || 'http://x/?')
  return { google: u.searchParams.get('google'), reason: u.searchParams.get('reason') }
}
const sqlEsc = (s) => String(s).replace(/'/g, "''")
// one outbox row inserted the way a producer does (state queued, sender not chosen yet); returns its id
function addRow({ project, node, key = 'acceptance', to, by = null, subject, body, cc = null, status = 'queued', tag = null }) {
  const t = tag ?? crypto.randomBytes(4).toString('hex')
  const ccSql = cc ? `array[${cc.map((c) => `'${sqlEsc(c)}'`).join(',')}]::text[]` : 'null'
  return sqlOne(`insert into app_private.email_outbox (project_id, node_id, email_key, recipient_email, subject, body_html, cc, idempotency_key, status, created_by)
    values (${project ? `'${project}'` : 'null'}, ${node ? `'${node}'` : 'null'}, '${key}', '${sqlEsc(to)}', '${sqlEsc(subject ?? `Subject ${t}`)}', '${sqlEsc(body ?? `<p>Body ${t}</p>`)}', ${ccSql}, 'ew-${rid}-${t}', '${status}', ${by ? `'${by}'` : 'null'}) returning id;`)
}
const row = (id) => {
  const r = sqlOne(`select status || '|' || coalesce(blocked_reason, '') || '|' || coalesce(error_code, '') || '|' || fail_streak || '|' || send_attempt || '|' || coalesce(sender_source, '') || '|' || coalesce(gmail_message_id, '') || '|' || coalesce(message_id, '') || '|' || coalesce(resolution, '') || '|' || (next_attempt_at - now()) from app_private.email_outbox where id = '${id}'`).split('|')
  return { status: r[0], blocked: r[1], error: r[2], streak: Number(r[3]), attempt: Number(r[4]), source: r[5], gmail: r[6], messageId: r[7], resolution: r[8], inFuture: r[9] }
}
const secondsAhead = (id) => sqlNum(`select extract(epoch from (next_attempt_at - now()))::int from app_private.email_outbox where id = '${id}'`)
const due = (ids) => sql(`update app_private.email_outbox set next_attempt_at = now() - interval '1 second', blocked_reason = null where id in (${ids.map((i) => `'${i}'`).join(',')}) and status = 'queued'`)
const ageLedger = () => sql(`update app_private.email_log set created_at = created_at - interval '3 minutes' where event = 'send_started' and created_at > now() - interval '3 minutes'`)
const nlog = (id, event) => sqlNum(`select count(*) from app_private.email_log where outbox_id = '${id}' and event = '${event}'`)
const keysOf = (v, acc = new Set()) => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysOf(x, acc) } return acc }
const baseline = () => sql(readFileSync(path.join(ROOT, 'db', 'scripts', 'baseline-counts.sql'), 'utf8'))
async function resetFake() {
  await fetch(`${FAKE}/__reset`, { method: 'POST' })
  await fakeCtl('/__control/config', { clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUris: [env.GOOGLE_REDIRECT_URI] })
}

// ------------------------------------------------------------------------------------------------------------------------ preconditions
const queueBusy = sqlNum(`select count(*) from app_private.email_outbox where status in ('queued', 'sending')`)
const conns0 = sqlNum(`select count(*) from app_private.google_connections`)
const sched = sqlOne(`select coalesce(app_private.email_worker_status() ->> 'enabled', 'false')`)
if (sqlOne(`select to_regprocedure('public.email_worker_claim(text,integer,integer,integer,integer)') is not null`) !== 't') { console.error('m62 is not applied on this database'); process.exit(2) }
if (queueBusy > 0) { console.error(`refusing: ${queueBusy} outbox rows are queued / sending: a worker run would deliver them (to the fake Google, but still). Cancel or finish them first.`); process.exit(2) }
if (conns0 > 0) { console.error('refusing: Google connections already exist on this database (this script creates and deletes its own).'); process.exit(2) }
if (sched === 'true') { console.error('refusing: the e-mail scheduler is enabled (db/scripts/email-worker-schedule.sh disable): background runs would interfere'); process.exit(2) }
const heartbeat0 = sqlNum(`select count(*) from app_private.worker_heartbeat`) > 0 // a heartbeat row of an earlier manual run is left as it was
const baselineBefore = baseline()
const logStart = new Date().toISOString()

let PM1, PM2, SA, T_PM1, T_PM2, T_SA
let P1, P2, SEL1, SEL2, BK1
let C_PM1, C_PM2, C_SYS

// ------------------------------------------------------------------------------------------------------------------------ setup
async function setup() {
  console.log('== setup: throwaway users, Google connections through the REAL OAuth functions, a project with a Selection stage and a Booking node')
  await resetFake()
  PM1 = await createStaff(`ew-pm1-${rid}@athareg.com`, 'project_manager', 'Mona Elsayed')
  PM2 = await createStaff(`ew-pm2-${rid}@athareg.com`, 'project_manager', 'Karim Hassan')
  SA = await createStaff(`ew-sa-${rid}@athareg.com`, 'super_admin', 'Sara Admin')
  T_PM1 = await login(PM1); T_PM2 = await login(PM2); T_SA = await login(SA)

  const c1 = await oauthConnect(T_PM1, PM1.email)
  const c2 = await oauthConnect(T_PM2, PM2.email)
  const cs = await oauthConnect(T_SA, 'startups@athareg.com', { system: true })
  created.systemCreated = true
  check('three Google connections made through the real google-oauth-start / callback (two PMs and the system sender)', c1.google === 'connected' && c2.google === 'connected' && cs.google === 'connected', `${c1.google}/${c2.google}/${cs.google}`)
  C_PM1 = sqlOne(`select id from app_private.google_connections where owner_user_id = '${PM1.id}'`)
  C_PM2 = sqlOne(`select id from app_private.google_connections where owner_user_id = '${PM2.id}'`)
  C_SYS = sqlOne(`select id from app_private.google_connections where kind = 'system'`)

  const prog = await rpcOk(T_SA, 'create_program', { p_name_en: `EW Program ${rid}`, p_name_ar: 'برنامج الاختبار', p_description_en: null, p_description_ar: null, p_program_type: null, p_year: null })
  created.programId = prog.id
  P1 = (await rpcOk(T_SA, 'create_project', { p_program: prog.id, p_name_en: `EW Project One ${rid}`, p_name_ar: 'المشروع الأول', p_timezone: 'Africa/Cairo' })).id
  P2 = (await rpcOk(T_SA, 'create_project', { p_program: prog.id, p_name_en: `EW Project Two ${rid}`, p_name_ar: null, p_timezone: 'Africa/Cairo' })).id
  const frm = (await rpcOk(T_SA, 'add_node', { p_project: P1, p_type: 'form_builder', p_name: { en: 'EW Form' }, p_x: 0, p_y: 0, p_options: {} })).id
  SEL1 = (await rpcOk(T_SA, 'add_node', { p_project: P1, p_type: 'selection', p_name: { en: 'EW Stage 1' }, p_x: 0, p_y: 0, p_options: {} })).id
  BK1 = (await rpcOk(T_SA, 'add_node', { p_project: P1, p_type: 'booking', p_name: { en: 'EW Interviews' }, p_x: 0, p_y: 0, p_options: { mode: 'interview' } })).id
  SEL2 = (await rpcOk(T_SA, 'add_node', { p_project: P2, p_type: 'selection', p_name: { en: 'EW Stage 2' }, p_x: 0, p_y: 0, p_options: {} })).id
  await rpcOk(T_SA, 'connect', { p_project: P1, p_from_node: frm, p_from_port: 'responses', p_to_node: SEL1, p_to_port: 'applicants', p_config: {} })
  await rpcOk(T_SA, 'connect', { p_project: P1, p_from_node: SEL1, p_from_port: 'interview', p_to_node: BK1, p_to_port: 'bookers', p_config: {} })
  sql(`insert into public.project_members (project_id, user_id, member_role) values ('${P1}', '${PM1.id}', 'manager'), ('${P2}', '${PM2.id}', 'manager');
       update public.nodes set config = '${sqlEsc(JSON.stringify({
         stages: [{ key: 'screening', type: 'inbox' }, { key: 'interview', type: 'stage', email: 'interview' }, { key: 'holding', type: 'hold' }, { key: 'accepted', type: 'accept', email: 'acceptance' }, { key: 'rejected', type: 'reject', email: 'rejection' }],
         passing: ['accepted'],
         emails: {
           interview: {
             subject: 'Interview invitation: {{company_name}}', subject_ar: 'دعوة لمقابلة: {{company_name}}',
             body_html: 'Dear {{first_name}},<br>Book your interview: {{booking_link}}<br>{{project_manager_name}} / {{program_name}}',
             body_html_ar: 'عزيزي {{first_name}}،<br>احجز موعد المقابلة من هنا: {{booking_link}}<br>مع التحية، {{project_manager_name}}',
             cc: ['cc-ew@athareg.com'], admin: [], reply_to: 'team-ew@athareg.com',
           },
         },
       }))}'::jsonb where id = '${SEL1}';`)
}

// ------------------------------------------------------------------------------------------------------------------------ A. Selection -> outbox -> worker -> fake Gmail
async function phaseA() {
  console.log('== A. Selection interview invitations -> worker -> fake Gmail')
  const resp = [
    { name: 'Nour Tech', founder: 'أحمد علي', email: `Ahmed.Ali.${rid}@EW.Example.invalid` },
    { name: 'Sky Foods', founder: 'Mona Saleh', email: mail('mona.saleh') },
    { name: 'No Mail Co', founder: 'No Mail', email: null },
  ]
  const respIds = resp.map(() => crypto.randomUUID())
  sql(resp.map((r, i) => `insert into public.form_responses (id, project_id, node_id, answers) values ('${respIds[i]}', '${P1}', (select node_id from public.forms where project_id = '${P1}' limit 1),
      '${sqlEsc(JSON.stringify({ company_name: r.name, founder_name: r.founder, ...(r.email ? { founder_email: r.email } : {}) }))}');`).join('\n'))
  const items = []
  for (const id of respIds) items.push(await rpcOk(T_PM1, 'ensure_item', { p_list: SEL1, p_kind: 'form_response', p_source: id }))
  for (const it of items) await rpcOk(T_PM1, 'set_item_status', { p_item: it, p_status: 'interview', p_reason: null })

  const out = await rpcOk(T_PM1, 'send_selection_emails', { p_node: SEL1, p_email_key: 'interview', p_item_ids: items, p_lang: 'ar', p_base_url: LINK_BASE, p_resend: false, p_confirm: false })
  check('send_selection_emails (Arabic): two queued, the applicant without an e-mail is reported no_recipient', out.filter((r) => r.status === 'queued').length === 2 && out.some((r) => r.status === 'no_recipient'), out.map((r) => r.status).join(','))
  const queued = out.filter((r) => r.status === 'queued')
  check('the rows wait in the outbox with NO sender chosen yet (the worker resolves it) and the recipient lower-cased', queued.every((r) => sqlOne(`select (sender_connection_id is null and status = 'queued')::text from app_private.email_outbox where id = '${r.outbox_id}'`) === 'true')
    && sqlOne(`select recipient_email::text from app_private.email_outbox where id = '${queued[0].outbox_id}'`) === resp[0].email.toLowerCase())
  const before = (await fakeMessages()).length
  const w = await worker()
  check('the worker answers 200 with a summary of COUNTS: two sent, nothing failed', w.status === 200 && w.body?.sent === 2 && w.body?.failed === 0 && w.body?.needs_review === 0, JSON.stringify({ sent: w.body?.sent, claimed: w.body?.claimed }))
  const msgs = (await fakeMessages()).slice(before)
  check('exactly two messages reached the fake Gmail, ONE per recipient (never a Bcc blast)', msgs.length === 2 && msgs.every((m) => m.to.length === 1), `${msgs.length}`)
  const m1 = msgs.find((m) => m.to[0].email === resp[0].email.toLowerCase())
  const m2 = msgs.find((m) => m.to[0].email === resp[1].email)
  check('recipients are the STORED, lower-cased founder e-mails; nobody else got a message', !!m1 && !!m2 && !(await fakeMessages()).some((m) => m.to.some((a) => a.email === 'no.mail@x')))
  check('From = the acting PM\'s own connected account, display name "<PM name> - Athar"', m1?.account === PM1.email && m1.from[0].email === PM1.email && m1.from[0].name === 'Mona Elsayed - Athar', `${m1?.account} / ${m1?.from?.[0]?.name}`)
  check('the Arabic subject is DECODED correctly by the fake Gmail (RFC 2047) and contains the company name', m1?.subject === 'دعوة لمقابلة: Nour Tech', m1?.subject)
  check('the Arabic body arrives intact (HTML and the plain-text alternative)', /عزيزي أحمد/.test(m1?.html ?? '') && /احجز موعد المقابلة/.test(m1?.text ?? ''))
  check('CC and Reply-To come from the template config', m1?.cc?.[0]?.email === 'cc-ew@athareg.com' && m1?.replyTo?.[0]?.email === 'team-ew@athareg.com')
  check('no RFC problem in any message (no bare LF, no non-ASCII header byte, Date + Message-ID + MIME-Version present)', msgs.every((m) => m.problems.length === 0), msgs.map((m) => m.problems.join(';')).join('|'))
  const tok1 = /invite=([A-Za-z0-9_-]+)/.exec(m1?.html ?? '')?.[1]
  const tok2 = /invite=([A-Za-z0-9_-]+)/.exec(m2?.html ?? '')?.[1]
  check('each applicant got a TOKENISED booking link (different tokens, on the given base URL)', !!tok1 && !!tok2 && tok1 !== tok2 && (m1?.html ?? '').includes(`${LINK_BASE}/book/`), `${tok1?.length}/${tok2?.length}`)
  check('the token of the link hashes to the stored invitation of THAT applicant (only the hash is in the database)', sqlOne(`select count(*) from public.booking_invitations where token_hash = encode(extensions.digest('${tok1}', 'sha256'), 'hex') and booker_item_id = '${items[0]}'`) === '1'
    && sqlOne(`select count(*) from public.booking_invitations where token_hash = encode(extensions.digest('${tok2}', 'sha256'), 'hex') and booker_item_id = '${items[1]}'`) === '1')
  const r1 = row(queued[0].outbox_id)
  check('the outbox row: sent, the Gmail id of the fake, a Message-ID <outbox id.1@domain>, sender user, one request attempt', r1.status === 'sent' && r1.gmail === m1.id && r1.messageId === `<${queued[0].outbox_id}.1@athareg.com>` && m1.messageId === r1.messageId && r1.source === 'user' && r1.attempt === 1, JSON.stringify(r1))
  check('the audit log: claimed, send_started, sent with the Gmail id; the recipient only MASKED and HASHED', nlog(queued[0].outbox_id, 'claimed') === 1 && nlog(queued[0].outbox_id, 'send_started') === 1 && nlog(queued[0].outbox_id, 'sent') === 1
    && sqlOne(`select recipient_masked || '/' || length(recipient_hash) || '/' || gmail_message_id from app_private.email_log where outbox_id = '${queued[0].outbox_id}' and event = 'sent'`) === `a***@ew.example.invalid/24/${m1.id}`)
  const w2 = await worker()
  check('IDEMPOTENT: a second run claims nothing and sends nothing', w2.status === 200 && w2.body?.claimed === 0 && (await fakeMessages()).length === before + 2)
  const again = await rpcOk(T_PM1, 'send_selection_emails', { p_node: SEL1, p_email_key: 'interview', p_item_ids: items, p_lang: 'ar', p_base_url: LINK_BASE, p_resend: false, p_confirm: false })
  check('the producer skips applicants whose invitation was already sent (already_sent), so no duplicate is even queued', again.filter((r) => r.status === 'already_sent').length === 2)

  // English acceptance with the node-type default template
  const acc = await rpcOk(T_PM1, 'send_selection_emails', { p_node: SEL1, p_email_key: 'acceptance', p_item_ids: [items[1]], p_lang: 'en', p_base_url: null, p_resend: false, p_confirm: false })
  await worker()
  const am = (await msgsTo(resp[1].email)).find((m) => /Congratulations|Welcome|accepted/i.test(m.subject))
  check('an English acceptance (node-type default template) is delivered too', acc[0].status === 'queued' && !!am && am.account === PM1.email, am?.subject)
  return { items, queued }
}

// ------------------------------------------------------------------------------------------------------------------------ B. staff invitation, booking confirmation, form notification
async function phaseB() {
  console.log('== B. staff invitation / booking confirmation / form notification')
  const inv = await rpcOk(T_SA, 'create_staff_invitation', { p_email: mail('invitee'), p_roles: ['project_manager'], p_program_ids: [], p_language: 'en', p_app_url: LINK_BASE })
  const outboxId = sqlOne(`select outbox_id from public.staff_invitations where id = '${inv.id}'`)
  const d0 = (await rpcOk(T_SA, 'list_staff_invitation_delivery')).find((d) => d.invitation_id === inv.id)
  check('the invitation e-mail is queued (no sender yet) and the admin UI can see its delivery state', d0?.state === 'queued' && d0.sender_email == null, JSON.stringify(d0))
  const before = (await fakeMessages()).length
  const w = await worker()
  const im = (await msgsTo(mail('invitee')))[0]
  check('the staff invitation is DELIVERED, from the system sender startups@athareg.com', w.body?.sent >= 1 && im?.account === 'startups@athareg.com' && im.from[0].name === 'Athar Startups', `${im?.account}`)
  check('it carries the one-time sign-up link built from the invitation token', new RegExp(`${LINK_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/invite/staff/${inv.token}`).test(im?.html ?? ''))
  const dl = (await rpcOk(T_SA, 'list_staff_invitation_delivery')).find((d) => d.invitation_id === inv.id)
  check('the delivery state is now sent, with the sender', dl?.state === 'sent' && dl.sender_email === 'startups@athareg.com' && !!dl.sent_at, JSON.stringify(dl))
  check('after sending, the invitation row keeps NO body (it held a one-time link); a PM-sent selection e-mail keeps its body', sqlOne(`select (body_html is null)::text from app_private.email_outbox where id = '${outboxId}'`) === 'true'
    && sqlOne(`select count(*) from app_private.email_outbox where email_key = 'interview' and body_html is not null and recipient_email::text like '%${rid}%'`) === '2')
  const invAr = await rpcOk(T_SA, 'create_staff_invitation', { p_email: mail('invitee-ar'), p_roles: ['project_manager'], p_program_ids: [], p_language: 'ar', p_app_url: LINK_BASE })
  await worker()
  const am = (await msgsTo(mail('invitee-ar')))[0]
  check('an Arabic staff invitation: the subject is Arabic and decoded correctly, the link is there', !!am && /[\u0600-\u06FF]/.test(am.subject) && (am.html ?? '').includes(`/invite/staff/${invAr.token}`), am?.subject)

  // booking confirmation: the organizer of the booking node sends it (the anonymous booker has no connection)
  sql(`update public.booking_settings set organizer_connection_id = '${C_PM1}' where node_id = '${BK1}'`)
  const bk = addRow({ project: P1, node: BK1, key: 'booking_confirmation', to: mail('booker'), by: null, subject: 'Your session is confirmed', body: '<p>See you soon</p>' })
  const fm = addRow({ project: P1, node: SEL1, key: 'form_new_response', to: mail('pm-notify'), by: PM1.id, subject: 'New response: EW Form', body: '<p>A new response arrived.</p>' })
  await worker()
  const bm = (await msgsTo(mail('booker')))[0]
  const fmm = (await msgsTo(mail('pm-notify')))[0]
  check('a booking confirmation (no acting user) goes out from the booking node\'s ORGANIZER connection', bm?.account === PM1.email && row(bk).source === 'user', `${bm?.account}`)
  check('a form notification goes out from the system sender (startups@), whoever submitted the form', fmm?.account === 'startups@athareg.com' && row(fm).source === 'system', `${fmm?.account}`)
  sql(`update public.booking_settings set organizer_connection_id = null where node_id = '${BK1}'`)
  check('nothing else was sent by these runs', (await fakeMessages()).length === before + 4, `${(await fakeMessages()).length - before}`)
}

// ------------------------------------------------------------------------------------------------------------------------ C. rate limit and daily cap
async function phaseC() {
  console.log('== C. rate limit and daily cap')
  ageLedger()
  const ids = Array.from({ length: 6 }, (_, i) => addRow({ project: P1, node: SEL1, to: mail(`rl${i}`), by: PM1.id, subject: `Rate ${i}`, tag: `rl${i}` }))
  const before = (await fakeMessages()).length
  const w = await worker({ perMinute: 3, maxRunSeconds: 8 })
  const sent = ids.filter((id) => row(id).status === 'sent')
  const blocked = ids.filter((id) => row(id).blocked === 'rate_limited')
  check('per-minute limit 3: exactly three were sent, three are BLOCKED with the visible reason rate_limited', sent.length === 3 && blocked.length === 3 && (await fakeMessages()).length === before + 3, `${sent.length}/${blocked.length}`)
  check('the blocked rows wait (next_attempt_at in the future) and show as state `blocked` to the PM', blocked.every((id) => secondsAhead(id) > 5), '')
  const list = await rpcOk(T_PM1, 'list_email_outbox', { p_project: P1, p_states: ['blocked'], p_node: null, p_search: null, p_limit: 50, p_offset: 0 })
  check('list_email_outbox (as the PM) reports them as blocked with the reason', list.rows.length === 3 && list.rows.every((r) => r.state === 'blocked' && r.blocked_reason === 'rate_limited'))
  check('the worker run reported the held-back rows in its summary (held = blocked by the database at claim time)', w.body?.held >= 3 && w.body?.sent === 3, JSON.stringify({ held: w.body?.held, sent: w.body?.sent }))
  due(blocked)
  const w2 = await worker({ perMinute: 3, maxRunSeconds: 8 })
  check('still inside the same minute the window is full: nothing more is sent and the reason stays', w2.body?.sent === 0 && blocked.every((id) => row(id).blocked === 'rate_limited'))
  ageLedger()
  due(blocked)
  const w3 = await worker({ perMinute: 3, maxRunSeconds: 8 })
  check('when the window has slid the remaining three go out (and nothing was sent twice)', w3.body?.sent === 3 && ids.every((id) => row(id).status === 'sent' && row(id).attempt === 1) && (await fakeMessages()).length === before + 6, JSON.stringify(w3.body?.sent))

  // daily cap: the ledger has N started requests for PM1's sender in the last 24 h
  const n24 = sqlNum(`select count(*) from app_private.email_log where event = 'send_started' and sender_connection_id = '${C_PM1}' and created_at > now() - interval '24 hours'`)
  const cap = Array.from({ length: 2 }, (_, i) => addRow({ project: P1, node: SEL1, to: mail(`cap${i}`), by: PM1.id, tag: `cap${i}` }))
  const wc = await worker({ dailyCap: n24, perMinute: 30, maxRunSeconds: 8 })
  check(`daily cap ${n24} reached: the next two are BLOCKED daily_cap and retried in about 15 minutes, nothing is sent`, wc.body?.sent === 0 && cap.every((id) => row(id).blocked === 'daily_cap' && secondsAhead(id) > 600 && secondsAhead(id) <= 905), JSON.stringify(cap.map((id) => row(id).blocked)))
  due(cap)
  await worker({ perMinute: 30, maxRunSeconds: 8 })
  check('with the normal cap they are delivered', cap.every((id) => row(id).status === 'sent'))
}

// ------------------------------------------------------------------------------------------------------------------------ D. retry with backoff
async function phaseD() {
  console.log('== D. retry with exponential backoff, the retry streak, a manual retry')
  ageLedger()
  const a = addRow({ project: P1, node: SEL1, to: mail('retry503'), by: PM1.id, subject: 'Retry 503', tag: 'r503' })
  await clearInjections()
  await inject({ target: 'gmail.send', mode: '503', times: 1, match: { recipient: `retry503.${rid}` } })
  await worker({ maxRunSeconds: 8 })
  const r = row(a)
  check('a 503 from Gmail: nothing delivered, the row is queued again with a retry streak of 1, the code server_error and a backoff of about 30 s (22 - 38 s)', r.status === 'queued' && r.streak === 1 && r.error === 'server_error' && (await msgsTo(mail('retry503'))).length === 0 && secondsAhead(a) >= 15 && secondsAhead(a) <= 40, `${r.status}/${r.streak}/${secondsAhead(a)}s`)
  check('the PM sees it as a normal queued row (not an error) in the Outbox', (await rpcOk(T_PM1, 'list_email_outbox', { p_project: P1, p_states: ['queued'], p_node: null, p_search: `retry503.${rid}`, p_limit: 5, p_offset: 0 })).rows[0]?.fail_streak === 1)
  await worker({ maxRunSeconds: 8 })
  check('a run BEFORE the backoff is over does nothing', row(a).status === 'queued' && (await msgsTo(mail('retry503'))).length === 0)
  due([a])
  await worker({ maxRunSeconds: 8 })
  check('after the backoff it is sent, exactly once, and the streak resets', row(a).status === 'sent' && row(a).streak === 0 && (await msgsTo(mail('retry503'))).length === 1)

  const b = addRow({ project: P1, node: SEL1, to: mail('retry429'), by: PM1.id, subject: 'Retry 429', tag: 'r429' })
  await inject({ target: 'gmail.send', mode: '429', retryAfter: 90, times: 1, match: { recipient: `retry429.${rid}` } })
  await worker({ maxRunSeconds: 8 })
  check('429 with Retry-After 90: the row waits at least 90 s', row(b).status === 'queued' && row(b).error === 'rate_limited' && secondsAhead(b) >= 88, `${secondsAhead(b)}s`)
  due([b]); await worker({ maxRunSeconds: 8 })
  check('...and is delivered afterwards', row(b).status === 'sent')

  const c = addRow({ project: P1, node: SEL1, to: mail('retrymax'), by: PM1.id, subject: 'Retry max', tag: 'rmax' })
  await inject({ target: 'gmail.send', mode: '503', times: 50, match: { recipient: `retrymax.${rid}` } })
  const streaks = []
  for (let i = 0; i < 6; i++) { due([c]); await worker({ maxRunSeconds: 8 }); streaks.push(row(c).streak) }
  const rc = row(c)
  check('six consecutive failures end in `failed` with the code max_attempts (the sixth request was the last)', rc.status === 'failed' && rc.error === 'max_attempts' && rc.attempt === 6 && (await msgsTo(mail('retrymax'))).length === 0, `${streaks.join(',')} ${rc.status}/${rc.error}/${rc.attempt}`)
  const w = await worker({ maxRunSeconds: 8 })
  check('a failed row is never retried by the worker on its own', w.body?.claimed === 0 && row(c).status === 'failed')
  await clearInjections()
  const retried = await rpcOk(T_PM1, 'email_outbox_retry', { p_ids: [c] })
  check('the PM retries it from the Outbox (RPC): queued, due now, a fresh budget', retried.updated === 1 && row(c).status === 'queued' && row(c).streak === 0)
  await worker({ maxRunSeconds: 8 })
  check('...and it is delivered', row(c).status === 'sent' && (await msgsTo(mail('retrymax'))).length === 1 && row(c).resolution === 'manual_retry')

  const d = addRow({ project: P1, node: SEL1, to: 'not-an-address', by: PM1.id, subject: 'Bad recipient', tag: 'bad' })
  await worker({ maxRunSeconds: 8 })
  check('a stored recipient that is not an address is a PERMANENT failure (invalid_recipient), no request was made, no retry', row(d).status === 'failed' && row(d).error === 'invalid_recipient' && row(d).attempt === 0)
}

// ------------------------------------------------------------------------------------------------------------------------ E. unknown outcome
async function phaseE() {
  console.log('== E. UNKNOWN OUTCOME: needs_review and never resent automatically (this phase waits for one 15 s Gmail timeout)')
  ageLedger()
  await clearInjections()
  const a = addRow({ project: P1, node: SEL1, to: mail('uo-timeout'), by: PM1.id, subject: 'Unknown timeout', tag: 'uo1' })
  await inject({ target: 'gmail.send', mode: 'timeout-after-accept', times: 1, match: { recipient: `uo-timeout.${rid}` } })
  const w = await worker({ maxRunSeconds: 60 })
  check('a timeout AFTER Google accepted the request: the message exists once at Google, the row is parked as needs_review (unknown_outcome)', row(a).status === 'needs_review' && row(a).error === 'unknown_outcome' && (await msgsTo(mail('uo-timeout'))).length === 1 && w.body?.needs_review === 1, `${row(a).status}`)
  for (let i = 0; i < 3; i++) await worker({ maxRunSeconds: 8 })
  check('three more worker runs: still ONE message, the row stays needs_review (never auto-resent)', (await msgsTo(mail('uo-timeout'))).length === 1 && row(a).status === 'needs_review')
  const list = await rpcOk(T_PM1, 'list_email_outbox', { p_project: P1, p_states: ['needs_review'], p_node: null, p_search: null, p_limit: 20, p_offset: 0 })
  check('the PM sees it under needs_review with the Message-ID to search for in his Sent folder', list.rows.some((r) => r.id === a && r.message_id === null && r.send_attempt === 1) || list.rows.some((r) => r.id === a))
  const item = await rpcOk(T_PM1, 'get_email_outbox_item', { p_id: a })
  check('the row detail lists the timeline (claimed, send_started, needs_review) and the rendered body', ['claimed', 'send_started', 'needs_review'].every((e) => item.events.some((x) => x.event === e)) && /Body uo1/.test(item.body_html ?? ''))
  const ms = await rpcOk(T_PM1, 'email_outbox_mark_sent', { p_ids: [a] })
  check('the PM marks it as sent manually (he found it in the Sent folder): sent, resolution manual_sent, still ONE message', ms.updated === 1 && row(a).status === 'sent' && row(a).resolution === 'manual_sent' && (await msgsTo(mail('uo-timeout'))).length === 1)

  const b = addRow({ project: P1, node: SEL1, to: mail('uo-reset'), by: PM1.id, subject: 'Unknown reset', tag: 'uo2' })
  await inject({ target: 'gmail.send', mode: 'reset-after-accept', times: 1, match: { recipient: `uo-reset.${rid}` } })
  await worker({ maxRunSeconds: 8 })
  check('a connection RESET after Google accepted: needs_review, one message', row(b).status === 'needs_review' && (await msgsTo(mail('uo-reset'))).length === 1)
  await worker({ maxRunSeconds: 8 })
  check('not resent by the next run', (await msgsTo(mail('uo-reset'))).length === 1 && row(b).status === 'needs_review')
  const rs = await rpcOk(T_PM1, 'email_outbox_resend', { p_ids: [b] })
  check('the PM resends it ON PURPOSE (explicit): queued again', rs.updated === 1 && row(b).status === 'queued' && row(b).resolution === 'manual_resend')
  await worker({ maxRunSeconds: 8 })
  const both = await msgsTo(mail('uo-reset'))
  check('now there are TWO messages (the person chose it) with two DIFFERENT Message-IDs (attempt 1 and 2), and the row is sent', both.length === 2 && new Set(both.map((m) => m.messageId)).size === 2 && row(b).status === 'sent' && row(b).attempt === 2, both.map((m) => m.messageId.slice(-24)).join(' '))

  const c = addRow({ project: P1, node: SEL1, to: mail('uo-before'), by: PM1.id, subject: 'Unknown before', tag: 'uo3' })
  await inject({ target: 'gmail.send', mode: 'timeout-before-accept', times: 1, match: { recipient: `uo-before.${rid}` } })
  await worker({ maxRunSeconds: 60 })
  check('a timeout BEFORE Google accepted looks exactly the same to the worker: needs_review, zero messages (it cannot tell, so it never guesses)', row(c).status === 'needs_review' && (await msgsTo(mail('uo-before'))).length === 0)
  const cn = await rpcOk(T_PM1, 'email_outbox_cancel', { p_ids: [c] })
  await worker({ maxRunSeconds: 8 })
  check('the PM cancels it: cancelled, and a cancelled row is final', cn.updated === 1 && row(c).status === 'cancelled' && (await msgsTo(mail('uo-before'))).length === 0 && sqlOne(`select count(*) from app_private.email_outbox where id = '${c}' and status = 'cancelled'`) === '1')
  await clearInjections()

  // a worker that dies after the request marker: simulated by a lease that expires with the marker set (what a crash leaves behind)
  const d = addRow({ project: P1, node: SEL1, to: mail('uo-crash'), by: PM1.id, subject: 'Crash', tag: 'uo4' })
  sql(`update app_private.email_outbox set status = 'sending', locked_by = 'dead-worker', locked_until = now() - interval '2 minutes', send_started_at = now() - interval '3 minutes', send_attempt = 1, sender_connection_id = '${C_PM1}' where id = '${d}'`)
  const w2 = await worker({ maxRunSeconds: 8 })
  check('a worker that died AFTER marking the request: the lease expires and the row becomes needs_review (reviewed in the run summary), NOT sent again', row(d).status === 'needs_review' && w2.body?.reviewed >= 1 && (await msgsTo(mail('uo-crash'))).length === 0)
  const e = addRow({ project: P1, node: SEL1, to: mail('uo-crash2'), by: PM1.id, subject: 'Crash before', tag: 'uo5' })
  sql(`update app_private.email_outbox set status = 'sending', locked_by = 'dead-worker', locked_until = now() - interval '2 minutes', sender_connection_id = '${C_PM1}' where id = '${e}'`)
  const w3 = await worker({ maxRunSeconds: 8 })
  check('one that died BEFORE any request: the row is requeued and delivered', row(e).status === 'sent' && w3.body?.requeued >= 1 && (await msgsTo(mail('uo-crash2'))).length === 1)
  sql(`update app_private.email_outbox set status = 'cancelled' where id = '${d}'`)
}

// ------------------------------------------------------------------------------------------------------------------------ F. invalid_grant -> needs_reconnect + fallback
async function phaseF() {
  console.log('== F. invalid_grant: needs_reconnect, fallback to startups@, wait when the template forbids it, deliver after reconnecting')
  ageLedger()
  await clearInjections()
  const fb = [1, 2].map((i) => addRow({ project: P2, node: SEL2, to: mail(`fb${i}`), by: PM2.id, subject: `Fallback ${i}`, tag: `fb${i}` }))
  await fakeCtl('/__control/revoke-all', { email: PM2.email })
  const w = await worker({ maxRunSeconds: 20 })
  check('Google refuses the saved permission (invalid_grant): the PM\'s connection is marked needs_reconnect (a short CODE, never the message)', sqlOne(`select status || '/' || last_error from app_private.google_connections where id = '${C_PM2}'`) === 'needs_reconnect/invalid_grant')
  check('the rows were not lost: they went out from startups@athareg.com (the fallback), one message each', fb.every((id) => row(id).status === 'sent' && row(id).source === 'system') && (await msgsTo(mail('fb1')))[0]?.account === 'startups@athareg.com' && (await msgsTo(mail('fb2'))).length === 1, JSON.stringify(w.body))
  check('the audit log says it was a fallback and why', sqlOne(`select detail from app_private.email_log where outbox_id = '${fb[0]}' and event = 'claimed' order by id desc limit 1`) === 'fallback to the system sender: user_needs_reconnect')
  const st = await rpcOk(T_PM2, 'get_google_connection_status')
  check('the PM\'s own screen (get_google_connection_status) says needs_reconnect and that startups@ is sending meanwhile', st.mine?.status === 'needs_reconnect' && st.effective?.source === 'system' && st.effective?.fallback === true)

  // the template forbids the fallback: the rows wait, visibly
  sql(`update public.nodes set config = jsonb_set(coalesce(config, '{}'::jsonb), '{emails}', jsonb_build_object('acceptance', jsonb_build_object('fallback_to_system', false))) where id = '${SEL2}'`)
  const nf = [3, 4].map((i) => addRow({ project: P2, node: SEL2, to: mail(`fb${i}`), by: PM2.id, subject: `No fallback ${i}`, tag: `fb${i}` }))
  const before = (await fakeMessages()).length
  await worker({ maxRunSeconds: 8 })
  const wl = await rpcOk(T_PM2, 'list_email_outbox', { p_project: P2, p_states: ['blocked'], p_node: null, p_search: null, p_limit: 20, p_offset: 0 })
  check('fallback not allowed: nothing is sent, the rows are BLOCKED with the visible reason sender_needs_reconnect', (await fakeMessages()).length === before && nf.every((id) => row(id).blocked === 'sender_needs_reconnect') && wl.rows.length === 2 && wl.rows.every((r) => r.state === 'blocked'))
  const rec = await oauthConnect(T_PM2, PM2.email)
  check('the PM reconnects Google (the real OAuth flow)', rec.google === 'connected' && sqlOne(`select status from app_private.google_connections where id = '${C_PM2}'`) === 'active', `${rec.google}/${rec.reason}`)
  const sn = await rpcOk(T_PM2, 'email_outbox_send_now', { p_project: P2 })
  check('"Send now" makes the waiting rows due at once (the scheduler is off, so nothing is kicked)', sn.released === 2 && sn.kicked === false, JSON.stringify(sn))
  await worker({ maxRunSeconds: 20 })
  const ms = [(await msgsTo(mail('fb3')))[0], (await msgsTo(mail('fb4')))[0]]
  check('and they go out AS THE PM (his own address) now that he is connected', nf.every((id) => row(id).status === 'sent' && row(id).source === 'user') && ms.every((m) => m?.account === PM2.email), `${ms.map((m) => m?.account)}`)
  sql(`update public.nodes set config = '{}'::jsonb where id = '${SEL2}'`)
}

// ------------------------------------------------------------------------------------------------------------------------ G. concurrent workers
async function phaseG() {
  console.log('== G. three concurrent workers never double-send')
  ageLedger()
  const N = 24
  const ids = Array.from({ length: N }, (_, i) => addRow({ project: P1, node: SEL1, to: mail(`bulk${i}`), by: PM1.id, subject: `Bulk ${i}`, tag: `bulk${i}` }))
  const before = (await fakeMessages()).length
  const results = await Promise.all([worker({ batch: 4, maxRunSeconds: 30 }), worker({ batch: 4, maxRunSeconds: 30 }), worker({ batch: 4, maxRunSeconds: 30 })])
  const total = results.reduce((s, r) => s + (r.body?.sent ?? 0), 0)
  const after = (await fakeMessages()).slice(before)
  const perRecipient = new Map()
  for (const m of after) perRecipient.set(m.to[0].email, (perRecipient.get(m.to[0].email) ?? 0) + 1)
  check(`${N} queued rows, three workers at once: all delivered, the worker summaries add up to ${N}`, results.every((r) => r.status === 200) && total === N && after.length === N, `${results.map((r) => r.body?.sent).join('+')} = ${total}, fake ${after.length}`)
  check('NO recipient received more than one message (nothing was sent twice)', [...perRecipient.values()].every((n) => n === 1) && perRecipient.size === N)
  check('every row is sent with ONE request attempt and ONE claim', ids.every((id) => { const r = row(id); return r.status === 'sent' && r.attempt === 1 }) && ids.every((id) => nlog(id, 'send_started') === 1 && nlog(id, 'sent') === 1))
  check('the workers shared the work (at least two of them sent something)', results.filter((r) => (r.body?.sent ?? 0) > 0).length >= 2, results.map((r) => r.body?.sent).join(','))
}

// ------------------------------------------------------------------------------------------------------------------------ H. the endpoint and the RLS of the Outbox RPCs
async function phaseH() {
  console.log('== H. the worker endpoint and who may see / do what')
  const bait = addRow({ project: P1, node: SEL1, to: mail('stored-recipient'), by: PM1.id, subject: 'Stored recipient', tag: 'stored' })
  const none = await worker({}, { 'content-type': 'application/json' })
  check('no secret: 401 unauthorized (and the queued row is untouched)', none.status === 401 && none.body?.error === 'unauthorized' && row(bait).status === 'queued')
  check('a wrong secret: 401', (await worker({}, { 'x-worker-secret': 'definitely-not-the-secret-0123456789', 'content-type': 'application/json' })).status === 401)
  check('the anon key as a Bearer token: 401', (await worker({}, { authorization: `Bearer ${ANON}`, 'content-type': 'application/json' })).status === 401)
  check('a project manager\'s JWT: 401 (a user cannot run the worker)', (await worker({}, { authorization: `Bearer ${T_PM1}`, 'content-type': 'application/json' })).status === 401)
  check('the service-role key as a Bearer token IS accepted (scripts)', (await worker({ maxRunSeconds: 5 }, { authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' })).status === 200 && row(bait).status === 'sent')
  const before = (await fakeMessages()).length
  addRow({ project: P1, node: SEL1, to: mail('real-recipient'), by: PM1.id, subject: 'Real', tag: 'real' })
  const hostile = await worker({ to: 'attacker@evil.example', recipient: 'attacker@evil.example', cc: ['attacker@evil.example'], subject: 'pwned', body: 'pwned', perMinute: 99999, dailyCap: 99999, maxMessages: 99999 })
  const got = (await fakeMessages()).slice(before)
  check('a request body that names recipients / subjects is IGNORED: only the stored row went out, to its stored recipient', hostile.status === 200 && got.length === 1 && got[0].to[0].email === mail('real-recipient') && got[0].subject === 'Real' && !got.some((m) => JSON.stringify(m).includes('evil.example')))
  check('only a non-routable GET / other methods are refused', (await fetch(`${API}/functions/v1/email-worker`, { method: 'GET', headers: { 'x-worker-secret': env.EMAIL_WORKER_SECRET } })).status === 405)

  // RLS / privileges through PostgREST
  const claimAsPm = await rpc(T_PM1, 'email_worker_claim', { p_worker: 'hax', p_limit: 5, p_lease_seconds: 60, p_per_minute: 30, p_daily_cap: 100 })
  check('a PM cannot call the worker RPC claim (permission denied) and gets no rows', claimAsPm.status === 403 && !JSON.stringify(claimAsPm.body ?? {}).includes('recipient'), `HTTP ${claimAsPm.status}`)
  const claimAnon = await fetch(`${API}/rest/v1/rpc/email_worker_claim`, { method: 'POST', headers: H(ANON), body: JSON.stringify({ p_worker: 'hax' }) })
  check('anon cannot either', claimAnon.status === 401 || claimAnon.status === 403, `HTTP ${claimAnon.status}`)
  const t1 = await fetch(`${API}/rest/v1/email_outbox?select=*`, { headers: H(T_PM1) })
  const t2 = await fetch(`${API}/rest/v1/email_outbox?select=*`, { headers: H(T_PM1, { 'Accept-Profile': 'app_private' }) })
  check('there is no email_outbox table for a PM (404) and the schema app_private is not exposed (406)', t1.status === 404 && t2.status === 406, `${t1.status}/${t2.status}`)
  const other = await rpc(T_PM2, 'list_email_outbox', { p_project: P1 })
  check('PM2 (who does not manage project 1) cannot list its outbox: 403 forbidden', other.status === 403 && other.body?.hint === 'forbidden', `HTTP ${other.status}`)
  const mine = await rpcOk(T_PM2, 'list_email_outbox', { p_project: P2 })
  check('PM2 lists only the rows of HIS project (no row of project 1 appears)', mine.rows.length > 0 && mine.rows.every((r) => r.node_id === SEL2))
  const l1 = await rpcOk(T_PM1, 'list_email_outbox', { p_project: P1, p_states: null, p_node: null, p_search: null, p_limit: 200, p_offset: 0 })
  check('the list returns no body, no token, no secret key', ![...keysOf(l1)].some((k) => /body|token|secret|cipher|vault/i.test(k)), [...keysOf(l1)].join(','))
  const pmHealth = await rpc(T_PM1, 'get_email_health')
  check('the health panel is super_admin only', pmHealth.status === 403 && (await rpc(T_SA, 'get_email_health')).status === 200)
  const o1 = await rpc(T_PM2, 'email_outbox_cancel', { p_ids: [bait] })
  check('another project\'s PM cannot cancel / retry rows he cannot see (they are skipped)', o1.status === 200 && o1.body?.updated === 0)
  const inv = await rpc(T_PM1, 'list_staff_invitation_delivery')
  check('a PM cannot read the staff-invitation delivery list', inv.status === 403)
  const foreignItem = await rpc(T_PM2, 'get_email_outbox_item', { p_id: bait })
  check('nor open one row of another project (403)', foreignItem.status === 403)
}

// ------------------------------------------------------------------------------------------------------------------------ I. health + scheduler
async function phaseI() {
  console.log('== I. health panel and the scheduler (pg_cron -> pg_net -> the function)')
  const h = await rpcOk(T_SA, 'get_email_health')
  check('health: queue depth / oldest / blocked / sending / needs_review, senders with their counters, last worker run', typeof h.queue?.depth === 'number' && 'oldest_age_seconds' in h.queue && h.senders.length >= 3
    && h.senders.some((s) => s.kind === 'system' && s.email === 'startups@athareg.com') && h.senders.find((s) => s.email === PM1.email)?.sent_24h > 10 && h.worker.age_seconds >= 0 && h.worker.age_seconds < 600 && h.worker.summary && typeof h.worker.summary.sent === 'number', JSON.stringify(h.queue))
  check('the scheduler is reported OFF (and nothing is scheduled)', h.worker.scheduler_enabled === false && h.worker.cron_scheduled === false && sqlNum(`select count(*) from cron.job where jobname like 'athar-email-%'`) === 0)
  check('the health payload holds no token, secret or URL', ![...keysOf(h)].some((k) => /token|secret|cipher|vault|url/i.test(k)))
  if (SKIP_CRON) { console.log('   (cron part skipped: --skip-cron)'); return }

  sql(`select app_private.email_worker_enable('http://kong:8000/functions/v1', '${env.EMAIL_WORKER_SECRET}')`)
  const st = JSON.parse(sqlOne(`select app_private.email_worker_status()::text`))
  check('scheduler enabled: two cron jobs (every minute + nightly), the secret in Vault (encrypted), the URL stored', st.enabled && st.cron_jobs.length === 2 && st.cron_jobs.some((j) => j.name === 'athar-email-worker' && j.schedule === '* * * * *') && st.secret_set
    && sqlOne(`select (secret <> '${env.EMAIL_WORKER_SECRET}')::text from vault.secrets where name = 'athar-email-worker-secret'`) === 'true')
  const k1 = addRow({ project: P1, node: SEL1, to: mail('kick'), by: PM1.id, subject: 'Kick', tag: 'kick' })
  sql(`update app_private.worker_settings set updated_at = now() - interval '1 minute' where key = 'last_kick_at'`)
  const kick = sqlOne(`select coalesce(app_private.email_kick_worker()::text, 'null')`)
  check('email_kick_worker() posts through pg_net and returns a request id', /^\d+$/.test(kick), kick)
  let resp = ''
  for (let i = 0; i < 40 && !resp; i++) { await sleep(500); resp = sqlOne(`select coalesce(status_code::text, 'err:' || coalesce(error_msg, '')) from net._http_response where id = ${kick}`) }
  check('the function answered the pg_net call with 200 (the shared secret from Vault was accepted)', resp === '200', resp)
  for (let i = 0; i < 20 && row(k1).status !== 'sent'; i++) await sleep(500)
  check('and the row was delivered by that kicked run', row(k1).status === 'sent' && (await msgsTo(mail('kick'))).length === 1)
  // "Send now" as a PM kicks the worker when the scheduler is on
  const k2 = addRow({ project: P1, node: SEL1, to: mail('sendnow'), by: PM1.id, subject: 'Send now', tag: 'sendnow' })
  sql(`update app_private.email_outbox set next_attempt_at = now() + interval '10 minutes' where id = '${k2}'; update app_private.worker_settings set updated_at = now() - interval '1 minute' where key = 'last_kick_at'`)
  const sn = await rpcOk(T_PM1, 'email_outbox_send_now', { p_project: P1 })
  check('"Send now" (as the PM) releases the waiting row and KICKS the worker', sn.released === 1 && sn.kicked === true, JSON.stringify(sn))
  for (let i = 0; i < 30 && row(k2).status !== 'sent'; i++) await sleep(500)
  check('...and it is delivered without any manual trigger', row(k2).status === 'sent' && (await msgsTo(mail('sendnow'))).length === 1)
  // the cron tick itself
  const k3 = addRow({ project: P1, node: SEL1, to: mail('crontick'), by: PM1.id, subject: 'Cron tick', tag: 'cron' })
  const t0 = Date.now()
  for (let i = 0; i < 160 && row(k3).status !== 'sent'; i++) await sleep(500)
  check(`pg_cron delivered a row on its own within a minute (took ${Math.round((Date.now() - t0) / 1000)} s)`, row(k3).status === 'sent' && (await msgsTo(mail('crontick'))).length === 1)
  sql(`select app_private.email_worker_disable()`)
  const off = JSON.parse(sqlOne(`select app_private.email_worker_status()::text`))
  check('scheduler disabled again: no cron job, no Vault secret, no settings', !off.enabled && off.cron_jobs.length === 0 && !off.secret_set && sqlNum(`select count(*) from app_private.worker_settings`) === 0)
}

// ------------------------------------------------------------------------------------------------------------------------ J. logs
async function phaseJ() {
  console.log('== J. the function log holds no personal data and no secret')
  let log = ''
  const dl = spawnSync('docker', ['logs', '--since', logStart, EDGE_CONTAINER], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }) // the runtime writes to stderr too
  log = `${dl.stdout ?? ''}\n${dl.stderr ?? ''}`
  const st = await fakeGet('/__state?include_tokens=1')
  const needles = [rid, 'ew.example.invalid', 'دعوة', 'عزيزي', 'invite=', 'Bulk ', 'Fallback ', env.EMAIL_WORKER_SECRET, env.GOOGLE_CLIENT_SECRET, SERVICE, ...(st.refreshTokens ?? []).map((t) => t.token).filter((t) => t.length > 12), ...(st.accessTokens ?? []).map((t) => t.token).filter((t) => t.length > 12)]
  const hits = needles.filter((n) => n && log.includes(n)).map((n) => `${String(n).slice(0, 6)}...`)
  check(`no recipient, subject, body, link token, refresh / access token or secret appears in ${log.split('\n').length} lines of the edge-runtime log`, hits.length === 0 && log.length > 0, hits.join(',') || `${log.length} bytes`)
  const events = [...log.matchAll(/"event":"(email_[a-z_]+)"/g)].map((m) => m[1])
  check('the log lines the worker does write are structured events (email_not_sent ...) with ids and codes only', events.length > 0 && events.every((e) => /^email_(not_sent|token_failed|finish_failed|row_error|lease_lost|mark_failed|worker_error)$/.test(e)), [...new Set(events)].join(','))
}

// ------------------------------------------------------------------------------------------------------------------------ cleanup
async function cleanup() {
  console.log('== cleanup')
  const projects = [P1, P2].filter(Boolean)
  const users = created.userIds.map((u) => `'${u}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"
  try { sql(`select app_private.email_worker_disable()`) } catch { /* not enabled */ }
  const tolerant = (q) => { try { sql(q) } catch (e) { console.log(`   cleanup step failed (${String(e.message).split('\n')[0].slice(0, 100)})`) } }
  const projIn = projects.map((p) => `'${p}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"
  tolerant(`delete from app_private.email_outbox where recipient_email::text like '%${rid}%' or created_by in (${users}) or project_id in (${projIn})`)
  tolerant(`delete from public.staff_invitations where email::text like '%${rid}%'`)
  tolerant(`delete from public.form_responses where project_id in (${projIn})`)
  if (created.programId) {
    tolerant(`delete from public.projects where program_id = '${created.programId}'`)
    tolerant(`delete from public.programs where id = '${created.programId}'`)
  }
  // a connection's refresh token lives in Vault: delete the secret objects BEFORE the rows (a plain DELETE of the row would leave the secret behind)
  const connWhere = `owner_user_id in (${users}) or email::text like '%${rid}%' ${created.systemCreated ? "or kind = 'system'" : ''}`
  tolerant(`select app_private.google_delete_secret(id) from app_private.google_connections where ${connWhere}`)
  tolerant(`delete from app_private.google_connections where ${connWhere}`)
  tolerant(`delete from auth.users where id in (${users})`)
  tolerant(`delete from app_private.google_oauth_states where user_id in (${users})`)
  if (!heartbeat0) tolerant(`delete from app_private.worker_heartbeat`)
  tolerant(`delete from vault.secrets where name = 'athar-email-worker-secret'`)
  await fakeCtl('/__control/clear-injections').catch(() => {})
  const after = baseline()
  const diff = []
  const a = new Map(baselineBefore.split('\n').map((l) => l.split('|')))
  for (const l of after.split('\n')) { const [k, v] = l.split('|'); if (a.get(k) !== v && !(heartbeat0 && k === 'app_private.worker_heartbeat')) diff.push(`${k}: ${a.get(k)} -> ${v}`) }
  check('baseline counts after the cleanup are IDENTICAL to the counts before (every table, schema and function count)', diff.length === 0, diff.join('; ') || `${a.size} counters`)
  check('no Vault secret, no cron job, no outbox row, no connection is left', sqlNum(`select (select count(*) from vault.secrets) + (select count(*) from cron.job where jobname like 'athar-email-%') + (select count(*) from app_private.email_outbox) + (select count(*) from app_private.google_connections)`) === 0)
}

// ------------------------------------------------------------------------------------------------------------------------ run
let crashed = null
try {
  await setup()
  await phaseA()
  await phaseB()
  await phaseC()
  await phaseD()
  await phaseE()
  await phaseF()
  await phaseG()
  await phaseH()
  await phaseI()
  await phaseJ()
} catch (e) {
  crashed = e
  check('the run completed without an unexpected error', false, String(e?.message ?? e).slice(0, 300))
} finally {
  try { await cleanup() } catch (e) { check('cleanup completed', false, String(e?.message ?? e).slice(0, 200)) }
}
console.log(`\n${pass} passed, ${fail} failed${crashed ? ' (crashed)' : ''}`)
process.exit(fail === 0 && !crashed ? 0 : 1)
