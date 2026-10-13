// convert-images.mjs - server-side WebP converter (owner decision 08 section 17.3, UNIVERSAL WEBP). LOCAL stack by default.
//
// The browser converts every image it uploads (web/src/lib/image). This script is the safety net for everything that did NOT come from the
// browser pipeline: files migrated from the old project, files uploaded by a script or another client, objects whose name says .webp but whose
// bytes are something else. It
//   1. lists every object of every bucket that is a raster which is not WebP (by name / recorded mimetype; plus a magic-byte check of every
//      `.webp`-named object in the image buckets, to catch mislabelled ones),
//   2. finds every database value that references each of them (every text / varchar / json / jsonb column of schema `public`, exact path),
//   3. DRY RUN (the default): converts each one IN MEMORY and prints what would change and what it would save. Nothing is written.
//   4. --apply: for objects that are REFERENCED by current data it uploads `<dir>/<new uuid>.webp` (+ `_t.webp` where the bucket carries
//      thumbnails), rewrites every reference in ONE transaction per object, then proves with app_private.storage_dangling_refs() that no reference
//      dangles. Objects nothing references (the ~87 MB of originals in event-assets / migration-archive) are only REPORTED.
// It NEVER deletes or overwrites an original: after --apply the old object stays where it was, unreferenced; the owner decides about removing
// originals later (`--report` lists them with their sizes).
//
// Usage:   SERVICE_ROLE_KEY=... SHARP_DIR=<dir with node_modules/sharp> node db/scripts/convert-images.mjs [--apply] [--buckets a,b] [--limit N]
//                                                                                                   [--report file.json] [--verbose]
// Easier:  SHARP_DIR=<dir> bash db/scripts/run-convert-images.sh [--apply]     (reads the service key from the local supabase stack)
// Env:     API_URL (default http://127.0.0.1:54321), DB_CONTAINER (default supabase_db_stack) or DATABASE_URL (psql connection string).
// Refuses a non-local API unless --allow-remote is given (the live project is never touched by this repository's tooling).
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const APPLY = flag('--apply')
const VERBOSE = flag('--verbose')
const LIMIT = Number(opt('--limit', 0)) || 0
const ONLY = opt('--buckets') ? opt('--buckets').split(',') : null
// certificate-templates only when asked for by name: its upload path belongs to the Certificates builder (README: data/certificates.js)
const SKIP_BY_DEFAULT = ['certificate-templates']
const REPORT = opt('--report')

const API = process.env.API_URL || 'http://127.0.0.1:54321'
const KEY = process.env.SERVICE_ROLE_KEY
const CONT = process.env.DB_CONTAINER || 'supabase_db_stack'
const DBURL = process.env.DATABASE_URL || null
if (!KEY) throw new Error('SERVICE_ROLE_KEY missing')
if (!process.env.SHARP_DIR) throw new Error('SHARP_DIR missing (a directory with `npm i sharp`, outside the repository)')
if (!flag('--allow-remote')) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API + '/')) throw new Error('refusing a non-local API (pass --allow-remote if you really mean it)')
  if (!DBURL && !/^supabase_db_/.test(CONT)) throw new Error('refusing a non-local DB container')
}
const sharp = createRequire(path.join(process.env.SHARP_DIR, 'x.js'))('sharp')

