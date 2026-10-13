# Asset report - stage 2b (LOCAL Storage only)

Generated from `migration.asset_map`, `migration.asset_result`, `migration.v_asset_failures` after `db/scripts/run-stage2b.sh`.
Nothing touched the live project. Personal data is not listed beyond the display names the owner needs to act on.

## 1. For the owner: external images that could NOT be downloaded (3 of 61)
Each of these URLs is a Google Drive link that answers with an HTML page (not shared publicly, or deleted), so no image could be fetched.
The `photo_path` of the row was set to NULL (the app shows the placeholder); the original URL is kept in `migration.asset_map.old_path`
(`status = 'failed'`, reason in `note` / `migration.asset_result`) and the owning row in `migration.asset_refs`. Flag `asset_image_unreachable` (3 open).

| Entity kind | Display name | Reason |
|---|---|---|
| network_experts (expert photo) | Moustafa Nabil | Drive returned an HTML page (not an image): file private or deleted |
| network_experts (expert photo) | Samar Moussa | same |
| network_experts (expert photo) | Lisa Janssen | same |

Owner action: share the three Drive files as "anyone with the link" (or send new photos), then re-run `bash db/scripts/run-stage2b.sh`
(only non-done items are retried; paths are restored automatically for items that succeed), or upload photos through the new app.
Query for the current list: `select * from migration.v_asset_failures;`.

## 2. Results
| Item | Count | Bytes |
|---|---|---|
| event-assets originals moved (re-encoded) to `public-assets` | 41 (17 expert photos, 4 company logos, 7 covers, 5 form covers, 4 landing, 2 og, 2 answer logos) | 20,500,703 original -> 1,789,638 full + 248,916 thumbnails |
| PDFs copied unchanged to private `resources` | 5 | 10,354,348 (byte-identical, verified) |
| external images downloaded and stored in `public-assets` | 58 of 61 | 25,409,163 original -> 2,479,080 full + 400,050 thumbnails |
| external image originals archived in private bucket `migration-archive/external/` | 58 | 25,409,163 |
| external images failed | 3 | - |
| static (app-relative `/athar-dot.svg`, not a storage object) | 1 | skipped, path NULL as in stage 2a |

By kind (done): expert-photo 37 (17 bucket + 20 external), company-logo 42 (4 bucket + 38 external), project-cover 7, form-cover 5, landing 4, og 2, answer-logo 2, resource 5.
Buckets after: `public-assets` 198 objects / 4,917,684 bytes (99 images x full + `_t` thumbnail), `resources` 5 / 10,354,348, `migration-archive` 58 / 25,409,163,
`event-assets` 112 / 72,911,628 (unchanged, kept as the original archive).

## 3. Image variants (design 04 section 6.9)
Done with `sharp` (Node, installed in a scratch dir outside the repo): full = WebP q82, max 1600 px (no enlargement, EXIF rotation applied);
thumbnail = WebP q78, max 320 px at `<same path>_t.webp` (convention, no second column). Objects are uploaded with `cache-control: max-age=31536000`.
Originals are kept: bucket originals stay untouched in `event-assets`; external originals are in `migration-archive/external/<uuid>.<ext>`.
The largest production photo (24 MB) is now a small WebP. Animated GIFs (if any) would keep only the first frame (none detected).

## 4. Objects NOT referenced by migrated data (preserved, not deleted)
59 objects of `event-assets` are referenced by no migrated row. They stay where they are (bucket `event-assets`, still public, 112 objects, byte-identical to the
production export: this is the documented archive location, design 05 phase 13 step 4 / OD-6). By top folder: experts 29 (18 of them metadata-only, see below),
visuals 18, startup-logos 3, og-images 2, posters 2, library 2, join-athar 1, portal-uploads 1, `test.txt` 1.
Query: `select name from storage.objects o where bucket_id='event-assets' and name not like '%.emptyFolderPlaceholder' and not exists (select 1 from migration.asset_map m where m.old_path=o.name);`
Plus 7 zero-byte `.emptyFolderPlaceholder` objects (59 + 46 referenced + 7 = 112).

### The 18 production metadata-only objects
`event-assets` `experts/c1522ab6-89d1-4431-9b1c-74696b44518b/*.jpeg`: metadata rows exist, no file exists anywhere (already missing on production).
None is referenced by any migrated row (asset_map has no such source in state != done). They are left as they are in the archive bucket and listed by
`select name from storage.objects where bucket_id='event-assets' and name like 'experts/c1522ab6%'` filtered to those answering HTTP non-200
(verify script counts 18). Owner: delete the stale rows when retiring `event-assets` (OD-6).

## 5. Verification
`bash db/scripts/verify-stage2b.sh`: 17 PASS, 0 FAIL (details in `MIGRATION-LOG.md`).
