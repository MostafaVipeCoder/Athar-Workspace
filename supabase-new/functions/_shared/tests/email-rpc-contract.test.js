// The e-mail worker's JS adapter (email-worker.js) and the SQL (db/migrations/m62_email_worker.sql) must agree on every service-role RPC: name, argument names and
// order, who may execute it. db/verify/v62 proves the SQL against the live database; this test needs no database.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EMAIL_RPC_CONTRACT, createEmailDb } from '../email-worker.js'

const sql = readFileSync(fileURLToPath(new URL('../../../../db/migrations/m62_email_worker.sql', import.meta.url)), 'utf8')

function signature(name) {
  const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`, 'i').exec(sql)
  assert.ok(m, `public.${name} is not defined in m62`)
  return m[1].split(',').map((a) => a.trim()).filter(Boolean).map((a) => a.split(/\s+/)[0])
}
function body(name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'))
  const end = sql.indexOf('end $$;', start)
  return sql.slice(start, end + 8)
}

describe('RPC contract: JS adapter vs m62', () => {
  for (const [name, args] of Object.entries(EMAIL_RPC_CONTRACT)) {
    test(`public.${name}(${args.join(', ')})`, () => {
      assert.deepEqual(signature(name), args)
    })
  }

  test('the adapter calls exactly the contracted names with exactly the contracted argument names', async () => {
    const calls = []
    const db = createEmailDb({ rpc: async (fn, args) => { calls.push([fn, Object.keys(args)]); return { data: null, error: null } } })
    await db.claim({ worker: 'w', limit: 1, leaseSeconds: 1, perMinute: 1, dailyCap: 1 })
    await db.markSending('id', 'w')
    await db.finish({ id: 'id', worker: 'w', outcome: 'sent' })
    await db.heartbeat('w', {})
    assert.deepEqual(calls.map((c) => c[0]), Object.keys(EMAIL_RPC_CONTRACT))
    for (const [fn, keys] of calls) assert.deepEqual(keys, EMAIL_RPC_CONTRACT[fn], fn)
  })

  test('every worker RPC is granted to service_role and revoked from anon / authenticated / public', () => {
    const grants = sql.slice(sql.indexOf('9. grants'))
    const worker = /the worker RPCs[\s\S]*?end loop;/.exec(grants)?.[0] ?? ''
    assert.ok(worker.length > 100, 'the service-role grant block was not found')
    for (const name of Object.keys(EMAIL_RPC_CONTRACT)) assert.ok(new RegExp(`'public\\.${name}\\(`).test(worker), `${name} is not in the service-role grant block`)
    assert.ok(/revoke all on function %s from public, anon, authenticated/.test(worker))
    assert.ok(/grant execute on function %s to service_role/.test(worker))
  })

  test('every public function of m62 is SECURITY DEFINER with an empty search_path', () => {
    const names = [...Object.keys(EMAIL_RPC_CONTRACT), 'claim_email_batch', 'complete_email', 'fail_email', 'list_email_outbox', 'get_email_outbox_item', 'get_email_outbox_counts',
      'email_outbox_retry', 'email_outbox_cancel', 'email_outbox_mark_sent', 'email_outbox_resend', 'email_outbox_send_now', 'get_email_health', 'list_staff_invitation_delivery']
    for (const name of names) assert.match(body(name), /security definer set search_path = ''/i, name)
  })

  test('the client RPCs can never name a token, a secret or the OAuth tables', () => {
    for (const name of ['list_email_outbox', 'get_email_outbox_item', 'get_email_outbox_counts', 'get_email_health', 'list_staff_invitation_delivery']) {
      const b = body(name).toLowerCase()
      for (const word of ['vault', 'ciphertext', 'refresh', 'decrypted', 'google_secret', 'vault_secret_id', 'token_storage', 'google_sub']) assert.ok(!b.includes(word), `${name} mentions ${word}`)
    }
  })

  test('the audit log is written without a subject or a body', () => {
    const fn = sql.slice(sql.indexOf('create or replace function app_private.email_log_add'), sql.indexOf('create or replace function app_private.google_connection_usable'))
    assert.ok(!/subject|body_html/.test(fn), 'email_log_add must not touch the subject or the body')
    for (const col of ['recipient_masked', 'recipient_hash']) assert.ok(fn.includes(col))
  })

  test('NOTHING is scheduled by the migration itself (cron.schedule only inside email_worker_enable)', () => {
    const outside = sql.replace(/create or replace function app_private\.email_worker_enable[\s\S]*?end \$\$;/, '')
    assert.ok(!/cron\.schedule/.test(outside))
  })
})