// ------------------------------------------------------------------ database access (psql through docker, or DATABASE_URL)
function psql(sql, { json = false } = {}) {
  const base = DBURL ? ['psql', DBURL] : ['docker', 'exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres']
  const r = spawnSync(base[0], [...base.slice(1), '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').slice(0, 600))
  const out = r.stdout.trim()
  return json ? JSON.parse(out || 'null') : out
}
const q = (s) => (s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'")

// ------------------------------------------------------------------ policy (server mirror of web/src/lib/image/profiles.js, by folder kind)
const IMAGE_BUCKETS = ['public-assets', 'founder-assets', 'resources', 'form-uploads']
const THUMB_BUCKETS = ['public-assets', 'founder-assets', 'resources']
const KIND = { cover: [1920, 500], landing: [1920, 600], 'form-cover': [1920, 500], 'project-cover': [1920, 500], og: [1920, 500], logo: [512, 90], 'company-logo': [512, 90], photo: [512, 90], avatar: [512, 90], 'expert-photo': [512, 90], 'answer-logo': [512, 90] }
const policyOf = (bucket, name) => {
  // certificate templates are rendered at their own pixel size (the template row stores width x height and the fields are fractions): never resized
  if (bucket === 'certificate-templates') return { maxPx: 100000, target: 4 * 1024 * 1024, thumb: 0 }
  const kind = name.split('/')[1]
  const [maxPx, targetKb] = KIND[kind] ?? (bucket === 'form-uploads' ? [2000, 600] : [1600, 400])
  return { maxPx, target: targetKb * 1024, thumb: THUMB_BUCKETS.includes(bucket) ? 320 : 0 }
}
const LADDER = [82, 74, 66, 58, 50]
const RASTER_NAME = /\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$/i
const RASTER_MIME = /^image\/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)/i

