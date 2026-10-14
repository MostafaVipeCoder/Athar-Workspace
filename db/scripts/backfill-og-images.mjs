// backfill-og-images.mjs - the JPEG link-preview derivatives of the images that were shared BEFORE the browser pipeline started to make them
// (owner decision 08 section 18.6; m45). LOCAL stack by default; dry run by default.
//
// For every stored image that a sharing purpose references (app_private.og_missing_refs(): program / project covers, public-link preview images, the
// form cover library, landing card covers, the landing hero + SEO image, a form's share image) and that has no derivative yet, it
//   downloads  public-assets/<owner>/<kind>/<uuid>.webp
//   makes      1200 x 630 JPEG, cover crop (centre), white behind transparency, progressive (mozjpeg), quality 82 stepping down until it is <= 300 KB
//   uploads    og-images/<owner>/<kind>/<uuid>.jpg   (the deterministic path the share / OG function computes; image/jpeg; through the Storage API)
// and finally proves that app_private.og_missing_refs() is empty. The same geometry / quality / size target as the browser pipeline
// (web/src/lib/image: profiles.js OG_*, convert.js) so a derivative made here and one made by an upload are interchangeable.
//
// Usage:   SERVICE_ROLE_KEY=... SHARP_DIR=<dir with node_modules/sharp> node db/scripts/backfill-og-images.mjs [--apply] [--limit N] [--report f.json] [--verbose]
// Easier:  SHARP_DIR=<dir> bash db/scripts/run-backfill-og.sh [--apply]
import { writeFileSync } from 'node:fs'
import { connect, mb } from './lib/stack.mjs'
import { OG_BUCKET, OG_HEIGHT, OG_QUALITY, OG_TARGET_BYTES, OG_WIDTH, ogPathOf } from './lib/plan.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const APPLY = flag('--apply')
const VERBOSE = flag('--verbose')
const LIMIT = Number(opt('--limit', 0)) || 0
const REPORT = opt('--report')
const LADDER = [OG_QUALITY, 74, 66, 58, 52]

const { sharp, psql, download, upload } = connect({ allowRemote: flag('--allow-remote') })

console.log(`backfill-og-images: ${APPLY ? 'APPLY' : 'DRY RUN (nothing is written)'}`)
const work = psql(`select coalesce(json_agg(row_to_json(x)), '[]') from (select value as path, array_agg(distinct source order by source) as sources from app_private.og_missing_refs() group by value order by value) x`, { json: true }) ?? []
const todo = LIMIT ? work.slice(0, LIMIT) : work
console.log(`shared images without a JPEG derivative: ${work.length}${LIMIT ? ` (limited to ${todo.length})` : ''}`)

/** 1200 x 630 cover crop, progressive JPEG, the first quality that fits OG_TARGET_BYTES (else the smallest). */
async function makeOg(buf) {
  const base = () => sharp(buf, { failOn: 'none', animated: false }).rotate().resize({ width: OG_WIDTH, height: OG_HEIGHT, fit: 'cover', position: 'centre' }).flatten({ background: '#ffffff' })
  let best = null
  for (const quality of LADDER) {
    const out = await base().jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer()
    if (!best || out.length < best.out.length) best = { out, quality }
    if (out.length <= OG_TARGET_BYTES) break
  }
  return best
}

const done = []
const failed = []
let total = 0
let idx = 0
async function worker() {
  while (idx < todo.length) {
    const item = todo[idx++]
    const og = ogPathOf(item.path)
    try {
      const src = await download('public-assets', item.path)
      const { out, quality } = await makeOg(src)
      total += out.length
      if (VERBOSE) console.log(`  ${item.path} -> ${OG_BUCKET}/${og}  ${src.length} -> ${out.length} B  q${quality}  [${item.sources.join(', ')}]`)
      if (APPLY) await upload(OG_BUCKET, og, out, { contentType: 'image/jpeg', upsert: false })
      done.push({ source: item.path, og, bytes: out.length, quality, sources: item.sources })
    } catch (e) {
      failed.push({ source: item.path, error: e.message })
      console.warn(`  ! ${item.path}: ${e.message}`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log(`\n${APPLY ? 'created' : 'would create'} ${done.length} derivatives, ${mb(total)} in total (${done.length ? Math.round(total / done.length / 1024) : 0} KB on average); failed: ${failed.length}`)

if (APPLY) {
  const missing = psql('select count(*) from app_private.og_missing_refs()')
  const orphans = psql('select count(*) from app_private.og_orphans')
  console.log(`after: shared images still without a derivative: ${missing}; derivatives without a source image: ${orphans}`)
  if (Number(missing) || failed.length) process.exitCode = 1
}
if (REPORT) writeFileSync(REPORT, JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), done, failed, totalBytes: total }, null, 1))
