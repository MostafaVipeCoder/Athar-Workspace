#!/usr/bin/env node
// v63_calendar_concurrency.mjs - the TRUE two-session race of the calendar job queue (m63): two real database connections (two `docker exec psql`
// processes) claiming / completing the same jobs at the same moment. db/verify/v63_calendar_sync.sql proves the semantics inside one rolled-back
// transaction; this proves them under real concurrency (SKIP LOCKED, the lease, the attempt fence), which a single session cannot.
//
//   node db/verify/v63_calendar_concurrency.mjs
//
// It COMMITS throwaway rows (jobs with booking_id NULL and the key prefix `v63c:` on one existing project, never touching a booking) and flips
// calendar_sync_mode to `live` for a few seconds (the claim only works in live), then deletes the jobs and restores the previous mode in a finally
// block. It prints no secret and no personal data. Exit code 0 = every check passed.
import { spawn } from 'node:child_process'

const DB = 'supabase_db_stack'
let pass = 0
let fail = 0
const lines = []
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`) }

/** One psql session: `sql` goes to stdin, stdout comes back (unaligned, tuples only). Resolves { out, ms, code }. */
function psql(sql) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ out: out.trim(), err: err.trim(), ms: Date.now() - t0, code }))
    p.stdin.end(sql)
  })
}
const one = async (sql) => {
  const r = await psql(sql)
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.slice(0, 300)}`)
  return r.out
}
/** wait (inside the session) until the wall-clock instant T (epoch seconds) so two sessions start together */
const until = (t) => `select pg_sleep(greatest(0, ${t} - extract(epoch from clock_timestamp())));`
const ids = (s) => s.split('\n').filter((l) => /^[0-9a-f-]{36}$/.test(l.trim())).map((l) => l.trim())

const RUN = `r${Date.now().toString(36)}`
let previousMode = null

async function setup(count) {
  await one(`delete from app_private.integration_jobs where idempotency_key like 'v63c:%';`)
  await one(`insert into app_private.integration_jobs (kind, project_id, booking_id, idempotency_key, created_at, next_attempt_at)
    select 'calendar_create', (select id from public.projects order by created_at limit 1), null, 'v63c:${RUN}:' || n, now() - make_interval(secs => ${count} - n + 100), now() - interval '10 years' + make_interval(secs => n)
      from generate_series(1, ${count}) n;`)
}
const mineSql = `(x->>'id')::uuid in (select id from app_private.integration_jobs where idempotency_key like 'v63c:${RUN}:%')`
const claimIds = (limit) => `select x->>'id' from public.calendar_claim_jobs(${limit}, 300) x where ${mineSql};`
const reset = (n) => one(`update app_private.integration_jobs set status = 'pending', attempts = 0, locked_until = null, error = null, result = null where idempotency_key like 'v63c:${RUN}:%'${n ? '' : ''};`)

