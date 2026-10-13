// image-convert (owner decision 08 section 17.3, UNIVERSAL WEBP) - SKELETON, NOT DEPLOYED.
//
// The browser converts every image it uploads (web/src/lib/image) and the Storage buckets refuse a PNG/JPEG outright (db/migrations/m41:
// `allowed_mime_types` + two restrictive policies). What neither can see is the BYTES: a file named `x.webp` and typed `image/webp` can still
// be a PNG (a script, another client). This function is the server-side net for exactly that, wired to a Database Webhook on
// storage.objects INSERT (see webhook.sql):
//
//   A. a `.webp` object in an image bucket whose first bytes are not RIFF....WEBP  ->  decode it, encode a REAL WebP, and overwrite it IN PLACE
//      (same path, same content type): every database reference stays valid, so there is no race with the client that is about to save the path.
//   B. a raster object (png / jpg / gif ...) that slipped into a bucket without a mime restriction  ->  write a sibling `<uuid>.webp` (+ `_t.webp`
//      where the bucket carries thumbnails) and rewrite the references through `public.rewrite_storage_refs(old, new)` (service role only, m41).
//      A brand-new upload has no reference yet (the client saves the path AFTER the upload), so for it the answer is `unreferenced`: the nightly
//      batch (db/scripts/convert-images.mjs) picks it up once data points at it. This is why the doors (m41) are the primary enforcement.
//
// It NEVER deletes an original. It is idempotent: a real WebP is left alone (200 `skipped`).
//
// What is NOT implemented: the image codec. Pick ONE and fill `convertToWebp`:
//   - jSquash (libwebp / mozjpeg / oxipng as WASM): `npm:@jsquash/webp`, `npm:@jsquash/jpeg`, `npm:@jsquash/png` (decode -> ImageData -> encode);
//     mind the Edge Function memory limit (a 24 MP photo needs ~100 MB of RGBA) and decode at a reduced size where the codec allows it;
//   - or call a Node worker that runs `sharp` (the same code as db/scripts/convert-images.mjs) and keep this function as the webhook receiver.
// Until it exists the function answers 501 and changes NOTHING.
//
// Deploy later:  supabase functions deploy image-convert --no-verify-jwt   (the webhook is authenticated by IMAGE_CONVERT_SECRET, not a JWT)
// Secrets:       supabase secrets set IMAGE_CONVERT_SECRET=<random>   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided)

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET = Deno.env.get('IMAGE_CONVERT_SECRET') ?? ''

/** Buckets whose images must be WebP (the same list as m41). */
const IMAGE_BUCKETS = ['public-assets', 'founder-assets', 'resources', 'form-uploads']
/** Buckets that carry a `_t.webp` thumbnail next to each image (web/src/lib/image/profiles.js thumbPx = 320). */
const THUMB_BUCKETS = ['public-assets', 'founder-assets', 'resources']
const RASTER_NAME = /\.(png|jpe?g|jfif|gif|bmp|tiff?|heic|heif|avif)$/i
const RASTER_MIME = /^image\/(png|x-png|jpe?g|pjpeg|gif|bmp|tiff|heic|heif|avif)/i

/** `<owner>/<kind>/...` -> [max side, soft ceiling in KB]; the mirror of the browser profiles and of the batch script. */
const KIND: Record<string, [number, number]> = {
  cover: [1920, 500], landing: [1920, 600], 'form-cover': [1920, 500], 'project-cover': [1920, 500], og: [1920, 500],
  logo: [512, 90], 'company-logo': [512, 90], photo: [512, 90], avatar: [512, 90], 'expert-photo': [512, 90], 'answer-logo': [512, 90],
}
function policyOf(bucket: string, name: string) {
  const [maxPx, kb] = KIND[name.split('/')[1]] ?? (bucket === 'form-uploads' ? [2000, 600] : [1600, 400])
  return { maxPx, target: kb * 1024, thumbPx: THUMB_BUCKETS.includes(bucket) ? 320 : 0 }
}

interface Converted { full: Uint8Array; thumb: Uint8Array | null; width: number; height: number }
/**
 * TODO: decode `bytes` (PNG / JPEG / GIF first frame / BMP / AVIF, EXIF orientation applied, alpha kept), fit inside `policy.maxPx` without
 * upscaling, encode WebP down a quality ladder (82, 74, 66, 58, 50) until it fits min(policy.target, source size), keeping the SMALLEST result,
 * and make the 320 px thumbnail when `policy.thumbPx > 0`. Returns null while no codec is wired.
 */
// deno-lint-ignore require-await
async function convertToWebp(_bytes: Uint8Array, _policy: ReturnType<typeof policyOf>): Promise<Converted | null> {
  return null
}

const isWebp = (b: Uint8Array) => b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  if (!SECRET || req.headers.get('x-webhook-secret') !== SECRET) return json(401, { error: 'unauthorised' })
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'not configured' })

  // Database Webhook payload: { type: 'INSERT', table: 'objects', schema: 'storage', record: { bucket_id, name, metadata, ... } }
  const evt = await req.json().catch(() => null)
  const rec = evt?.record
  if (evt?.type !== 'INSERT' || evt?.schema !== 'storage' || evt?.table !== 'objects' || !rec?.bucket_id || !rec?.name) return json(200, { status: 'ignored' })
  const bucket: string = rec.bucket_id
  const name: string = rec.name
  if (!IMAGE_BUCKETS.includes(bucket)) return json(200, { status: 'ignored', why: 'bucket' })
  if (/_t\.webp$/i.test(name)) return json(200, { status: 'ignored', why: 'thumbnail' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const store = db.storage.from(bucket)
  const raster = RASTER_NAME.test(name) || RASTER_MIME.test(String(rec.metadata?.mimetype ?? ''))
  const webpNamed = /\.webp$/i.test(name)
  if (!raster && !webpNamed) return json(200, { status: 'ignored', why: 'not an image' })

  const { data: blob, error } = await store.download(name)
  if (error || !blob) return json(502, { error: 'download failed' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (webpNamed && isWebp(bytes)) return json(200, { status: 'skipped', why: 'already WebP' })

  const out = await convertToWebp(bytes, policyOf(bucket, name))
  if (!out) return json(501, { status: 'not-implemented', why: 'no image codec is wired in convertToWebp(); nothing was changed' })

  const dir = name.split('/').slice(0, -1).join('/')
  const put = (path: string, body: Uint8Array, upsert: boolean) => store.upload(path, body, { contentType: 'image/webp', cacheControl: '31536000', upsert })

  if (webpNamed) {
    // A. mislabelled: same path, real WebP bytes (+ thumbnail if the bucket carries them and it is missing)
    const up = await put(name, out.full, true)
    if (up.error) return json(502, { error: 'overwrite failed' })
    if (out.thumb) await put(name.replace(/\.webp$/i, '_t.webp'), out.thumb, true)
    return json(200, { status: 'normalised-in-place', path: name, bytes: out.full.length })
  }

  // B. raster: sibling file + reference rewrite; the original stays where it is
  const id = crypto.randomUUID()
  const next = `${dir}/${id}.webp`
  const up = await put(next, out.full, false)
  if (up.error) return json(502, { error: 'upload failed' })
  if (out.thumb) await put(`${dir}/${id}_t.webp`, out.thumb, false)
  const { data: changed, error: rpcError } = await db.rpc('rewrite_storage_refs', { p_old: name, p_new: next })
  if (rpcError) return json(502, { error: 'reference rewrite failed', detail: rpcError.message })
  const references = Object.keys(changed ?? {}).length
  return json(200, { status: references ? 'converted' : 'unreferenced', from: name, to: next, references })
})