// ------------------------------------------------------------------ storage API
const enc = (name) => name.split('/').map(encodeURIComponent).join('/')
const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY }
async function download(bucket, name, range = null) {
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${enc(name)}`, { headers: { ...auth, ...(range ? { Range: range } : {}) } })
  if (!res.ok) throw new Error(`download ${bucket}/${name}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
async function upload(bucket, name, buf) {
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${enc(name)}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/webp', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }, body: buf })
  if (!res.ok) throw new Error(`upload ${bucket}/${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
}

// ------------------------------------------------------------------ conversion (sharp: EXIF rotate, alpha kept, quality ladder + size guard, first frame of an animation)
async function convert(buf, pol) {
  const base = () => sharp(buf, { failOn: 'none', animated: false }).rotate().resize({ width: pol.maxPx, height: pol.maxPx, fit: 'inside', withoutEnlargement: true })
  const meta = await sharp(buf, { failOn: 'none' }).metadata()
  let best = null
  const stopAt = Math.min(pol.target, buf.length)
  for (const quality of LADDER) {
    const out = await base().webp({ quality, alphaQuality: 100, effort: 4 }).toBuffer()
    if (!best || out.length < best.length) best = out
    if (out.length <= stopAt) break
  }
  const info = await sharp(best).metadata()
  const thumb = pol.thumb ? await base().resize({ width: pol.thumb, height: pol.thumb, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75, alphaQuality: 100, effort: 4 }).toBuffer() : null
  return { full: best, thumb, width: info.width, height: info.height, animated: (meta.pages ?? 1) > 1 }
}

// ------------------------------------------------------------------ 1. candidates
console.log(`convert-images: ${APPLY ? 'APPLY' : 'DRY RUN (nothing is written)'}  api=${API}`)
const all = psql(`select coalesce(json_agg(json_build_object('b', bucket_id, 'n', name, 'm', metadata->>'mimetype', 's', (metadata->>'size')::bigint) order by bucket_id, name), '[]') from storage.objects where ${ONLY ? `bucket_id in (${ONLY.map(q).join(',')})` : `bucket_id not in (${SKIP_BY_DEFAULT.map(q).join(',')})`}`, { json: true })
const byName = all.filter((o) => RASTER_NAME.test(o.n) || RASTER_MIME.test(o.m ?? ''))
const candidates = byName.map((o) => ({ ...o, why: 'raster' }))
// mislabelled: image-bucket objects named .webp whose first bytes are not RIFF....WEBP
const webpNamed = all.filter((o) => IMAGE_BUCKETS.includes(o.b) && /\.webp$/i.test(o.n))
let checked = 0
for (let i = 0; i < webpNamed.length; i += 8) {
  await Promise.all(webpNamed.slice(i, i + 8).map(async (o) => {
    try {
      const head = await download(o.b, o.n, 'bytes=0-15')
      checked += 1
      if (!(head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP')) candidates.push({ ...o, why: 'mislabelled (.webp name, not WebP bytes)' })
    } catch (e) { console.warn('  cannot read', o.b, o.n, e.message) }
  }))
}
const todo = LIMIT ? candidates.slice(0, LIMIT) : candidates
console.log(`objects: ${all.length}; raster non-WebP: ${byName.length}; .webp-named objects magic-checked in image buckets: ${checked}; mislabelled: ${candidates.length - byName.length}`)
if (!todo.length) { console.log('nothing to convert.'); process.exit(0) }

// ------------------------------------------------------------------ 2. references (every text/varchar/json/jsonb column of public)
const names = todo.map((o) => o.n)
// one query per column: which of the given paths occur in it (as a substring: also inside a URL or a jsonb document)
const REF_SCAN_FN = `
create or replace function pg_temp.ref_scan(p_names text[]) returns table (tbl text, col text, typ text, name text, n bigint) language plpgsql as $f$
declare r record;
begin
  for r in select c.table_name t, c.column_name cn, c.data_type dt from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.is_generated = 'NEVER' and c.data_type in ('text','character varying','json','jsonb','ARRAY') loop
    return query execute format('select %L, %L, %L, nm::text, count(*) from public.%I x, unnest($1) nm where strpos(x.%I::text, nm) > 0 group by nm', r.t, r.cn, r.dt, r.t, r.cn) using p_names;
  end loop;
end $f$;`
const scan = (list) => psql(`${REF_SCAN_FN}\nselect coalesce(json_agg(row_to_json(x)), '[]') from pg_temp.ref_scan(array[${list.map(q).join(',')}]::text[]) x;`, { json: true }) ?? []
const refs = scan(names)
const refsOf = (n) => refs.filter((r) => r.name === n)
for (const o of todo) o.refs = refsOf(o.n)
const unsupported = refs.filter((r) => r.typ === 'ARRAY')
if (unsupported.length) console.warn('! references inside array columns are not rewritten by this script:', unsupported.map((r) => `${r.tbl}.${r.col}`).join(', '))

// ------------------------------------------------------------------ 3. convert (in memory) and report
const stats = {}
let idx = 0
async function worker() {
  while (idx < todo.length) {
    const o = todo[idx++]
    const s = (stats[o.b] ??= { objects: 0, referenced: 0, srcBytes: 0, webpBytes: 0, refBytes: 0, refWebp: 0, errors: 0 })
    s.objects += 1
    s.srcBytes += o.s ?? 0
    if (o.refs.length) s.referenced += 1
    // apply mode converts only what data references; the dry run converts everything to measure the saving
    if (APPLY && !o.refs.length) continue
    try {
      const buf = await download(o.b, o.n)
      const out = await convert(buf, policyOf(o.b, o.n))
      o.out = out
      s.webpBytes += out.full.length
      if (o.refs.length) { s.refBytes += o.s ?? 0; s.refWebp += out.full.length }
      if (VERBOSE) console.log(`  ${o.b}/${o.n}  ${o.s} -> ${out.full.length} B  ${out.width}x${out.height}${out.animated ? '  (animated: first frame)' : ''}  refs=${o.refs.length}  [${o.why}]`)
    } catch (e) {
      o.error = /HTTP (500|404)/.test(e.message) ? 'file is missing in the storage backend (metadata row only; HTTP ' + e.message.match(/HTTP (\d+)/)[1] + ')' : e.message
      s.errors += 1
      if (VERBOSE || !/missing in the storage backend/.test(o.error)) console.warn(`  ! ${o.b}/${o.n}: ${o.error}`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
console.log('\nper bucket (conversion done in memory; potential saving if the ORIGINALS were removed afterwards):')
let tSrc = 0, tOut = 0
for (const [b, s] of Object.entries(stats)) {
  tSrc += s.srcBytes; tOut += s.webpBytes
  // dry run: every object was converted in memory, so the saving is measured; apply: only the referenced ones were converted
  const measured = APPLY ? `  (referenced by data: ${mb(s.refBytes)} -> ${mb(s.refWebp)})` : `  ${mb(s.srcBytes).padStart(9)} -> ${mb(s.webpBytes).padStart(9)}  (saves ${mb(s.srcBytes - s.webpBytes)}, ${s.srcBytes ? Math.round((1 - s.webpBytes / s.srcBytes) * 100) : 0}%)`
  console.log(`  ${b.padEnd(20)} ${String(s.objects).padStart(4)} objects  ${String(s.referenced).padStart(3)} referenced by data ${measured}${s.errors ? `  errors: ${s.errors}` : ''}`)
}
if (!APPLY) console.log(`  ${'TOTAL'.padEnd(20)} ${String(todo.length).padStart(4)} objects  ${' '.repeat(23)} ${mb(tSrc).padStart(9)} -> ${mb(tOut).padStart(9)}  (saves ${mb(tSrc - tOut)})`)
const referenced = todo.filter((o) => o.refs.length && !o.error)
const unreferenced = todo.filter((o) => !o.refs.length)
console.log(`\nreferenced by current data: ${referenced.length}   unreferenced (reported only, never touched): ${unreferenced.length}   errors: ${todo.filter((o) => o.error).length}`)
for (const o of referenced) console.log(`  would convert ${o.b}/${o.n}  (${o.refs.map((r) => `${r.tbl}.${r.col}x${r.n}`).join(', ')})`)

// ------------------------------------------------------------------ 4. apply
const applied = []
if (APPLY) {
  for (const o of referenced) {
    const dir = o.n.split('/').slice(0, -1).join('/')
    const id = randomUUID()
    const nn = `${dir}/${id}.webp`
    try {
      await upload(o.b, nn, o.out.full)
      if (o.out.thumb) await upload(o.b, `${dir}/${id}_t.webp`, o.out.thumb)
      // the one place that knows every column that stores a path (m41, app_private.rewrite_storage_refs); one statement = one transaction
      const changed = psql(`select app_private.rewrite_storage_refs(${q(o.n)}, ${q(nn)})`, { json: true })
      applied.push({ bucket: o.b, from: o.n, to: nn, thumb: Boolean(o.out.thumb), fromBytes: o.s, toBytes: o.out.full.length, refs: changed })
      console.log(`  converted ${o.b}/${o.n} -> ${nn}  (${o.s} -> ${o.out.full.length} B)`)
    } catch (e) {
      console.error(`  ! apply failed for ${o.b}/${o.n}: ${e.message}`)
      process.exitCode = 1
    }
  }
  // proof: nothing references an old path any more, nothing dangles
  const leftover = psql(`select coalesce(json_agg(row_to_json(x)), '[]') from app_private.storage_dangling_refs() x`, { json: true }) ?? []
  const stillOld = applied.length ? scan(applied.map((a) => a.from)) : []
  console.log(`\nafter apply: ${applied.length} converted, references still pointing at an old path: ${stillOld.length}, dangling references: ${leftover.length}`)
  if (stillOld.length || leftover.length) { console.error(JSON.stringify({ stillOld, leftover }, null, 1)); process.exitCode = 1 }
  console.log('originals were NOT deleted; they are now unreferenced (see --report).')
}

if (REPORT) {
  writeFileSync(REPORT, JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), totals: { objects: todo.length, srcBytes: tSrc, webpBytes: tOut }, buckets: stats, applied, referenced: referenced.map((o) => ({ bucket: o.b, name: o.n, bytes: o.s, webpBytes: o.out?.full.length ?? null, refs: o.refs.map((r) => `${r.tbl}.${r.col}`) })), unreferenced: unreferenced.map((o) => ({ bucket: o.b, name: o.n, bytes: o.s, webpBytes: o.out?.full.length ?? null, why: o.why })), errors: todo.filter((o) => o.error).map((o) => ({ bucket: o.b, name: o.n, error: o.error })) }, null, 1))
  console.log('report written:', REPORT)
}
