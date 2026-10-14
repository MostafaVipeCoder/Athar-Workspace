// convert-images.mjs - server-side WebP converter (owner decisions 08 section 17.3 UNIVERSAL WEBP and 18.4 "convert ALL old originals, delete the old
// ones"). LOCAL stack by default. THREE modes, dry run is the default:
//
//   (no flag)             DRY RUN. Lists every raster that is not WebP in EVERY bucket, converts each one IN MEMORY, prints what would change and what it
//                         would save. Nothing is written.
//   --apply               STEP 1. Converts EVERY raster (referenced by data or not) to its WebP sibling in the same bucket and folder:
//                         `<dir>/<base>.<ext>` -> `<dir>/<base>.webp` (a collision puts the old extension in the name: `<base>-png.webp`), plus the 320 px
//                         `_t.webp` thumbnail in the buckets that carry them (public-assets, founder-assets, resources). Records every conversion in
//                         app_private.image_conversions (original path / bytes / sha256, the WebP, the thumbnail), rewrites EVERY database reference
//                         (app_private.rewrite_storage_refs: every text / json / jsonb column of `public` + migration.asset_result.archive_path), then
//                         proves that no reference still points at an old path and that app_private.storage_dangling_refs() is empty.
//                         NEVER deletes anything. Re-runnable (what is already converted is skipped).
//   --delete-originals    STEP 2 (a separate run: it cannot be combined with --apply). Removes the raster originals THROUGH THE STORAGE API (never
//                         by deleting rows of storage.objects), but only the ones that have a verified WebP sibling (stored, RIFF/WEBP bytes, size > 0),
//                         no remaining reference anywhere, and a sha256 equal to the one recorded at conversion time. Before the first delete the
//                         manifest of everything about to be removed (path, bytes, sha256, replaced_by) is written to
//                         local-db/backups/deleted-originals-manifest.csv (git-ignored). Objects whose FILE is missing in the storage backend (metadata-only
//                         rows, HTTP 404/500 on download) are stale: they are removed through the Storage API as well and listed in the manifest as
//                         `stale_row_removed`; a readable file that is not an image at all (an empty file, the text `image-test-content` saved as .png) cannot be
//                         converted and is removed as `undecodable_removed` (its bytes are recorded by sha256). `--delete-originals --dry-run` prints the plan only.
//
// Usage:   SERVICE_ROLE_KEY=... SHARP_DIR=<dir with node_modules/sharp> node db/scripts/convert-images.mjs [--apply | --delete-originals [--dry-run]]
//                                   [--buckets a,b] [--limit N] [--report file.json] [--manifest file.csv] [--verbose]
// Easier:  SHARP_DIR=<dir> bash db/scripts/run-convert-images.sh [--apply | --delete-originals]     (reads the service key from the local supabase stack)
// Env:     API_URL (default http://127.0.0.1:54321), DB_CONTAINER (default supabase_db_stack) or DATABASE_URL (psql connection string).
// Refuses a non-local API unless --allow-remote is given (the live project is never touched by this repository's tooling).
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, mb, q, sha256 } from './lib/stack.mjs'
import { IMAGE_BUCKETS, MANIFEST_HEADER, THUMB_BUCKETS, isConvertible, isRaster, manifestLine, planTarget, policyOf } from './lib/plan.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const APPLY = flag('--apply')
const DELETE = flag('--delete-originals')
const DRY_FLAG = flag('--dry-run')
if (APPLY && DELETE) throw new Error('--apply and --delete-originals are two separate steps: run them one after the other (the second proves the first)')
const MODE = DELETE ? (DRY_FLAG ? 'delete-dry-run' : 'delete') : APPLY ? 'apply' : 'dry-run'
const VERBOSE = flag('--verbose')
const LIMIT = Number(opt('--limit', 0)) || 0
const ONLY = opt('--buckets') ? opt('--buckets').split(',') : null
const REPORT = opt('--report')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = opt('--manifest') ?? path.join(ROOT, 'local-db', 'backups', 'deleted-originals-manifest.csv')
const LADDER = [82, 74, 66, 58, 50]

