#!/usr/bin/env node
// verify-calendar-sync.mjs - END-TO-END proof of the calendar sync (m63 + the `calendar-sync` edge function) on the LOCAL stack: the REAL database, the REAL
// Edge Runtime function called through Kong with the service key, the REAL OAuth connections (Vault-stored refresh tokens, connected through the real
// google-oauth-* functions), and the FAKE Google (db/scripts/fake-google). It can never reach a real Google endpoint (it refuses to run unless
// local-db/functions.env has ALLOW_FAKE_GOOGLE=1 and the fake answers on loopback).
//
//   bash db/scripts/dev-functions.sh up          # the runtime + the fake Google (once)
//   node db/scripts/verify-calendar-sync.mjs
//
// What it proves (about 90 checks): SHADOW mode makes zero Google calls and logs the plan; LIVE without a connection PARKS the jobs (needs_connection),
// connecting Google makes them due (the trigger) and creates ONE event per booking (id = the booking uuid in hex, project zone, attendees, sendUpdates = all,
// a Meet link written back); a duplicate job adopts instead of duplicating; reschedule patches the same event and keeps the link; cancel deletes it and restore
// brings it back; HTTP 429 (Retry-After honoured) and 500 (backoff, dead after 6 attempts, the PM's Retry) ; a TIMEOUT AFTER Google accepted the event creates no
// second event on the retry; invalid_grant PARKS the job (no failure, nothing lost), the system sender takes a NEW event, an event that already lives on a PM's
// calendar waits for that PM (never moved) and runs after the PM reconnects; a MIGRATED booking is never created again (its legacy event is patched / deleted on the
// system calendar); an empty shared link is a permanent error with zero Google calls; OFF claims nothing; the function refuses anon / PM callers; no token, secret or
// address in the function's log lines.
//
// Safety: throwaway data only (users created the provisioned way = no founder row and no alumni change-log entry, one program / project / node, bookings with
// @example.invalid addresses), deleted at the end; calendar_sync_mode is restored to what it was. It prints no token, key, secret or password. Exit 0 = all passed.
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = process.env.SUPABASE_API_URL || 'http://127.0.0.1:54321'
const STACK = path.join(ROOT, 'local-db', 'stack')
const DB_CONTAINER = 'supabase_db_stack'

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
try { const h = await fetch(`${FAKE}/__health`); if (!h.ok) throw new Error() } catch { console.error(`refusing: the fake Google does not answer on ${FAKE} (bash db/scripts/dev-functions.sh up)`); process.exit(2) }

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
}
const psqlArgs = ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
const sql = (q) => execFileSync('docker', [...psqlArgs, '-c', q], { encoding: 'utf8' }).trim()
const sqlOne = (q) => sql(q).split('\n')[0]
const script = (text) => execFileSync('docker', psqlArgs, { input: text, encoding: 'utf8' }).trim()
const json = async (res) => { try { return await res.json() } catch { return null } }
const H = (token, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra })
const rid = crypto.randomBytes(3).toString('hex')
const hex = (id) => id.replace(/-/g, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const created = { userIds: [], emails: [], program: null, project: null, previousMode: null, logStart: 0, systemLinkedByUs: false, startedAt: new Date().toISOString() }

const fakeCtl = (p, body) => fetch(`${FAKE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const fakeState = async () => json(await fetch(`${FAKE}/__state?include_tokens=1`))
const fakeEvents = async (email) => (await json(await fetch(`${FAKE}/__events`)))?.[email] ?? []
const fakeCalls = async () => (await fakeState())?.calls ?? []
const nextAccount = (a) => fakeCtl('/__control/next-account', a)

async function createStaff(email, role) {
  const password = `Pw-${crypto.randomBytes(18).toString('base64url')}`
  const id = crypto.randomUUID()
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"],"provisioned":true}', '{"full_name":"Calendar Verify"}', now(), now(), '', '', '', '', '', '', '', '')`)
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
const rpc = async (token, name, args = {}) => { const r = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: H(token), body: JSON.stringify(args) }); return { status: r.status, body: await json(r) } }

// The fake Google is shared with the other tasks that use the local runtime: this script never resets it, never clears injections or the call log. It only
// (re)states the client secret / redirect URI the functions already use, scopes every failure injection to the event id of ITS OWN booking, and counts the calls
// made since a timestamp (a call is stamped with the time its request STARTED).
async function resetFake() {
  await fakeCtl('/__control/config', { clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUris: [env.GOOGLE_REDIRECT_URI] })
}
const injectFor = (bookingId, target, mode, times = 1, extra = {}) => fakeCtl('/__control/inject', { target, mode, times, match: { eventId: hex(bookingId) }, ...extra })
const callsSince = async (t0) => (await fakeCalls()).filter((c) => c.t >= t0)
const stamp = async () => { await sleep(300); return new Date().toISOString() }
async function connectGoogle(token, { system = false, email, hd = 'athareg.com' } = {}) {
  await nextAccount({ email, hd })
  const s = await fetch(`${API}/functions/v1/google-oauth-start`, { method: 'POST', headers: H(token, { Origin: APP_ORIGIN }), body: JSON.stringify({ system, returnTo: '/profile' }) })
  const url = (await json(s))?.url
  if (!url) return { google: 'no_url', reason: `HTTP ${s.status}` }
  const a = await fetch(url, { redirect: 'manual' })
  const cb = await fetch(a.headers.get('location') || '', { redirect: 'manual' })
  const u = new URL(cb.headers.get('location') || 'http://x/?')
  return { google: u.searchParams.get('google'), reason: u.searchParams.get('reason') }
}

