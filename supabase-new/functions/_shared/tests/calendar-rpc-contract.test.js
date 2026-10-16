// The JS adapter (calendar-sync.js createCalendarDb) and the SQL (db/migrations/m63_calendar_sync.sql) must agree on every service-role RPC: name, argument
// names and order, and who may execute it. db/verify/v63 proves the SQL side against the live database; this test needs no database.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CALENDAR_RPC_CONTRACT } from '../calendar-sync.js'

const sql = readFileSync(fileURLToPath(new URL('../../../../db/migrations/m63_calendar_sync.sql', import.meta.url)), 'utf8')
const CLIENT_RPCS = ['get_calendar_sync_mode', 'set_calendar_sync_mode', 'get_calendar_sync_overview', 'get_calendar_sync_report', 'retry_calendar_job']

function signature(name) {
  const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`, 'i').exec(sql)
  assert.ok(m, `public.${name} is not defined in m63`)
  return m[1].split(',').map((a) => a.trim()).filter(Boolean).map((a) => a.split(/\s+/)[0])
}
function body(name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'))
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start) + 5)
  return sql.slice(start, end + 3)
}

describe('RPC contract: JS adapter vs m63', () => {
  for (const [name, args] of Object.entries(CALENDAR_RPC_CONTRACT)) {
    test(`public.${name}(${args.join(', ')})`, () => {
      assert.deepEqual(signature(name), args)
    })
  }

  test('every worker RPC is granted to service_role only (revoked from public / anon / authenticated); the client RPCs to authenticated, never to anon', () => {
    const grants = sql.slice(sql.indexOf('7. grants'))
    for (const name of Object.keys(CALENDAR_RPC_CONTRACT)) assert.ok(new RegExp(`'public\\.${name}\\(`).test(grants), `${name} is not in the grant block`)
    assert.ok(/revoke all on function %s from public, anon, authenticated', f\);\s+execute format\('grant execute on function %s to service_role', f\)/.test(grants))
    for (const name of CLIENT_RPCS) assert.ok(new RegExp(`'public\\.${name}\\(`).test(grants), `${name} is not in the grant block`)
    assert.ok(/revoke all on function %s from public, anon', f\);\s+execute format\('grant execute on function %s to authenticated', f\)/.test(grants))
  })

  test('every public function of m63 is SECURITY DEFINER with an empty search_path', () => {
    for (const name of [...Object.keys(CALENDAR_RPC_CONTRACT), ...CLIENT_RPCS]) assert.match(body(name), /security definer set search_path = ''/i, name)
  })

  test('no worker RPC compares auth.role() with <> (a NULL role would pass): privileges are the gate', () => {
    for (const name of Object.keys(CALENDAR_RPC_CONTRACT)) assert.ok(!/auth\.role\(\)\s*<>/.test(body(name)), name)
  })

  test('no client RPC can name a secret-bearing column', () => {
    for (const name of CLIENT_RPCS) {
      const b = body(name).toLowerCase()
      for (const word of ['vault_secret_id', 'ciphertext', 'google_sub', 'token_storage', 'decrypted', 'vault.', 'refresh']) assert.ok(!b.includes(word), `${name} mentions ${word}`)
    }
  })
})