const { sharp, psql, download, upload, remove } = connect({ allowRemote: flag('--allow-remote') })

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
const isWebpBytes = (head) => head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
const missingFile = (e) => /HTTP (500|404|400)/.test(e.message)

// ------------------------------------------------------------------ the object inventory (every bucket)
const bucketFilter = ONLY ? `where bucket_id in (${ONLY.map(q).join(',')})` : ''
const inventory = () => psql(`select coalesce(json_agg(json_build_object('b', bucket_id, 'n', name, 'm', metadata->>'mimetype', 's', (metadata->>'size')::bigint) order by bucket_id, name), '[]') from storage.objects ${bucketFilter}`, { json: true })
const statsOf = (objs) => {
  const out = {}
  for (const o of objs) {
    const s = (out[o.b] ??= { objects: 0, bytes: 0, rasters: 0, rasterBytes: 0 })
    s.objects += 1
    s.bytes += o.s ?? 0
    if (isConvertible(o.b, o.n, o.m)) { s.rasters += 1; s.rasterBytes += o.s ?? 0 }
  }
  return out
}
const printStats = (title, st) => {
  console.log(title)
  let o = 0, b = 0, r = 0, rb = 0
  for (const [bucket, s] of Object.entries(st)) {
    o += s.objects; b += s.bytes; r += s.rasters; rb += s.rasterBytes
    console.log(`  ${bucket.padEnd(22)} ${String(s.objects).padStart(4)} objects  ${mb(s.bytes).padStart(9)}   raster: ${String(s.rasters).padStart(3)} objects  ${mb(s.rasterBytes).padStart(9)}`)
  }
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(o).padStart(4)} objects  ${mb(b).padStart(9)}   raster: ${String(r).padStart(3)} objects  ${mb(rb).padStart(9)}`)
}

// ------------------------------------------------------------------ references (public: every text / json / jsonb column, substring; + migration.asset_result.archive_path, exact)
const REF_SCAN_FN = `
create or replace function pg_temp.ref_scan(p_names text[]) returns table (tbl text, col text, typ text, name text, n bigint) language plpgsql as $f$
declare r record;
begin
  for r in select c.table_name t, c.column_name cn, c.data_type dt from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.is_generated = 'NEVER' and c.data_type in ('text','character varying','json','jsonb','ARRAY') loop
    return query execute format('select %L, %L, %L, nm::text, count(*) from public.%I x, unnest($1) nm where strpos(x.%I::text, nm) > 0 group by nm', r.t, r.cn, r.dt, r.t, r.cn) using p_names;
  end loop;
  if to_regclass('migration.asset_result') is not null then
    return query select 'migration.asset_result', 'archive_path', 'text', a.archive_path::text, count(*) from migration.asset_result a where a.archive_path = any(p_names) group by a.archive_path;
  end if;
end $f$;`
const scan = (list) => (list.length ? psql(`${REF_SCAN_FN}\nselect coalesce(json_agg(row_to_json(x)), '[]') from pg_temp.ref_scan(array[${list.map(q).join(',')}]::text[]) x;`, { json: true }) ?? [] : [])
const danglingNow = () => psql(`select coalesce(json_agg(row_to_json(x)), '[]') from app_private.storage_dangling_refs() x`, { json: true }) ?? []
/** Informational only: the provenance strings of the old project (URLs of the LIVE storage in legacy.* and migration.asset_map / asset_refs / asset_result): NOT storage references, never rewritten. */
const provenance = (names) => psql(`
create or replace function pg_temp.prov(p_names text[]) returns table (sch text, tbl text, col text, hits bigint) language plpgsql as $f$
declare r record;
begin
  for r in select c.table_schema s, c.table_name t, c.column_name cn from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema in ('legacy','migration') and c.data_type in ('text','character varying','json','jsonb')
             and not (c.table_schema = 'migration' and c.table_name = 'asset_result' and c.column_name = 'archive_path') loop
    return query execute format('select %L, %L, %L, count(*) from %I.%I x where exists (select 1 from unnest($1) nm where strpos(x.%I::text, nm) > 0)', r.s, r.t, r.cn, r.s, r.t, r.cn) using p_names;
  end loop;
