// The JS adapter (google-edge.js) and the SQL (db/migrations/m61_google_oauth.sql) must agree on every service-role RPC: name, argument names and
// order, and who may execute it. db/verify/v61 proves the SQL side against the live database; this test needs no database.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RPC_CONTRACT } from '../google-edge.js'

const sql = readFileSync(fileURLToPath(new URL('../../../../db/migrations/m61_google_oauth.sql', import.meta.url)), 'utf8')

function signature(name) {
  const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`, 'i').exec(sql)
  assert.ok(m, `public.${name} is not defined in m61`)
  return m[1].split(',').map((a) => a.trim()).filter(Boolean).map((a) => a.split(/\s+/)[0])
}
function body(name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'))
  const end = sql.indexOf('end $$;', start)
  const end2 = sql.indexOf('$$;', start)
  return sql.slice(start, Math.min(...[end, end2].filter((x) => x > 0)) + 8)
}

describe('RPC contract: JS adapter vs m61', () => {
  for (const [name, args] of Object.entries(RPC_CONTRACT)) {
    test(`public.${name}(${args.join(', ')})`, () => {
      assert.deepEqual(signature(name), args)
    })
  }

  test('every service-role RPC is granted to service_role and revoked from anon / authenticated / public; client RPCs only to authenticated', () => {
    const grantBlock = sql.slice(sql.indexOf('5. grants'))
    const serviceList = grantBlock.slice(grantBlock.indexOf('foreach f in array array[', grantBlock.indexOf("revoke all on function %s from public, anon, authenticated', f);") - 1200))
    for (const name of Object.keys(RPC_CONTRACT)) {
      assert.ok(new RegExp(`'public\\.${name}\\(`).test(grantBlock), `${name} is not in the grant block`)
    }
    assert.ok(/execute format\('grant execute on function %s to service_role', f\)/.test(serviceList))
    for (const client of ['list_my_google_connections', 'get_google_connection_status', 'list_google_connections_admin']) {
      assert.ok(new RegExp(`'public\\.${client}\\(\\)'`).test(grantBlock))
    }
    assert.ok(/grant execute on function %s to authenticated/.test(grantBlock))
  })

  test('every public function of m61 is SECURITY DEFINER with an empty search_path', () => {
    for (const name of [...Object.keys(RPC_CONTRACT), 'list_my_google_connections', 'get_google_connection_status', 'list_google_connections_admin']) {
      const b = body(name)
      assert.match(b, /security definer set search_path = ''/i, name)
    }
  })

  test('the client RPCs can never name a secret-bearing column', () => {
    for (const name of ['list_my_google_connections', 'get_google_connection_status', 'list_google_connections_admin']) {
      const b = body(name).toLowerCase()
      for (const word of ['vault_secret_id', 'ciphertext', 'google_sub', 'token_storage', 'decrypted', 'vault.', 'refresh']) assert.ok(!b.includes(word), `${name} mentions ${word}`)
    }
    const view = sql.slice(sql.indexOf('create or replace view public.my_google_connection'))
    const viewBody = view.slice(0, view.indexOf(';')).toLowerCase()
    for (const word of ['vault_secret_id', 'ciphertext', 'google_sub', 'token_storage']) assert.ok(!viewBody.includes(word), `the view mentions ${word}`)
  })

  // NULL three-valued logic is tested BEHAVIOURALLY, not by a regular expression: db/verify/v61 calls every function with NULL arguments and requires a refusal.
})