// ---- the worker, through the real runtime
const runWorker = async (body = {}) => {
  const r = await fetch(`${API}/functions/v1/calendar-sync`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await json(r) }
}
const job = (id) => { const [status, attempts, error, action] = sql(`select status||'|'||attempts||'|'||coalesce(error,'')||'|'||coalesce(result->>'action','') from app_private.integration_jobs where id='${id}'`).split('|'); return { status, attempts: Number(attempts), error, action } }
const jobsOf = (bookingId, kind = null) => sql(`select id from app_private.integration_jobs where booking_id='${bookingId}' ${kind ? `and kind='${kind}'` : ''} order by created_at, id`).split('\n').filter(Boolean)
const lastJob = (bookingId) => sql(`select id from app_private.integration_jobs where booking_id='${bookingId}' order by created_at desc, id desc limit 1`)
const due = (jobId) => sql(`update app_private.integration_jobs set next_attempt_at = now() - interval '1 second' where id='${jobId}'`)
const bk = (id) => { const [status, meet, owner, synced] = sql(`select status||'|'||coalesce(meet_link,'')||'|'||coalesce(calendar_owner_connection_id::text,'')||'|'||(calendar_synced_at is not null)::text from public.bookings where id='${id}'`).split('|'); return { status, meet, owner, synced: synced === 'true' } }
const setMode = (m) => sql(`update app_private.calendar_sync_config set mode='${m}', updated_at = now() where id`)
const logCount = (event, jobId) => Number(sqlOne(`select count(*) from app_private.calendar_sync_log where event='${event}' ${jobId ? `and job_id='${jobId}'` : ''}`))
const conn = (email) => sql(`select id||'|'||status from app_private.google_connections where email::text='${email}'`).split('|')

// ------------------------------------------------------------------------------------------------------------------------ main
let SA, PM, saTok, pmTok
const slots = []
let prog, proj, node, slug
let nSlot = 0
const SA_MAIL = `cal-verify-sa-${rid}@athareg.com`
const SYS_MAIL = 'startups@athareg.com'
const PROV_MAIL = `mentor.${rid}@example.invalid`

async function fixtures() {
  SA = await createStaff(SA_MAIL, 'super_admin')
  PM = await createStaff(`cal-verify-pm-${rid}@athareg.com`, 'project_manager')
  saTok = await login(SA)
  pmTok = await login(PM)
  const out = script(`
set search_path = public, extensions;
begin;
select set_config('request.jwt.claims', '{"sub":"${SA.id}","role":"authenticated"}', true);
set local role authenticated;
select (public.create_program('CAL VERIFY ${rid}', 'برنامج', null, null, null, null)).id as prog \\gset
select (public.create_project(:'prog', 'CAL VERIFY PROJECT ${rid}', null, 'Africa/Cairo')).id as proj \\gset
select (public.add_node(:'proj', 'list', '{"en":"Mentors"}', 0, 0, '{"subkind":"expert"}')).id as lst \\gset
select (public.add_node(:'proj', 'booking', '{"en":"Mentor sessions"}', 0, 0, '{"mode":"mentor"}')).id as bkm \\gset
select (public.connect(:'proj', :'lst', 'items', :'bkm', 'mentors', '{}')).id as e1 \\gset
reset role;
insert into public.network_experts (id, name_en, name_ar, title_en, email) values ('${crypto.randomUUID()}', 'Cal Verify Mentor', 'منتور', 'CEO', '${PROV_MAIL}') returning id as ne \\gset
set local role authenticated;
select public.add_network_pick(:'lst', :'ne') as item \\gset
select public.save_node(:'bkm', (select rev from public.node_revisions where node_id = :'bkm'), '{"visibility":"public"}'::jsonb) as _s \\gset
select public.ensure_public_link(:'bkm', 'booking', null, null) as _l \\gset
reset role;
insert into public.program_members (program_id, user_id) values (:'prog', '${PM.id}');
insert into public.booking_providers (project_id, node_id, list_item_id) values (:'proj', :'bkm', :'item') returning id as pv \\gset
insert into public.booking_slots (project_id, node_id, provider_id, starts_at, ends_at)
  select :'proj', :'bkm', :'pv', date_trunc('hour', now() + interval '5 days') + n * interval '40 minutes', date_trunc('hour', now() + interval '5 days') + n * interval '40 minutes' + interval '30 minutes' from generate_series(1, 40) n;
select s.slug as slug from public.public_links l join public.public_link_slugs s on s.link_id = l.id and s.is_current where l.node_id = :'bkm' and l.kind = 'booking' limit 1 \\gset
commit;
select :'prog' || '|' || :'proj' || '|' || :'bkm' || '|' || :'slug';
`)
  ;[prog, proj, node, slug] = out.split('\n').pop().split('|')
  created.program = prog; created.project = proj
  slots.push(...sql(`select id from public.booking_slots where node_id='${node}' order by starts_at`).split('\n'))
  return slots.length === 40
}

const booker = (n) => ({ name: `Booker ${n}`, email: `zz-cal-verify-${rid}-${n}@example.invalid`, company_name: `Delta ${n}`, lang: 'en', base_url: APP_URL })
async function book(n) {
  const slot = slots[nSlot++]
  const r = await fetch(`${API}/rest/v1/rpc/create_booking`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_ref: slug, p_slot: slot, p_booker: booker(n), p_invite: null }) })
  const b = await json(r)
  if (!b?.booking_id) throw new Error(`create_booking failed: HTTP ${r.status} ${JSON.stringify(b).slice(0, 120)}`)
  return { id: b.booking_id, slot, jobId: jobsOf(b.booking_id, 'calendar_create')[0] }
}