end $f$;
select coalesce(json_agg(row_to_json(x)), '[]') from pg_temp.prov(array[${names.map(q).join(',')}]::text[]) x where hits > 0;`, { json: true }) ?? []

// ------------------------------------------------------------------ 1. inventory + candidates
console.log(`convert-images: ${MODE.toUpperCase()}${MODE === 'dry-run' ? ' (nothing is written)' : ''}  api=${process.env.API_URL || 'http://127.0.0.1:54321'}`)
const all = inventory()
const before = statsOf(all)
printStats('\nbefore:', before)
const objectsByBucket = {}
for (const o of all) (objectsByBucket[o.b] ??= new Set()).add(o.n)

const conversions = new Map(
  (psql(`select coalesce(json_agg(row_to_json(c)), '[]') from app_private.image_conversions c`, { json: true }) ?? []).map((c) => [`${c.bucket}/${c.original_path}`, c]),
)

// mislabelled: image-bucket objects named .webp whose first bytes are not RIFF....WEBP
// og-images holds JPEG ON PURPOSE (m45, the link-preview derivatives): never a candidate for conversion or deletion
const rasters = all.filter((o) => isConvertible(o.b, o.n, o.m)).map((o) => ({ ...o, why: 'raster' }))
if (MODE !== 'delete' && MODE !== 'delete-dry-run') {
  const webpNamed = all.filter((o) => IMAGE_BUCKETS.includes(o.b) && /\.webp$/i.test(o.n) && !isRaster(o.n, o.m))
  let checked = 0
  for (let i = 0; i < webpNamed.length; i += 8) {
    await Promise.all(webpNamed.slice(i, i + 8).map(async (o) => {
      try {
        const head = await download(o.b, o.n, 'bytes=0-15')
        checked += 1
        if (!isWebpBytes(head)) rasters.push({ ...o, why: 'mislabelled (.webp name, not WebP bytes)' })
      } catch (e) { console.warn('  cannot read', o.b, o.n, e.message) }
    }))
  }
  console.log(`\n.webp-named objects magic-checked in the image buckets: ${checked}; mislabelled: ${rasters.filter((o) => o.why !== 'raster').length}`)
}
const todo = LIMIT ? rasters.slice(0, LIMIT) : rasters
console.log(`raster / mislabelled objects: ${rasters.length}${LIMIT ? ` (limited to ${todo.length})` : ''}   already converted (recorded): ${todo.filter((o) => conversions.get(`${o.b}/${o.n}`)?.converted_at).length}`)
if (!todo.length) { console.log('nothing to do.'); process.exit(0) }

// ================================================================== DELETE (step 2)
if (MODE === 'delete' || MODE === 'delete-dry-run') {
  const dangling = danglingNow()
  if (dangling.length) { console.error('refusing to delete: storage_dangling_refs() is not empty:', JSON.stringify(dangling.slice(0, 10))); process.exit(1) }
  const live = new Set(all.map((o) => `${o.b}/${o.n}`))
  const refsNow = scan(todo.map((o) => o.n))
  const refCount = (name) => refsNow.filter((r) => r.name === name).length

  const plan = { deletable: [], stale: [], undecodable: [], skipped: [] }
  let i = 0
  async function check() {
    while (i < todo.length) {
      const o = todo[i++]
      const c = conversions.get(`${o.b}/${o.n}`)
      if (refCount(o.n)) { plan.skipped.push({ o, why: `still referenced (${refsNow.filter((r) => r.name === o.n).map((r) => `${r.tbl}.${r.col}`).join(', ')})` }); continue }
      if (c?.converted_at) {
        if (!live.has(`${o.b}/${c.webp_path}`)) { plan.skipped.push({ o, why: 'its WebP sibling is not in storage' }); continue }
        try {
          const head = await download(o.b, c.webp_path, 'bytes=0-15')
          if (!isWebpBytes(head)) { plan.skipped.push({ o, why: 'the sibling is not WebP bytes' }); continue }
          if (c.thumb_path && !live.has(`${o.b}/${c.thumb_path}`)) { plan.skipped.push({ o, why: 'its thumbnail is not in storage' }); continue }
          const buf = await download(o.b, o.n)
          const hash = sha256(buf)
          if (c.original_sha256 && c.original_sha256 !== hash) { plan.skipped.push({ o, why: 'the original changed since it was converted (sha256 differs)' }); continue }
          plan.deletable.push({ o, c, sha: hash, bytes: buf.length })
        } catch (e) { plan.skipped.push({ o, why: e.message }) }
        continue
      }
      // never converted: only a metadata-only row (the FILE is missing in the backend) may go; anything readable must be converted first
      try {
        const buf = await download(o.b, o.n)
        let decodable = true
        try { if (!buf.length) throw new Error('empty'); await sharp(buf, { failOn: 'none' }).metadata() } catch { decodable = false }
        if (decodable) plan.skipped.push({ o, why: 'not converted yet (run --apply first)' })
        else plan.undecodable.push({ o, sha: sha256(buf), bytes: buf.length })
      } catch (e) {
        if (!missingFile(e)) { plan.skipped.push({ o, why: e.message }); continue }
        try { await download(o.b, o.n, 'bytes=0-0'); plan.skipped.push({ o, why: 'readable on the second try' }) } catch { plan.stale.push({ o }) }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, check))
  const sum = (a, f) => a.reduce((n, x) => n + f(x), 0)
  console.log(`\nplan: delete ${plan.deletable.length} converted originals (${mb(sum(plan.deletable, (d) => d.bytes))}), remove ${plan.stale.length} stale metadata-only rows and ${plan.undecodable.length} undecodable files, skip ${plan.skipped.length}`)
  for (const s of plan.skipped) console.log(`  skip ${s.o.b}/${s.o.n}: ${s.why}`)
  for (const s of plan.stale) console.log(`  stale (file missing in the backend) ${s.o.b}/${s.o.n}`)
  for (const s of plan.undecodable) console.log(`  undecodable (not an image, ${s.bytes} B) ${s.o.b}/${s.o.n}`)
  if (VERBOSE) for (const d of plan.deletable) console.log(`  delete ${d.o.b}/${d.o.n}  ${d.bytes} B  sha256 ${d.sha.slice(0, 12)}  -> ${d.c.webp_path}`)
  if (MODE === 'delete-dry-run') { console.log('\ndry run: nothing was written or deleted.'); process.exit(0) }
  if (!plan.deletable.length && !plan.stale.length && !plan.undecodable.length) { console.log('\nnothing to delete.'); process.exit(plan.skipped.length ? 1 : 0) }

  // the manifest FIRST (sync append: it is on disk before the first delete is issued)
  mkdirSync(path.dirname(MANIFEST), { recursive: true })
  if (!existsSync(MANIFEST)) writeFileSync(MANIFEST, MANIFEST_HEADER + '\n')
  const at = new Date().toISOString()
  appendFileSync(MANIFEST, [
    ...plan.deletable.map((d) => manifestLine({ at, bucket: d.o.b, path: d.o.n, bytes: d.bytes, sha256: d.sha, status: 'deleted', replacedBy: d.c.webp_path, replacedByBytes: d.c.webp_bytes, note: '' })),
    ...plan.stale.map((s) => manifestLine({ at, bucket: s.o.b, path: s.o.n, bytes: s.o.s ?? '', sha256: '', status: 'stale_row_removed', replacedBy: '', replacedByBytes: '', note: 'metadata row only: the file was already missing in the storage backend' })),
    ...plan.undecodable.map((s) => manifestLine({ at, bucket: s.o.b, path: s.o.n, bytes: s.bytes, sha256: s.sha, status: 'undecodable_removed', replacedBy: '', replacedByBytes: '', note: 'readable but not an image (empty or text content named as a raster): nothing to convert' })),
  ].join('\n') + '\n')
  console.log(`manifest written: ${path.relative(ROOT, MANIFEST)} (${plan.deletable.length + plan.stale.length + plan.undecodable.length} rows)`)

  const byBucket = {}
  for (const x of [...plan.deletable, ...plan.stale, ...plan.undecodable]) (byBucket[x.o.b] ??= []).push(x.o.n)
  let removed = 0
  for (const [bucket, names] of Object.entries(byBucket)) {
    for (let k = 0; k < names.length; k += 50) {
      const chunk = names.slice(k, k + 50)
      const done = await remove(bucket, chunk)
      removed += done.length
      if (done.length !== chunk.length) console.warn(`  ! ${bucket}: asked to delete ${chunk.length}, the API reports ${done.length}`)
    }
  }
  // verify through the DB (read-only) and close the audit rows
  const remaining = psql(`select count(*) from storage.objects o where (o.bucket_id, o.name) in (${[...plan.deletable, ...plan.stale, ...plan.undecodable].map((x) => `(${q(x.o.b)}, ${q(x.o.n)})`).join(',')})`)
  if (plan.deletable.length) psql(`update app_private.image_conversions set deleted_at = now() where (bucket, original_path) in (${plan.deletable.map((d) => `(${q(d.o.b)}, ${q(d.o.n)})`).join(',')}) and not exists (select 1 from storage.objects o where o.bucket_id = image_conversions.bucket and o.name = image_conversions.original_path)`)
  const after = statsOf(inventory())
  printStats('\nafter:', after)
  console.log(`\nremoved through the Storage API: ${removed} (${plan.deletable.length} converted originals + ${plan.stale.length} stale rows + ${plan.undecodable.length} undecodable files); still present in storage.objects: ${remaining}; dangling references: ${danglingNow().length}`)
  if (Number(remaining) || danglingNow().length) process.exitCode = 1
  if (REPORT) writeFileSync(REPORT, JSON.stringify({ mode: MODE, at, before, after, deleted: plan.deletable.length, stale: plan.stale.map((s) => `${s.o.b}/${s.o.n}`), undecodable: plan.undecodable.map((s) => `${s.o.b}/${s.o.n}`), skipped: plan.skipped.map((s) => ({ path: `${s.o.b}/${s.o.n}`, why: s.why })) }, null, 1))
  process.exit(process.exitCode ?? 0)
}

// ================================================================== DRY RUN / APPLY (step 1)
// ---- 2. references
const refs = scan(todo.map((o) => o.n))
for (const o of todo) o.refs = refs.filter((r) => r.name === o.n)
const unsupported = refs.filter((r) => r.typ === 'ARRAY')
if (unsupported.length) console.warn('! references inside array columns are not rewritten by this script:', unsupported.map((r) => `${r.tbl}.${r.col}`).join(', '))
const prov = provenance(todo.map((o) => o.n))
if (prov.length) console.log(`provenance only (URLs of the OLD project in legacy.* / migration.*, not storage references, never rewritten): ${prov.map((p) => `${p.sch}.${p.tbl}.${p.col} x${p.hits}`).join(', ')}`)

// ---- 3. plan the sibling names (already planned / converted rows keep their name; the rest never collide with an existing or claimed name)
const taken = new Map()
const takenOf = (b) => taken.get(b) ?? taken.set(b, new Set(objectsByBucket[b] ?? [])).get(b)
for (const o of todo) {
  const c = conversions.get(`${o.b}/${o.n}`)
  if (c) { o.target = { webp: c.webp_path, thumb: c.thumb_path }; o.known = c; takenOf(o.b).add(c.webp_path); if (c.thumb_path) takenOf(o.b).add(c.thumb_path) }
}
for (const o of todo) if (!o.target) o.target = planTarget(o.n, takenOf(o.b), { thumb: THUMB_BUCKETS.includes(o.b) })
const needsWork = todo.filter((o) => !o.known?.converted_at)

// ---- 4. convert in memory (the dry run converts everything to measure the saving)
const stats = {}
let idx = 0
async function worker() {
  while (idx < needsWork.length) {
    const o = needsWork[idx++]
    const s = (stats[o.b] ??= { objects: 0, referenced: 0, srcBytes: 0, webpBytes: 0, thumbBytes: 0, errors: 0, stale: 0 })
    s.objects += 1
    s.srcBytes += o.s ?? 0
    if (o.refs.length) s.referenced += 1
    try {
      const buf = await download(o.b, o.n)
      o.sha = sha256(buf)
      o.bytes = buf.length
      const out = await convert(buf, policyOf(o.b, o.n))
      o.out = out
      s.webpBytes += out.full.length
      s.thumbBytes += out.thumb?.length ?? 0
      if (VERBOSE) console.log(`  ${o.b}/${o.n}  ${o.s} -> ${out.full.length} B  ${out.width}x${out.height}${out.animated ? '  (animated: first frame)' : ''}  => ${o.target.webp}  refs=${o.refs.length}  [${o.why}]`)
    } catch (e) {
      if (missingFile(e)) { o.stale = true; s.stale += 1; s.srcBytes -= o.s ?? 0; s.objects -= 1 } else { o.error = e.message; s.errors += 1 }
      if (VERBOSE || !o.stale) console.warn(`  ! ${o.b}/${o.n}: ${o.stale ? 'file is missing in the storage backend (metadata row only)' : o.error}`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log('\nper bucket (converted in memory; the saving once the originals are removed in step 2):')
let tSrc = 0, tOut = 0
for (const [b, s] of Object.entries(stats)) {
  tSrc += s.srcBytes; tOut += s.webpBytes + s.thumbBytes
  console.log(`  ${b.padEnd(20)} ${String(s.objects).padStart(4)} readable  ${String(s.referenced).padStart(3)} referenced by data  ${mb(s.srcBytes).padStart(9)} -> ${mb(s.webpBytes + s.thumbBytes).padStart(9)}  (saves ${mb(s.srcBytes - s.webpBytes - s.thumbBytes)}, ${s.srcBytes ? Math.round((1 - (s.webpBytes + s.thumbBytes) / s.srcBytes) * 100) : 0}%)${s.stale ? `  stale rows (file missing): ${s.stale}` : ''}${s.errors ? `  errors: ${s.errors}` : ''}`)
}
console.log(`  ${'TOTAL'.padEnd(20)} ${mb(tSrc).padStart(9)} -> ${mb(tOut).padStart(9)}  (saves ${mb(tSrc - tOut)})`)
const stale = needsWork.filter((o) => o.stale)
const ok = needsWork.filter((o) => o.out)
console.log(`\nconvertible: ${ok.length}   referenced by current data: ${ok.filter((o) => o.refs.length).length}   stale metadata-only rows (file missing, nothing to convert; step 2 removes them): ${stale.length}   not decodable as an image (step 2 removes them): ${needsWork.filter((o) => o.error).length}`)
for (const o of stale) console.log(`  stale ${o.b}/${o.n}`)
for (const o of needsWork.filter((x) => x.error)) console.log(`  not an image (${o.bytes ?? o.s ?? '?'} B): ${o.b}/${o.n}  [${o.error}]`)
const refAgg = {}
for (const o of ok.filter((x) => x.refs.length)) for (const r of o.refs) refAgg[`${o.b}: ${r.tbl}.${r.col}`] = (refAgg[`${o.b}: ${r.tbl}.${r.col}`] ?? 0) + Number(r.n)
for (const [k, n] of Object.entries(refAgg)) console.log(`  references to rewrite  ${k}  x${n}`)
if (VERBOSE) for (const o of ok.filter((x) => x.refs.length)) console.log(`    ${o.b}/${o.n} -> ${o.target.webp}`)

// ---- 5. apply
const applied = []
if (MODE === 'apply') {
  for (const o of ok) {
    try {
      // the row first (an interrupted run re-uses the planned name), then the files, then the references in ONE statement
      psql(`insert into app_private.image_conversions (bucket, original_path, original_bytes, original_sha256, webp_path, webp_bytes, thumb_path, width, height)
            values (${q(o.b)}, ${q(o.n)}, ${o.bytes}, ${q(o.sha)}, ${q(o.target.webp)}, ${o.out.full.length}, ${q(o.out.thumb ? o.target.thumb : null)}, ${o.out.width}, ${o.out.height})
            on conflict (bucket, original_path) do update set webp_path = excluded.webp_path, webp_bytes = excluded.webp_bytes, thumb_path = excluded.thumb_path, width = excluded.width, height = excluded.height, original_sha256 = excluded.original_sha256, original_bytes = excluded.original_bytes`)
      await upload(o.b, o.target.webp, o.out.full, { contentType: 'image/webp', upsert: true })
      if (o.out.thumb) await upload(o.b, o.target.thumb, o.out.thumb, { contentType: 'image/webp', upsert: true })
      const head = await download(o.b, o.target.webp, 'bytes=0-15')
      if (!isWebpBytes(head)) throw new Error('the stored sibling is not WebP bytes')
      // every reference of the old path (a no-op where there is none: the scan above already says which originals are referenced)
      const changed = o.refs.length ? psql(`select app_private.rewrite_storage_refs(${q(o.n)}, ${q(o.target.webp)})`, { json: true }) : {}
      psql(`update app_private.image_conversions set converted_at = now(), note = ${q(Object.keys(changed).length ? JSON.stringify(changed) : null)} where bucket = ${q(o.b)} and original_path = ${q(o.n)}`)
      applied.push({ bucket: o.b, from: o.n, to: o.target.webp, thumb: o.out.thumb ? o.target.thumb : null, fromBytes: o.bytes, toBytes: o.out.full.length, refs: changed })
      if (VERBOSE) console.log(`  converted ${o.b}/${o.n} -> ${o.target.webp}  (${o.bytes} -> ${o.out.full.length} B)`)
    } catch (e) {
      console.error(`  ! apply failed for ${o.b}/${o.n}: ${e.message}`)
      process.exitCode = 1
    }
  }
  // proof: nothing references an old path any more, nothing dangles, every recorded sibling is stored
  const leftover = danglingNow()
  const everApplied = psql(`select coalesce(json_agg(original_path), '[]') from app_private.image_conversions where converted_at is not null`, { json: true }) ?? []
  const stillOld = scan(everApplied)
  const missingSibling = psql(`select count(*) from app_private.image_conversions c where c.converted_at is not null and (not exists (select 1 from storage.objects o where o.bucket_id = c.bucket and o.name = c.webp_path) or (c.thumb_path is not null and not exists (select 1 from storage.objects t where t.bucket_id = c.bucket and t.name = c.thumb_path)))`)
  console.log(`\nafter apply: ${applied.length} converted now (${psql('select count(*) from app_private.image_conversions where converted_at is not null')} recorded in total), references still pointing at an old path: ${stillOld.length}, dangling references: ${leftover.length}, recorded siblings missing: ${missingSibling}`)
  if (stillOld.length || leftover.length || Number(missingSibling)) { console.error(JSON.stringify({ stillOld, leftover }, null, 1)); process.exitCode = 1 }
  printStats('\nafter:', statsOf(inventory()))
  console.log('originals were NOT deleted (step 2: --delete-originals).')
}

if (REPORT) {
  writeFileSync(REPORT, JSON.stringify({
    mode: MODE, at: new Date().toISOString(), before, totals: { objects: needsWork.length, srcBytes: tSrc, webpBytes: tOut }, buckets: stats, applied,
    referenced: ok.filter((o) => o.refs.length).map((o) => ({ bucket: o.b, name: o.n, bytes: o.s, to: o.target.webp, refs: o.refs.map((r) => `${r.tbl}.${r.col}`) })),
    stale: stale.map((o) => `${o.b}/${o.n}`), errors: needsWork.filter((o) => o.error).map((o) => ({ bucket: o.b, name: o.n, error: o.error })),
  }, null, 1))
  console.log('report written:', REPORT)
}
