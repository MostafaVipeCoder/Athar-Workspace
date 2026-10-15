#!/usr/bin/env node
// v78_concurrency.mjs - the TRUE two-session races of the experts registry (m78): a list item that is added while a merge / a delete of its expert is still open.
// db/verify/v78_network_experts_review_fixes.sql proves the semantics inside one rolled-back transaction; this proves them under real concurrency with two
// database connections (two `docker exec psql` processes), which a single session cannot.
//
//   node db/verify/v78_concurrency.mjs
//
// It COMMITS throwaway rows (a user, a program / project / list and four experts, every name starts with "V78C") and removes them in a finally block. It prints no
// secret and no personal data. Exit code 0 = every check passed.
import { spawn } from 'node:child_process'

const DB = 'supabase_db_stack'
let pass = 0
let fail = 0
const lines = []
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`) }

/** One psql session: `sql` goes to stdin, stdout comes back (unaligned, tuples only). Resolves { out, err, ms, code }. */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const U = '00000000-0000-4000-8000-00000000c780' // the throwaway super_admin
const P = '00000000-0000-4000-8000-00000000c781' // program
const J = '00000000-0000-4000-8000-00000000c782' // project
const N = '00000000-0000-4000-8000-00000000c783' // list node
const K = '00000000-0000-4000-8000-00000000c791' // keep
const D = '00000000-0000-4000-8000-00000000c792' // duplicate (merged into K)
const X = '00000000-0000-4000-8000-00000000c793' // deleted
const claims = `select set_config('request.jwt.claims', '{"sub":"${U}","role":"authenticated"}', true);`

async function cleanup() {
  await one(`
    delete from public.list_items where project_id = '${J}';
    delete from app_private.network_expert_merges where keep_id in ('${K}', '${D}', '${X}') or drop_id in ('${K}', '${D}', '${X}');
    delete from public.network_experts where id in ('${K}', '${D}', '${X}');
    delete from public.nodes where id = '${N}';
    delete from public.projects where id = '${J}';
    delete from public.program_members where program_id = '${P}';
    delete from public.programs where id = '${P}';
    delete from public.user_roles where user_id = '${U}';
    delete from auth.users where id = '${U}';`)
}

async function setup() {
  await cleanup()
  await one(`
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${U}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-v78c@example.invalid', '{"provisioned":true}', '{"full_name":"V78C Admin"}', now(), now());
    insert into public.user_roles (user_id, role_key) values ('${U}', 'super_admin');
    insert into public.programs (id, name_en) values ('${P}', 'V78C Program');
    insert into public.projects (id, program_id, name_en) values ('${J}', '${P}', 'V78C Project');
    insert into public.nodes (id, project_id, type, name_en, config) values ('${N}', '${J}', 'list', 'V78C List', '{"subkind":"expert"}');
    insert into public.network_experts (id, kind, name_en) values ('${K}', 'expert', 'V78C Keep Person Qzx'), ('${D}', 'expert', 'V78C Duplicate Person Wvu'), ('${X}', 'expert', 'V78C Removed Person Rtk');`)
}

async function main() {
  await setup()

  // ------------------------------------------------------------------------------------------------ 1. a merge is open, a list item for the duplicate is added meanwhile
  const a = psql(`begin; ${claims} select public.merge_network_experts('${K}', '${D}', false) is not null; select pg_sleep(4); commit;`)
  await sleep(1200)
  const b = await psql(`insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id) values ('${J}', '${N}', 'network_expert', '${D}') returning network_expert_id;`)
  const ra = await a
  check('1a the merge session committed', ra.code === 0, ra.err.slice(0, 120))
  check('1b the insert of the stale picker WAITED for the open merge (>= 2.5 s)', b.ms >= 2500, `${b.ms} ms`)
  check('1c ... and then followed the redirect: the item points at the KEPT record, not at the soft-deleted duplicate', b.out.split('\n')[0] === K, b.err.slice(0, 120) || b.out.split('\n')[0])
  const dup = await one(`select deleted_at is not null and merged_into = '${K}' from public.network_experts where id = '${D}';`)
  check('1d the duplicate is soft-deleted and merged into K', dup === 't')
  const orphan = await one(`select count(*) from public.list_items li join public.network_experts ne on ne.id = li.network_expert_id where ne.deleted_at is not null and li.project_id = '${J}';`)
  check('1e no list item of the project points at a soft-deleted expert', orphan === '0', orphan)

  // ------------------------------------------------------------------------------------------------ 2. a delete is open, a list item for the expert is added meanwhile
  await one(`delete from public.list_items where project_id = '${J}';`)
  const c = psql(`begin; ${claims} select public.delete_network_expert('${X}') is not null; select pg_sleep(4); commit;`)
  await sleep(1200)
  const d = await psql(`insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id) values ('${J}', '${N}', 'network_expert', '${X}') returning id;`)
  const rc = await c
  check('2a the delete session committed', rc.code === 0, rc.err.slice(0, 120))
  check('2b the insert WAITED for the open delete (>= 2.5 s)', d.ms >= 2500, `${d.ms} ms`)
  check('2c ... and was REFUSED (expert_unavailable): no item points at the deleted expert', d.code !== 0 && /expert_unavailable/.test(d.err), (d.err || d.out).slice(0, 120))
  const left = await one(`select count(*) from public.list_items where network_expert_id = '${X}';`)
  check('2d nothing was inserted', left === '0', left)

  // ------------------------------------------------------------------------------------------------ 3. a profile edit does not block the picker (the lock is only a KEY SHARE)
  await one(`delete from public.list_items where project_id = '${J}';`)
  const e = psql(`begin; ${claims} select public.update_network_expert('${K}', '{"title_en":"V78C concurrent edit"}'::jsonb) is not null; select pg_sleep(3); commit;`)
  await sleep(1000)
  const f = await psql(`insert into public.list_items (project_id, list_node_id, source_kind, network_expert_id) values ('${J}', '${N}', 'network_expert', '${K}') returning network_expert_id;`)
  await e
  check('3 adding a list item for an expert whose profile is being edited does not wait for the edit (< 1.5 s)', f.code === 0 && f.ms < 1500, `${f.ms} ms`)
}

try {
  await main()
} catch (err) {
  check('the run itself', false, String(err.message ?? err).slice(0, 200))
} finally {
  try { await cleanup() } catch (err) { check('cleanup', false, String(err.message ?? err).slice(0, 200)) }
}
console.log(lines.join('\n'))
console.log(`\nv78 concurrency: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
