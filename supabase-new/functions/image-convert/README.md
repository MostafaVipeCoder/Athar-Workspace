# image-convert (owner decision 08 section 17.3, universal WebP) - skeleton, not deployed

The server-side safety net of the universal WebP rule. The primary enforcement is NOT here:

1. **The browser** (`web/src/lib/image`, stored by `web/src/data/storage.js`) converts every picked image to WebP + a 320 px thumbnail.
2. **The doors** (`db/migrations/m41_webp.sql`): `allowed_mime_types` on `public-assets` (WebP + SVG), `founder-assets` (WebP) and the mixed buckets
   `resources` / `form-uploads` (no PNG/JPEG/GIF), plus two restrictive policies on `storage.objects` that refuse a raster NAME or a recorded raster
   mimetype for anon and authenticated. A PNG sent straight to the Storage API gets HTTP 400 `invalid_mime_type`.
3. **The batch** (`db/scripts/convert-images.mjs`): converts what data already references (files migrated from the old project, anything stored
   before m41), rewrites every reference, never deletes an original.
4. **This function**: what the doors cannot see, the bytes.

## What it does (`index.ts`)

Triggered by a Database Webhook on `storage.objects` INSERT (`webhook.sql`), authenticated by `x-webhook-secret` (= `IMAGE_CONVERT_SECRET`):

| Case | Action |
|---|---|
| a `.webp`-named object whose first bytes are not `RIFF....WEBP` (a PNG with a lying name and content type) | decode, encode a real WebP, **overwrite in place** (same path: every DB reference stays valid, no race with the client that saves the path after uploading) |
| a raster object in a bucket without a mime restriction | write a sibling `<uuid>.webp` (+ `_t.webp`), call `public.rewrite_storage_refs(old, new)`; the original stays |
| a brand-new raster that nothing references yet | answered `unreferenced`: the nightly batch converts it once data points at it |
| a real WebP / a thumbnail / a non-image / another bucket | ignored (idempotent) |

`public.rewrite_storage_refs` (m41, executable by the service role only) is the one place that knows every column storing a path (every
text / varchar / json / jsonb column of `public`; a substring replace, so a path inside a public URL or a jsonb document is rewritten too).

## What is missing

- **The codec.** `convertToWebp()` returns `null`, so the function answers `501 not-implemented` and changes nothing. Wire ONE of: jSquash
  (`@jsquash/webp` + `@jsquash/jpeg` + `@jsquash/png`, WASM; mind the Edge Function memory limit) or a Node worker running `sharp` (the code of
  `db/scripts/convert-images.mjs`), keeping this function as the webhook receiver.
- **Deployment**: `supabase functions deploy image-convert --no-verify-jwt`, `supabase secrets set IMAGE_CONVERT_SECRET=<random>`, then run
  `webhook.sql` with the project URL and the same secret (or create the webhook in the dashboard: Database -> Webhooks -> table `storage.objects`,
  event INSERT, HTTP request, header `x-webhook-secret`). Nothing was deployed and no Supabase MCP tool was used.
- Order on the live project: m41 first (doors), then the batch (`--apply`), then this function.

**Link previews (answered by m45, owner decision 18.6)**: the JPEG derivative of a shared image is NOT made here. The browser pipeline writes it next to the
WebP (`og-images/<owner>/<kind>/<uuid>.jpg`, the path derived from the source path: `web/README.md`, "Link-preview JPEG") and
`db/scripts/backfill-og-images.mjs` filled the images that existed before. This function deliberately IGNORES the `og-images` bucket (it holds JPEG by
design; its bucket list and `webhook.sql` name the four image buckets only): a JPEG there is the intended content, never a raster to convert.
A future version may also build the derivative for an image that arrived without the browser pipeline (call `public.og_image_path(source)` for the target path).
