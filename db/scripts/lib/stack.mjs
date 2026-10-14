// stack.mjs - the few helpers the local-stack image scripts share (convert-images.mjs, backfill-og-images.mjs).
// LOCAL stack only: every entry point refuses a non-local API / DB container unless `--allow-remote` is passed.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
export const q = (s) => (s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'")
export const mb = (n) => (Number(n) / 1048576).toFixed(1) + ' MB'

/**
 * Resolve the environment once: { API, KEY, CONT, DBURL, sharp }. Throws with a clear message on anything missing or non-local.
 * `needSharp` = false for scripts that never decode an image.
 */
export function connect({ allowRemote = false, needSharp = true } = {}) {
  const API = process.env.API_URL || 'http://127.0.0.1:54321'
  const KEY = process.env.SERVICE_ROLE_KEY
  const CONT = process.env.DB_CONTAINER || 'supabase_db_stack'
  const DBURL = process.env.DATABASE_URL || null
  if (!KEY) throw new Error('SERVICE_ROLE_KEY missing')
  if (needSharp && !process.env.SHARP_DIR) throw new Error('SHARP_DIR missing (a directory with `npm i sharp`, outside the repository)')
  if (!allowRemote) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API + '/')) throw new Error('refusing a non-local API (pass --allow-remote if you really mean it)')
    if (!DBURL && !/^supabase_db_/.test(CONT)) throw new Error('refusing a non-local DB container')
  }
  const sharp = needSharp ? createRequire(path.join(process.env.SHARP_DIR, 'x.js'))('sharp') : null
  const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY }

  /** Run SQL through psql (docker exec, or DATABASE_URL). `json` parses the single value printed. */
  function psql(sql, { json = false } = {}) {
    const base = DBURL ? ['psql', DBURL] : ['docker', 'exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres']
    const r = spawnSync(base[0], [...base.slice(1), '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 })
    if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').slice(0, 600))
    const out = r.stdout.trim()
    return json ? JSON.parse(out || 'null') : out
  }

  const enc = (name) => name.split('/').map(encodeURIComponent).join('/')
  /** GET an object with the service key (works for private buckets too). `range` = 'bytes=0-15' for a peek. */
  async function download(bucket, name, range = null) {
    const res = await fetch(`${API}/storage/v1/object/${bucket}/${enc(name)}`, { headers: { ...auth, ...(range ? { Range: range } : {}) } })
    if (!res.ok) throw new Error(`download ${bucket}/${name}: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  /** POST an object (never overwrites unless `upsert`). */
  async function upload(bucket, name, buf, { contentType, upsert = false, cacheControl = 'max-age=31536000' } = {}) {
    const res = await fetch(`${API}/storage/v1/object/${bucket}/${enc(name)}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': contentType, 'x-upsert': upsert ? 'true' : 'false', 'cache-control': cacheControl },
      body: buf,
    })
    if (!res.ok) throw new Error(`upload ${bucket}/${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  }
  /** DELETE objects through the Storage API (the only supported way: storage.objects rows are never deleted with SQL). Returns the names the API says it removed. */
  async function remove(bucket, names) {
    const res = await fetch(`${API}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: names }),
    })
    if (!res.ok) throw new Error(`delete ${bucket} (${names.length}): HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const body = await res.json().catch(() => [])
    return Array.isArray(body) ? body.map((o) => o.name) : []
  }
  return { API, KEY, CONT, DBURL, sharp, psql, download, upload, remove }
}
