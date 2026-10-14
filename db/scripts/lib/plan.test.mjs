// node --test db/scripts/lib/plan.test.mjs   (no dependencies: the pure decisions of convert-images.mjs / backfill-og-images.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isConvertible, isRaster, manifestLine, ogPathOf, planTarget, policyOf } from './plan.mjs'

test('isConvertible: a raster in any bucket EXCEPT og-images, which holds JPEG by design (the converter must never touch the link-preview derivatives)', () => {
  for (const b of ['public-assets', 'event-assets', 'migration-archive', 'resources', 'founder-assets', 'form-uploads', 'certificate-templates']) assert.equal(isConvertible(b, 'a/b.jpg', 'image/jpeg'), true, b)
  assert.equal(isConvertible('og-images', 'o/cover/00000000-0000-4000-8000-000000000001.jpg', 'image/jpeg'), false)
  assert.equal(isConvertible('og-images', 'x.png'), false)
  assert.equal(isConvertible('public-assets', 'a.webp', 'image/webp'), false)
})

test('isRaster: by name (any case) or by recorded mimetype, never WebP / SVG / PDF', () => {
  for (const n of ['a.png', 'A.PNG', 'b.jpg', 'b.JPG', 'c.jpeg', 'd.jfif', 'e.gif', 'f.bmp', 'g.tif', 'g.tiff', 'h.heic', 'i.heif', 'j.avif']) assert.equal(isRaster(n), true, n)
  for (const n of ['a.webp', 'a_t.webp', 'b.svg', 'c.pdf', 'd.txt', 'e.docx', 'png', 'x.png.bak']) assert.equal(isRaster(n), false, n)
  assert.equal(isRaster('a.webp', 'image/png'), true) // a WebP NAME recorded as a PNG is still a raster
  assert.equal(isRaster('a.bin', 'image/jpeg'), true)
  assert.equal(isRaster('a.bin', 'application/pdf'), false)
})

test('planTarget: same folder, same base name, .webp (+ _t where the bucket carries thumbnails)', () => {
  const taken = new Set()
  assert.deepEqual(planTarget('experts/photo.JPG', taken), { webp: 'experts/photo.webp', thumb: null })
  assert.deepEqual(planTarget('uuid-folder/cover/abc.png', new Set(), { thumb: true }), { webp: 'uuid-folder/cover/abc.webp', thumb: 'uuid-folder/cover/abc_t.webp' })
  assert.deepEqual(planTarget('top.png', new Set()), { webp: 'top.webp', thumb: null }) // no folder
})

test('planTarget: a collision puts the old extension in the name, then a counter; the names are claimed', () => {
  const taken = new Set(['a/b.webp'])
  assert.equal(planTarget('a/b.png', taken).webp, 'a/b-png.webp') // a stored a/b.webp belongs to somebody else
  assert.equal(planTarget('a/b.jpg', taken).webp, 'a/b-jpg.webp')
  assert.equal(planTarget('a/b.jpg', taken).webp, 'a/b-jpg-2.webp') // the same original twice in one run cannot happen, but the counter holds
  assert.ok(taken.has('a/b-png.webp') && taken.has('a/b-jpg.webp'))
})

test('planTarget: x.png and x_t.png in a thumbnail bucket do not fight over x_t.webp', () => {
  const taken = new Set()
  const first = planTarget('o/k/x.png', taken, { thumb: true })
  const second = planTarget('o/k/x_t.png', taken, { thumb: true })
  assert.deepEqual(first, { webp: 'o/k/x.webp', thumb: 'o/k/x_t.webp' })
  assert.notEqual(second.webp, first.thumb)
  assert.notEqual(second.webp, first.webp)
})

test('policyOf: the folder kind picks the size; the archives use 1600 px / 400 KB; thumbnails only where the convention applies', () => {
  assert.deepEqual(policyOf('public-assets', 'P/cover/a.png'), { maxPx: 1920, target: 500 * 1024, thumb: 320 })
  assert.deepEqual(policyOf('public-assets', 'global/company-logo/a.png'), { maxPx: 512, target: 90 * 1024, thumb: 320 })
  assert.deepEqual(policyOf('event-assets', 'experts/a.jpg'), { maxPx: 1600, target: 400 * 1024, thumb: 0 })
  assert.deepEqual(policyOf('migration-archive', 'external/a.jpg'), { maxPx: 1600, target: 400 * 1024, thumb: 0 })
  assert.equal(policyOf('form-uploads', 'p/n/a.png').maxPx, 2000)
})

test('ogPathOf: <owner>/<kind>/<uuid>.webp -> .jpg; thumbnails, SVG and rasters have none', () => {
  assert.equal(ogPathOf('P/og/abc.webp'), 'P/og/abc.jpg')
  assert.equal(ogPathOf('P/project-cover/ABC.WEBP'), 'P/project-cover/ABC.jpg')
  for (const p of ['P/og/abc_t.webp', 'P/logo/a.svg', 'P/cover/a.png', '', null, undefined]) assert.equal(ogPathOf(p), '', String(p))
})

test('manifestLine: quotes what needs quoting', () => {
  assert.equal(manifestLine({ at: 't', bucket: 'b', path: 'a,b/"c".png', bytes: 5, sha256: 'ff', status: 'deleted', replacedBy: 'a.webp', replacedByBytes: 2, note: '' }), 't,b,"a,b/""c"".png",5,ff,deleted,a.webp,2,')
})