async function main() {
  created.previousMode = sqlOne('select mode from app_private.calendar_sync_config where id')
  created.logStart = Number(sqlOne('select coalesce(max(id), 0) from app_private.calendar_sync_log'))
  await resetFake()
  check('fixtures: a program / project / public booking node with a provider and 40 slots (created under the super_admin\'s own rights)', await fixtures())
  const noJobs = Number(sqlOne(`select count(*) from app_private.integration_jobs where project_id='${proj}'`))
  check('fixtures: no calendar job exists before the first booking', noJobs === 0)

  // ================================================================ 1. the function is a service endpoint
  const anonCall = await fetch(`${API}/functions/v1/calendar-sync`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}' })
  check('the function refuses the public anon key (401 unauthenticated)', anonCall.status === 401, `HTTP ${anonCall.status}`)
  const pmCall = await fetch(`${API}/functions/v1/calendar-sync`, { method: 'POST', headers: H(pmTok), body: '{}' })
  check('... and a signed-in project manager (a valid JWT, but not the service role)', pmCall.status === 401, `HTTP ${pmCall.status}`)
  const noJwt = await fetch(`${API}/functions/v1/calendar-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  check('... and a call without any JWT is stopped by the gateway', noJwt.status === 401, `HTTP ${noJwt.status}`)
  const getCall = await fetch(`${API}/functions/v1/calendar-sync`, { method: 'GET', headers: { apikey: ANON, Authorization: `Bearer ${SERVICE}` } })
  check('... GET is refused (405)', getCall.status === 405, `HTTP ${getCall.status}`)

  // ================================================================ 2. SHADOW: plan and log, zero Google calls
  setMode('shadow')
  const b1 = await book(1)
  const b2 = await book(2)
  check('create_booking (anon, the real RPC) queued a calendar_create job per booking', !!b1.jobId && !!b2.jobId)
  const tSh = await stamp()
  const sh = await runWorker()
  check('SHADOW: the worker reports mode shadow, 2 plans logged, nothing claimed or done', sh.status === 200 && sh.body?.mode === 'shadow' && sh.body?.shadowed === 2 && sh.body?.claimed === 0 && sh.body?.done === 0, JSON.stringify(sh.body))
  const callsSh = await callsSince(tSh)
  check('SHADOW: ZERO Google calls (not even the token endpoint)', callsSh.length === 0, `calls=${callsSh.length}`)
  check('SHADOW: the jobs are untouched (pending, attempts 0, not locked)', job(b1.jobId).status === 'pending' && job(b1.jobId).attempts === 0 && sqlOne(`select locked_until is null from app_private.integration_jobs where id='${b1.jobId}'`) === 't')
  const plan = JSON.parse(sql(`select detail::text from app_private.calendar_sync_log where job_id='${b1.jobId}' and event='shadow'`))
  check('SHADOW: with no Google connection the plan says it would PARK (needs_connection) and still carries the event it would create (hex id, project zone, Meet unique, 2 attendees, summary)', plan.action === 'park' && plan.code === 'needs_connection' && plan.event_id === hex(b1.id) && plan.event?.timeZone === 'Africa/Cairo' && plan.event?.meet === 'unique' && plan.event?.attendee_count === 2 && /^Mentor Session: Delta 1 with Cal Verify Mentor$/.test(plan.event?.summary || ''), JSON.stringify({ a: plan.action, c: plan.code, s: plan.event?.summary }))
  const sh2 = await runWorker()
  check('SHADOW: a second pass logs nothing new (once per job)', sh2.body?.shadowed === 0 && logCount('shadow') === 2)
  const ov = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  const ovB1 = ov.body?.bookings?.find((x) => x.booking_id === b1.id)
  check('the PM\'s Bookings overview shows "shadow" and the plan (no secret in it)', ov.status === 200 && ov.body?.mode === 'shadow' && ovB1?.state === 'shadow' && !!ovB1?.plan && !/token|secret|refresh/i.test(JSON.stringify(ov.body)), `${ov.status} ${ovB1?.state}`)
  const rep = await rpc(saTok, 'get_calendar_sync_report')
  check('the cut-over report (super_admin) counts the shadow plans and the migrated bookings', rep.status === 200 && rep.body?.shadow?.planned >= 2 && rep.body?.bookings?.migrated >= 28, JSON.stringify({ p: rep.body?.shadow?.planned, m: rep.body?.bookings?.migrated }))
  const hb = sqlOne('select last_run_at is not null from app_private.calendar_sync_config where id')
  check('the worker heartbeat (last_run_at) is written on every pass', hb === 't')

  // ================================================================ 3. LIVE without any connection: parked, not failed
  const setLive = await rpc(saTok, 'set_calendar_sync_mode', { p_mode: 'live' })
  check('the super_admin switches to live through PostgREST (previous = shadow, in_flight reported)', setLive.status === 200 && setLive.body?.mode === 'live' && setLive.body?.previous === 'shadow' && typeof setLive.body?.in_flight === 'number', JSON.stringify(setLive.body))
  const pmSet = await rpc(pmTok, 'set_calendar_sync_mode', { p_mode: 'off' })
  check('a project manager cannot change the mode (403)', pmSet.status === 403, `HTTP ${pmSet.status}`)
  const tLv = await stamp()
  const lv = await runWorker()
  check('LIVE with no connection: both jobs are PARKED (no attempt counted), nothing failed', lv.body?.mode === 'live' && lv.body?.claimed === 2 && lv.body?.parked === 2 && lv.body?.dead === 0 && lv.body?.retried === 0, JSON.stringify(lv.body))
  check('... status pending, attempts 0, error needs_connection; ZERO Google calls', job(b1.jobId).status === 'pending' && job(b1.jobId).attempts === 0 && job(b1.jobId).error === 'needs_connection' && (await callsSince(tLv)).length === 0)
  const ov2 = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  check('the Bookings overview says needs_connection', ov2.body?.bookings?.find((x) => x.booking_id === b1.id)?.state === 'needs_connection')
  const shLive = await runWorker()
  check('a parked job is not retried before it is due (15 minutes)', shLive.body?.claimed === 0)

  // ================================================================ 4. Google gets connected -> the parked jobs become due and are created
  const cSA = await connectGoogle(saTok, { email: SA_MAIL })
  check('the node owner (super_admin) connects his Google account through the real OAuth functions (fake Google)', cSA.google === 'connected', JSON.stringify(cSA))
  check('the trigger made the parked jobs due at once (a connection became active)', sqlOne(`select count(*) from app_private.integration_jobs where booking_id in ('${b1.id}','${b2.id}') and next_attempt_at <= now()`) === '2')
  const run1 = await runWorker()
  check('LIVE: both jobs are done', run1.body?.claimed === 2 && run1.body?.done === 2 && run1.body?.errors === 0, JSON.stringify(run1.body))
  const evs = await fakeEvents(SA_MAIL)
  const e1 = evs.find((e) => e.id === hex(b1.id))
  check('exactly ONE event per booking on the node owner\'s calendar; the id is the booking uuid in hex', evs.filter((e) => e.id === hex(b1.id)).length === 1 && evs.filter((e) => e.id === hex(b2.id)).length === 1, `events=${evs.length}`)
  const slot1 = sql(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.booking_slots where id='${b1.slot}'`)
  check('the event time is the slot instant, written in the PROJECT zone (offset + timeZone Africa/Cairo)', Date.parse(e1?.start?.dateTime) === Date.parse(slot1) && /\+0[23]:00$/.test(e1?.start?.dateTime || '') && e1?.start?.timeZone === 'Africa/Cairo' && e1?.end?.timeZone === 'Africa/Cairo', `${e1?.start?.dateTime} ${slot1}`)
  check('attendees: the booker and the provider (server-side), sendUpdates = all, guests cannot modify', JSON.stringify((e1?.attendees || []).map((a) => a.email).sort()) === JSON.stringify([booker(1).email, PROV_MAIL].sort()) && e1?.sendUpdates === 'all' && e1?.guestsCanModify === false, JSON.stringify((e1?.attendees || []).length))
  check('Meet: createRequest with requestId = the booking id', e1?.meetRequestId === b1.id && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(e1?.meetCode || ''))
  const bk1 = bk(b1.id)
  check('the Meet link is written back to the booking; the owner is frozen to the node owner\'s connection; synced_at is set', bk1.meet === `https://meet.google.com/${e1?.meetCode}` && bk1.synced && bk1.owner === conn(SA_MAIL)[0], JSON.stringify({ m: !!bk1.meet, s: bk1.synced }))
  check('the job is done with the action, the event id and the html link (no address)', job(b1.jobId).status === 'done' && job(b1.jobId).action === 'created' && !/@/.test(sqlOne(`select result::text from app_private.integration_jobs where id='${b1.jobId}'`)))
  const conn1 = sql(`select status||'|'||(last_used_at is not null)::text from app_private.google_connections where email::text='${SA_MAIL}'`)
  check('the connection records its use (last_used_at) and stays active', conn1 === 'active|true', conn1)
  const ov3 = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  const o3 = ov3.body?.bookings?.find((x) => x.booking_id === b1.id)
  check('the Bookings overview says synced and names the calendar that holds the event', o3?.state === 'synced' && o3?.calendar_email === SA_MAIL && o3?.event_id === hex(b1.id), `${o3?.state}`)

  // ---- shadow WITH a connection: the plan is a create; switching to live afterwards creates exactly one event
  setMode('shadow')
  const bSh = await book(11)
  const tShC = await stamp()
  const shC = await runWorker()
  const planC = JSON.parse(sql(`select detail::text from app_private.calendar_sync_log where job_id='${bSh.jobId}' and event='shadow'`))
  const callsC = await callsSince(tShC)
  check('SHADOW with a connected node owner: the plan is a CREATE on his calendar (what live will do), ZERO Google calls', shC.body?.shadowed === 1 && planC.action === 'create' && planC.calendar === SA_MAIL && planC.source === 'user' && callsC.length === 0 && job(bSh.jobId).status === 'pending', JSON.stringify({ a: planC.action, cal: planC.calendar, calls: callsC.length }))
  setMode('live')
  const shL = await runWorker()
  check('shadow -> live: the job that was only planned is created exactly once', shL.body?.done === 1 && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(bSh.id)).length === 1)

  // ================================================================ 5. a duplicate job -> ONE event
  sql(`insert into app_private.integration_jobs (kind, project_id, booking_id, idempotency_key, payload) values ('calendar_create', '${proj}', '${b1.id}', 'cal-verify:${rid}:dup', '{}')`)
  const dup = await runWorker()
  const dupJob = sql(`select id from app_private.integration_jobs where idempotency_key='cal-verify:${rid}:dup'`)
  check('DUPLICATE create job: processed, adopted the existing event (409 -> get), still ONE event for the booking', dup.body?.done === 1 && job(dupJob).action === 'adopted' && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b1.id)).length === 1, JSON.stringify(dup.body))

  // ================================================================ 6. reschedule: the SAME event is patched
  const free = slots[nSlot++]
  const resched = await rpc(saTok, 'reschedule_booking', { p_booking: b1.id, p_slot: free })
  check('reschedule_booking (PostgREST) queued a calendar_update job', resched.status === 200 && jobsOf(b1.id, 'calendar_update').length === 1, `HTTP ${resched.status}`)
  const link1 = bk(b1.id).meet
  const run2 = await runWorker()
  const newStart = sql(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.booking_slots where id='${free}'`)
  const e1b = (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(b1.id))
  check('RESCHEDULE: the same event id carries the new time; the Meet link is unchanged; no second event', run2.body?.done === 1 && Date.parse(e1b?.start?.dateTime) === Date.parse(newStart) && bk(b1.id).meet === link1 && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b1.id)).length === 1, `${e1b?.start?.dateTime}`)

  // ================================================================ 7. cancel and restore
  const cancel = await rpc(saTok, 'cancel_booking', { p_booking: b1.id, p_token: null })
  check('cancel_booking queued a calendar_cancel job', cancel.status === 204 || cancel.status === 200, `HTTP ${cancel.status}`)
  const run3 = await runWorker()
  const e1c = (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(b1.id))
  check('CANCEL: the event is cancelled at Google (guests told), the job is done', run3.body?.done === 1 && e1c?.status === 'cancelled' && e1c?.sendUpdates === 'all' && job(lastJob(b1.id)).action === 'deleted')
  const ov4 = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  check('the overview says cancelled', ov4.body?.bookings?.find((x) => x.booking_id === b1.id)?.state === 'cancelled')
  const rest = await rpc(saTok, 'restore_booking', { p_booking: b1.id })
  const run4 = await runWorker()
  const e1d = (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(b1.id))
  check('RESTORE: the deleted event is brought back (status confirmed) with the same id; still ONE event', rest.status < 300 && run4.body?.done === 1 && e1d?.status === 'confirmed' && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b1.id)).length === 1 && job(lastJob(b1.id)).action === 'restored', `${e1d?.status} ${job(lastJob(b1.id)).action}`)

  // ================================================================ 8. HTTP 429 / 500 / the PM's Retry
  const b3 = await book(3)
  await injectFor(b3.id, 'calendar.insert', '429', 1, { retryAfter: 120 })
  const r429 = await runWorker()
  const j3 = job(b3.jobId)
  check('HTTP 429: the job is FAILED (retryable) with the code rate_limited:429', r429.body?.retried === 1 && j3.status === 'failed' && j3.attempts === 1 && j3.error === 'rate_limited:429', JSON.stringify(j3))
  check('... the next attempt honours Retry-After (>= 120 s)', Number(sqlOne(`select extract(epoch from (next_attempt_at - now()))::int from app_private.integration_jobs where id='${b3.jobId}'`)) >= 115)
  check('... and it is not claimed before it is due', (await runWorker()).body?.claimed === 0)
  due(b3.jobId)
  const r429b = await runWorker()
  check('... once due, the retry succeeds with ONE event', r429b.body?.done === 1 && job(b3.jobId).status === 'done' && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b3.id)).length === 1)

  const b4 = await book(4)
  await injectFor(b4.id, 'calendar.insert', '500', 6)
  const delays = []
  for (let i = 1; i <= 6; i += 1) {
    await runWorker()
    const j = job(b4.jobId)
    if (j.status === 'failed') { delays.push(Number(sqlOne(`select extract(epoch from (next_attempt_at - now()))::int from app_private.integration_jobs where id='${b4.jobId}'`))); due(b4.jobId) }
  }
  const j4 = job(b4.jobId)
  check('HTTP 500: exponential backoff (about 30, 60, 120, 240, 480 s with jitter) and DEAD after the 6th attempt, code server_error:500', j4.status === 'dead' && j4.attempts === 6 && j4.error === 'server_error:500' && delays.length === 5 && delays.every((d, i) => d >= 24 * 2 ** i - 6 && d <= 36 * 2 ** i + 6), JSON.stringify({ delays, j4 }))
  check('... no event was created and the booking is untouched', (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b4.id)).length === 0 && bk(b4.id).status === 'confirmed')
  const ov5 = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  const o5 = ov5.body?.bookings?.find((x) => x.booking_id === b4.id)
  check('the overview says failed with the code (the UI offers Retry)', o5?.state === 'failed' && o5?.code === 'server_error:500')
  const retry = await rpc(pmTok, 'retry_calendar_job', { p_booking: b4.id })
  check('the PM\'s Retry (PostgREST, a project member) re-queues the dead job with a fresh attempt counter', retry.status === 200 && retry.body === 1 && job(b4.jobId).status === 'pending' && job(b4.jobId).attempts === 0)
  const run5 = await runWorker()
  check('... and the next pass creates the event (ONE)', run5.body?.done === 1 && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b4.id)).length === 1)

  // ================================================================ 9. TIMEOUT AFTER Google accepted the event
  const b5 = await book(5)
  await injectFor(b5.id, 'calendar.insert', 'timeout-after-accept', 1)
  const t0 = Date.now()
  const rto = await runWorker()
  const j5 = job(b5.jobId)
  check('TIMEOUT AFTER ACCEPT: the first attempt fails with `timeout` (retryable) although Google created the event', rto.body?.retried === 1 && j5.status === 'failed' && j5.error === 'timeout', `${j5.status}/${j5.error} after ${Math.round((Date.now() - t0) / 1000)} s`)
  check('... Google holds exactly one event for it', (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b5.id)).length === 1)
  due(b5.jobId)
  const rto2 = await runWorker()
  check('... the retry gets 409 and ADOPTS the event: no duplicate, the Meet link and owner are written back', rto2.body?.done === 1 && job(b5.jobId).action === 'adopted' && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(b5.id)).length === 1 && /^https:\/\/meet\.google\.com\//.test(bk(b5.id).meet) && bk(b5.id).synced)

  // ================================================================ 10. the system sender + invalid_grant
  const cSys = await connectGoogle(saTok, { system: true, email: SYS_MAIL })
  created.systemLinkedByUs = cSys.google === 'connected'
  check('the super_admin links the system sender (startups@athareg.com) through the real function', cSys.google === 'connected', JSON.stringify(cSys))
  // a booking whose event lives on the node owner's calendar (frozen), then the owner's Google access is revoked
  const bF = await book(6)
  await runWorker()
  check('[setup] booking 6 is synced on the node owner\'s calendar', job(bF.jobId).status === 'done' && bk(bF.id).owner === conn(SA_MAIL)[0])
  await fakeCtl('/__control/revoke-all', { email: SA_MAIL })
  const bNew = await book(7)
  const rig = await runWorker()
  const jNew = job(bNew.jobId)
  check('INVALID_GRANT: the job is PARKED as needs_reconnect (not failed, no attempt used, nothing lost)', rig.body?.parked === 1 && jNew.status === 'pending' && jNew.attempts === 0 && jNew.error === 'needs_reconnect', JSON.stringify({ r: rig.body, j: jNew }))
  check('... and the connection is marked needs_reconnect', conn(SA_MAIL)[1] === 'needs_reconnect')
  due(bNew.jobId)
  const rig2 = await runWorker()
  const sysEvents = await fakeEvents(SYS_MAIL)
  check('... the next pass gives the NEW event to the system sender (startups@): the PM is not usable, a new event may use the fallback', rig2.body?.done === 1 && sysEvents.filter((e) => e.id === hex(bNew.id)).length === 1 && bk(bNew.id).owner === conn(SYS_MAIL)[0], JSON.stringify(rig2.body))
  // the event of booking 6 lives on the owner's calendar: a cancel must WAIT for him, never go to startups@
  await rpc(saTok, 'cancel_booking', { p_booking: bF.id, p_token: null })
  const rfr = await runWorker()
  const cj = lastJob(bF.id)
  check('FROZEN OWNER: the cancel of an event on the (disconnected) owner\'s calendar is PARKED needs_reconnect, not moved to startups@', rfr.body?.parked === 1 && job(cj).status === 'pending' && job(cj).error === 'needs_reconnect' && (await fakeEvents(SYS_MAIL)).filter((e) => e.id === hex(bF.id)).length === 0, JSON.stringify(rfr.body))
  const ov6 = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  check('the overview says needs_connection for it (the PM sees why)', ov6.body?.bookings?.find((x) => x.booking_id === bF.id)?.state === 'needs_connection')
  const cSA2 = await connectGoogle(saTok, { email: SA_MAIL })
  check('the owner reconnects (a new grant): the connection is active again', cSA2.google === 'connected' && conn(SA_MAIL)[1] === 'active', JSON.stringify(cSA2))
  check('... the parked cancel became due at once (trigger)', sqlOne(`select next_attempt_at <= now() from app_private.integration_jobs where id='${cj}'`) === 't')
  const rfr2 = await runWorker()
  check('... and runs now: the event on the owner\'s calendar is cancelled', rfr2.body?.done >= 1 && (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(bF.id))?.status === 'cancelled')

  // ================================================================ 11. a MIGRATED booking is never created again; update / cancel act on the legacy event
  const bM = await book(8)
  const legacyId = `v${hex(crypto.randomUUID()).slice(0, 24)}`.replace(/[^a-v0-9]/g, 'a')
  // the Apps Script poller "created" the event on startups@'s calendar: seed it at the fake with the system connection's own access (through a fresh consent-free refresh)
  const st = await fakeState()
  const sysRefresh = st.refreshTokens.filter((x) => x.email === SYS_MAIL && !x.revoked).map((x) => x.token).pop()
  const tokRes = await fetch(`${FAKE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sysRefresh, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }) })
  const sysAccess = (await json(tokRes))?.access_token
  const seed = await fetch(`${FAKE}/calendar/v3/calendars/primary/events?sendUpdates=none`, { method: 'POST', headers: { authorization: `Bearer ${sysAccess}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: legacyId, summary: 'legacy', start: { dateTime: '2026-07-01T10:00:00+03:00', timeZone: 'Africa/Cairo' }, end: { dateTime: '2026-07-01T10:30:00+03:00', timeZone: 'Africa/Cairo' } }) })
  check('[setup] the legacy event exists on the system calendar (as the poller left it)', seed.status === 200, `HTTP ${seed.status}`)
  sql(`update public.bookings set legacy_calendar_event_id='${legacyId}', meet_link='https://meet.google.com/old-link-xyz' where id='${bM.id}'`)
  const tM = await stamp()
  const rm = await runWorker()
  const callsM = await callsSince(tM)
  check('MIGRATED: its create job is SKIPPED (skipped_migrated): never created again, zero Google calls', rm.body?.skipped === 1 && job(bM.jobId).action === 'skipped_migrated' && callsM.length === 0 && bk(bM.id).meet === 'https://meet.google.com/old-link-xyz', JSON.stringify({ r: rm.body, j: job(bM.jobId), calls: callsM.slice(0, 3).map((c) => `${c.method} ${c.path}`), meet: bk(bM.id).meet }))
  const ovM = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  const oM = ovM.body?.bookings?.find((x) => x.booking_id === bM.id)
  check('the overview says migrated and names the system calendar', oM?.state === 'migrated' && oM?.calendar_email === SYS_MAIL, `${oM?.state}/${oM?.calendar_email}`)
  const slotM = slots[nSlot++]
  await rpc(saTok, 'reschedule_booking', { p_booking: bM.id, p_slot: slotM })
  await runWorker()
  const lev = (await fakeEvents(SYS_MAIL)).find((e) => e.id === legacyId)
  const newM = sql(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.booking_slots where id='${slotM}'`)
  check('MIGRATED reschedule: the LEGACY event is patched on the system calendar (same id, new time); the migrated link is kept', Date.parse(lev?.start?.dateTime) === Date.parse(newM) && bk(bM.id).meet === 'https://meet.google.com/old-link-xyz' && (await fakeEvents(SA_MAIL)).filter((e) => e.id === hex(bM.id)).length === 0)
  await rpc(saTok, 'cancel_booking', { p_booking: bM.id, p_token: null })
  await runWorker()
  check('MIGRATED cancel: the legacy event is deleted on the system calendar', (await fakeEvents(SYS_MAIL)).find((e) => e.id === legacyId)?.status === 'cancelled')
  check('the 28 real migrated bookings were never touched (no job, nothing synced by this run)', Number(sqlOne(`select count(*) from app_private.integration_jobs j join public.bookings b on b.id = j.booking_id where b.legacy_calendar_event_id is not null and b.project_id <> '${proj}'`)) === 0 && Number(sqlOne(`select count(*) from public.bookings where calendar_synced_at is not null and project_id <> '${proj}'`)) === 0)

  // ================================================================ 12. shared Meet mode with an EMPTY link: a permanent error, zero Google calls
  sql(`update public.booking_settings set meeting_link_mode='shared', shared_meet_link='' where node_id='${node}'`)
  const bS = await book(9)
  const tS = await stamp()
  const rs = await runWorker()
  const callsS = await callsSince(tS)
  check('SHARED mode with an EMPTY link: the job is dead with shared_link_required (never a silent unique link), zero Google calls', rs.body?.dead === 1 && job(bS.jobId).status === 'dead' && job(bS.jobId).error === 'shared_link_required' && callsS.length === 0, JSON.stringify({ r: rs.body, j: job(bS.jobId), calls: callsS.slice(0, 3).map((c) => `${c.method} ${c.path}`) }))
  sql(`update public.booking_settings set shared_meet_link='https://meet.google.com/abc-defg-hij' where node_id='${node}'`)
  await rpc(pmTok, 'retry_calendar_job', { p_booking: bS.id })
  const rs2 = await runWorker()
  const eS = (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(bS.id))
  check('SHARED mode with the link set and Retry: the node link is in location + description, no conference request, the booking keeps the link', rs2.body?.done === 1 && eS?.location === 'https://meet.google.com/abc-defg-hij' && !eS?.meetRequestId && /abc-defg-hij/.test(eS?.description || ''), JSON.stringify(rs2.body))
  sql(`update public.booking_settings set meeting_link_mode='unique', shared_meet_link=null where node_id='${node}'`)

  // ================================================================ 13. OFF claims nothing; a cc / admin list becomes attendees; the report
  setMode('off')
  const bO = await book(10)
  const tO = await stamp()
  const ro = await runWorker()
  const callsO = await callsSince(tO)
  check('OFF: nothing is claimed, planned or called', ro.body?.mode === 'off' && ro.body?.claimed === 0 && ro.body?.shadowed === 0 && callsO.length === 0 && job(bO.jobId).status === 'pending', JSON.stringify({ r: ro.body, j: job(bO.jobId).status, calls: callsO.slice(0, 3).map((c) => `${c.method} ${c.path}`) }))
  const ovO = await rpc(pmTok, 'get_calendar_sync_overview', { p_node: node })
  check('the overview says off', ovO.body?.bookings?.find((x) => x.booking_id === bO.id)?.state === 'off')
  sql(`update public.nodes set config = config || jsonb_build_object('emails', coalesce(config->'emails', '{}'::jsonb) || jsonb_build_object('booking_confirmation', '{"cc":["Cc.Team@athareg.com","bad address"],"admin":["admin.${rid}@athareg.com","cc.team@athareg.com"]}'::jsonb)) where id='${node}'`)
  setMode('live')
  const rl = await runWorker()
  const eO = (await fakeEvents(SA_MAIL)).find((e) => e.id === hex(bO.id))
  check('back to LIVE: the waiting job runs exactly once; the node\'s cc / admin lists are attendees (lower-cased, de-duplicated, the invalid address dropped)', rl.body?.done === 1 && JSON.stringify((eO?.attendees || []).map((a) => a.email).sort()) === JSON.stringify([booker(10).email, PROV_MAIL, 'cc.team@athareg.com', `admin.${rid}@athareg.com`].sort()), JSON.stringify((eO?.attendees || []).map((a) => a.email)))
  const finalRep = await rpc(saTok, 'get_calendar_sync_report')
  check('the report: live, the system sender active, jobs counted, the heartbeat recent', finalRep.body?.mode === 'live' && finalRep.body?.connections?.system === 'active' && finalRep.body?.jobs?.dead >= 0 && !!finalRep.body?.last_run_at)

  // ================================================================ 14. logs and rows carry no secret
  let logs = ''
  try { logs = execSync(`docker logs --since ${created.startedAt} supabase_edge_runtime_stack 2>&1`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch (e) { logs = `${e.stdout ?? ''}${e.stderr ?? ''}` }
  const calLines = logs.split('\n').filter((l) => /calendar_(job|sync|shadow)/.test(l))
  check('the function logged what it did (job id, kind, action, outcome, reason)', calLines.length > 10 && calLines.some((l) => /"outcome":"created"/.test(l)) && calLines.some((l) => /"reason":"rate_limited:429"/.test(l)), `${calLines.length} lines`)
  const refreshTokens = (await fakeState()).refreshTokens.map((x) => x.token)
  const leaks = calLines.filter((l) => /Bearer|1\/\/0fake|access_token|refresh_token|ya29|@(athareg\.com|example\.invalid)/i.test(l) || refreshTokens.some((t) => t.length > 20 && l.includes(t)))
  check('... and NO log line carries a token, a secret or an e-mail address', leaks.length === 0, `${leaks.length} suspicious lines`)
  const dbLeaks = Number(sqlOne(`select count(*) from app_private.integration_jobs j where j.project_id='${proj}' and (coalesce(j.error,'') ~ '[@ ]' or j.result::text ~* '(token|secret|refresh|bearer)')`))
  check('the job rows hold codes and counts only (no message, no address, no token)', dbLeaks === 0, `${dbLeaks}`)
  check('the sync log holds no token / secret', Number(sqlOne(`select count(*) from app_private.calendar_sync_log where detail::text ~* '(token|secret|refresh|bearer|authorization)'`)) === 0)
}

// ------------------------------------------------------------------------------------------------------------------------ cleanup
async function cleanup() {
  try {
    if (created.previousMode) sql(`update app_private.calendar_sync_config set mode='${created.previousMode}', last_run_at = null, last_run_summary = null, updated_at = now() where id`)
  } catch (e) { lines.push(`WARN  could not restore the mode: ${String(e.message).slice(0, 100)}`) }
  // every step on its own: one failing statement must not leave the rest of the fixture behind
  const step = (label, q) => { try { sql(q) } catch (e) { lines.push(`WARN  cleanup (${label}): ${String(e.message).slice(0, 120)}`) } }
  if (created.project) {
    step('jobs', `delete from app_private.integration_jobs where project_id='${created.project}'`)
    step('outbox', `delete from app_private.email_outbox where project_id='${created.project}'`)
    step('bookings', `delete from public.bookings where project_id='${created.project}'`)
    step('slots', `delete from public.booking_slots where project_id='${created.project}'`)
    step('providers', `delete from public.booking_providers where project_id='${created.project}'`)
  }
  if (created.program) {
    step('projects', `delete from public.projects where program_id='${created.program}'`)
    step('program', `delete from public.programs where id='${created.program}'`)
  }
  step('expert', `delete from public.network_experts where email::text = 'mentor.${rid}@example.invalid'`)
  step('log', `delete from app_private.calendar_sync_log where id > ${created.logStart} and event = 'mode_changed' and (actor is null or actor in (${created.userIds.map((u) => `'${u}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"}))`)
  // connections (the user ones, and the system one WE linked), their Vault secrets, then the users
  try {
    const mine = created.emails.map((e) => `'${e}'`).join(',')
    const list = [mine, created.systemLinkedByUs ? `'${SYS_MAIL}'` : ''].filter(Boolean).join(',')
    if (list) {
      const ids = sql(`select id from app_private.google_connections where email::text in (${list})`).split('\n').filter(Boolean)
      for (const id of ids) sql(`delete from vault.secrets where name = 'google-refresh-token:${id}'`)
      sql(`delete from app_private.google_connections where email::text in (${list})`)
    }
  } catch (e) { lines.push(`WARN  cleanup of connection rows: ${String(e.message).slice(0, 120)}`) }
  for (const id of created.userIds) {
    try {
      const r = await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })
      if (r.status >= 300) lines.push(`WARN  could not delete a throwaway user (HTTP ${r.status})`)
    } catch (e) { lines.push(`WARN  could not delete a throwaway user: ${String(e.message).slice(0, 80)}`) }
  }
}

// The scenarios need to control the system sender (no connection at all, then startups@ as the fallback): refuse when another task holds one.
if (Number(sqlOne("select count(*) from app_private.google_connections where kind = 'system'")) > 0) { console.error('refusing: a system Google connection already exists (another task is using the local stack): this script links and removes its own startups@ sender, run it when the others are done'); process.exit(2) }
try {
  await main()
} catch (e) {
  check('script error', false, String(e?.message || e).slice(0, 400))
} finally {
  await cleanup()
}
const left = {
  users: Number(sqlOne("select count(*) from auth.users where email like 'cal-verify-%'")),
  connections: Number(sqlOne("select count(*) from app_private.google_connections where email::text like 'cal-verify-%'" + (created.systemLinkedByUs ? " or kind = 'system'" : ''))),
  vault: Number(sqlOne("select count(*) from vault.secrets where name like 'google-refresh-token:%' and name not in (select 'google-refresh-token:' || id::text from app_private.google_connections)")),
  jobs: Number(sqlOne("select count(*) from app_private.integration_jobs where idempotency_key like 'cal-verify:%' or project_id in (select id from public.projects where name_en like 'CAL VERIFY PROJECT%')")),
  programs: Number(sqlOne("select count(*) from public.programs where name_en like 'CAL VERIFY%'")),
  mode: sqlOne('select mode from app_private.calendar_sync_config where id'),
}
check('cleanup: no throwaway user, program, job, connection or Vault secret is left; the mode is restored', left.users === 0 && left.programs === 0 && left.jobs === 0 && left.connections === 0 && left.vault === 0 && left.mode === created.previousMode, JSON.stringify(left))
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