async function main() {
  previousMode = await one(`select mode from app_private.calendar_sync_config where id;`)
  await one(`update app_private.calendar_sync_config set mode = 'live' where id;`)

  // ---------------------------------------------------------------------------------------------------------------- 1. overlapping claims never share a job
  await setup(24)
  let t = Date.now() / 1000 + 2.5
  const a = psql(`begin;\n${until(t)}\n${claimIds(12)}\nselect pg_sleep(3);\ncommit;`) // A holds its 12 jobs (uncommitted) for 3 s
  await new Promise((r) => setTimeout(r, 1)) // both are launched before the barrier opens; B starts 0.7 s after A's claim
  t = Date.now() / 1000 + 3.2
  const b = psql(`begin;\n${until(t)}\n${claimIds(12)}\ncommit;`)
  const [ra, rb] = await Promise.all([a, b])
  const A = ids(ra.out)
  const B = ids(rb.out)
  check('overlap: session A claimed 12 jobs while holding them uncommitted', A.length === 12, `A=${A.length}`)
  check('overlap: session B, started while A still held its row locks, claimed the OTHER 12 (SKIP LOCKED)', B.length === 12, `B=${B.length}`)
  check('overlap: no job was claimed by both sessions; together they cover all 24', new Set([...A, ...B]).size === 24 && A.every((x) => !B.includes(x)))
  check('overlap: every job is processing with attempts = 1 and a lease', Number(await one(`select count(*) from app_private.integration_jobs where idempotency_key like 'v63c:${RUN}:%' and status = 'processing' and attempts = 1 and locked_until > now();`)) === 24)

  // ---------------------------------------------------------------------------------------------------------------- 2. a session that finds everything locked does NOT wait
  await reset()
  t = Date.now() / 1000 + 2.5
  const holder = psql(`begin;\n${until(t)}\n${claimIds(24)}\nselect pg_sleep(4);\ncommit;`)
  t = Date.now() / 1000 + 3.3
  const nowait = await psql(`begin;\n${until(t)}\nselect clock_timestamp();\n${claimIds(24)}\nselect clock_timestamp();\ncommit;`)
  const stamps = nowait.out.split('\n').filter((l) => /^\d{4}-\d\d-\d\d /.test(l)).map((l) => Date.parse(l.replace(' ', 'T').replace(/\+(\d\d)$/, '+$1:00')))
  const held = await holder
  check('lock-all: the holder claimed all 24 jobs', ids(held.out).length === 24, `${ids(held.out).length}`)
  check('lock-all: the second session got 0 jobs and did NOT block on the holder (claim time < 1.5 s while the holder slept 4 s)', ids(nowait.out).length === 0 && stamps.length === 2 && stamps[1] - stamps[0] < 1500, `${stamps.length === 2 ? stamps[1] - stamps[0] : '?'} ms`)

  // ---------------------------------------------------------------------------------------------------------------- 3. two sessions racing for ONE job: exactly one wins, 12 rounds
  let wrong = 0
  const rounds = 12
  for (let i = 0; i < rounds; i += 1) {
    await setup(1)
    const T = Date.now() / 1000 + 1.8
    const [x, y] = await Promise.all([psql(`${until(T)}\nselect count(*) from public.calendar_claim_jobs(1, 300) x where ${mineSql};`), psql(`${until(T)}\nselect count(*) from public.calendar_claim_jobs(1, 300) x where ${mineSql};`)])
    const total = Number(x.out) + Number(y.out)
    if (total !== 1) wrong += 1
  }
  check(`race: ${rounds} rounds of two sessions claiming the SAME single job at the same instant: exactly one won every time`, wrong === 0, `${wrong} bad rounds`)
  check('race: the job was claimed once (attempts = 1)', Number(await one(`select attempts from app_private.integration_jobs where idempotency_key like 'v63c:${RUN}:%' limit 1;`)) === 1)

  // ---------------------------------------------------------------------------------------------------------------- 4. two sessions completing the same job: one true, one false
  let badComplete = 0
  for (let i = 0; i < 6; i += 1) {
    await setup(1)
    await one(`update app_private.integration_jobs set status = 'processing', attempts = 1, locked_until = now() + interval '5 minutes' where idempotency_key like 'v63c:${RUN}:%';`)
    const job = await one(`select id from app_private.integration_jobs where idempotency_key like 'v63c:${RUN}:%';`)
    const T = Date.now() / 1000 + 1.8
    const sqlC = `${until(T)}\nselect public.calendar_complete_job('${job}', 1, '{"action":"created"}'::jsonb, null, null);`
    const [x, y] = await Promise.all([psql(sqlC), psql(sqlC)])
    const wins = [x.out, y.out].filter((o) => o === 't').length
    if (wins !== 1) badComplete += 1
  }
  check('race: two sessions completing the same job at the same instant: exactly one true, the other false (the row lock + the attempt fence)', badComplete === 0, `${badComplete} bad rounds`)

  // ---------------------------------------------------------------------------------------------------------------- 5. the fence under real concurrency: a stale worker finishes after another took over
  await setup(1)
  const claimed1 = ids(await one(claimIds(1)))
  check('fence: worker A claimed the job (attempt 1)', claimed1.length === 1)
  const job1 = claimed1[0]
  await one(`update app_private.integration_jobs set locked_until = now() - interval '1 minute' where id = '${job1}';`) // A's lease expires (A is slow / dead)
  const reclaimed = (await one(`select x->>'attempts' from public.calendar_claim_jobs(1, 300) x where ${mineSql};`)).trim()
  check('fence: worker B reclaimed the expired job (attempt 2)', reclaimed === '2', reclaimed)
  const late = await one(`select public.calendar_complete_job('${job1}', 1, '{"action":"created"}'::jsonb, 'https://meet.google.com/stale-lnk-xyz', null);`)
  check('fence: the stale worker A (attempt 1) cannot complete the job B owns', late === 'f', late)
  const lateFail = await one(`select public.calendar_fail_job('${job1}', 1, 'late', true, 1)->>'reason';`)
  check('fence: ... nor fail it (lease_lost)', lateFail === 'lease_lost', lateFail)
  const done = await one(`select public.calendar_complete_job('${job1}', 2, '{"action":"created"}'::jsonb, null, null);`)
  check('fence: worker B completes it', done === 't', done)

  // ---------------------------------------------------------------------------------------------------------------- 6. the mode gate under concurrency: off / shadow claim nothing even with 24 due jobs
  await setup(24)
  for (const mode of ['off', 'shadow']) {
    await one(`update app_private.calendar_sync_config set mode = '${mode}' where id;`)
    const T = Date.now() / 1000 + 1.8
    const [x, y] = await Promise.all([psql(`${until(T)}\n${claimIds(24)}`), psql(`${until(T)}\n${claimIds(24)}`)])
    check(`mode ${mode}: two concurrent workers claim nothing`, ids(x.out).length + ids(y.out).length === 0)
  }
}

try {
  await main()
} catch (e) {
  fail++
  lines.push(`FAIL  unexpected error  [${String(e.message).slice(0, 200)}]`)
} finally {
  try {
    await one(`delete from app_private.integration_jobs where idempotency_key like 'v63c:%';`)
    if (previousMode) await one(`update app_private.calendar_sync_config set mode = '${previousMode}' where id;`)
    const left = Number(await one(`select count(*) from app_private.integration_jobs where idempotency_key like 'v63c:%';`))
    const mode = await one(`select mode from app_private.calendar_sync_config where id;`)
    check('cleanup: no throwaway job left, the mode is back to what it was', left === 0 && mode === previousMode, `jobs=${left} mode=${mode}`)
  } catch (e) {
    fail++
    lines.push(`FAIL  cleanup failed  [${String(e.message).slice(0, 200)}]: delete the v63c: jobs and restore calendar_sync_mode by hand`)
  }
  console.log(lines.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
