// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Owner decision 08 section 17.3 (universal WebP), enforced in the source: no module outside `data/storage.js` writes to Storage,
 * so no image can reach a bucket without going through `lib/image` (convertToWebp). The same rule is an ESLint error (eslint.config.js);
 * this scan also catches what a selector cannot (a raw fetch to the Storage REST API, a renamed client).
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) && !/testFixtures\.js$/.test(name)) out.push(full)
  }
  return out
}
const rel = (f) => relative(SRC, f).split(sep).join('/')
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The ONLY file allowed to call `.upload(`: the storage module (the certificate template upload goes through storeImage since m42). */
const ALLOWED_UPLOAD = ['data/storage.js']

describe('universal WebP: where files are written', () => {
  const files = walk(SRC)

  it('only data/storage.js calls storage .upload() (the certificate template included)', () => {
    const offenders = files.filter((f) => /\.\s*(upload|uploadToSignedUrl)\s*\(/.test(strip(readFileSync(f, 'utf8')))).map(rel)
    expect(offenders.sort()).toEqual([...ALLOWED_UPLOAD].sort())
  })

  it('nobody else opens a second door: no createSignedUploadUrl, no storage .update() replace (review: the lint selector missed both)', () => {
    const offenders = files
      .filter((f) => !ALLOWED_UPLOAD.includes(rel(f)))
      .filter((f) => /\.\s*createSignedUploadUrl\s*\(/.test(strip(readFileSync(f, 'utf8'))) || /\bstorage\s*\.\s*from\s*\([^)]*\)\s*\.\s*update\s*\(/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the lint rule knows about them too (eslint.config.js lists createSignedUploadUrl and the storage .update selectors)', () => {
    const cfg = readFileSync(join(SRC, '..', 'eslint.config.js'), 'utf8')
    expect(cfg).toMatch(/createSignedUploadUrl/)
    expect(cfg).toMatch(/callee\.object\.callee\.object\.property\.name="storage"/)
  })

  it('nobody talks to the Storage REST API by hand (fetch / XHR to /storage/v1/object)', () => {
    const offenders = files.filter((f) => /storage\/v1\/object/.test(strip(readFileSync(f, 'utf8')))).map(rel)
    expect(offenders).toEqual([])
  })

  it('no module hands an image/png or image/jpeg content type to a storage call', () => {
    const offenders = files
      .filter((f) => /contentType:\s*['"`]image\/(png|jpeg|jpg|gif)['"`]/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('data/storage.js never stores a non-WebP raster: the only content types it names are webp and svg', () => {
    const code = strip(readFileSync(join(SRC, 'data/storage.js'), 'utf8'))
    expect(code).not.toMatch(/image\/(png|jpeg|jpg|gif)/)
    expect(code).toMatch(/convertToWebp/)
  })

  it('the old per-feature encoders are gone: lib/image is the one pipeline (no canvas toBlob outside it, the landing PNG export aside)', () => {
    const offenders = files
      .filter((f) => /\.toBlob\s*\(/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
      .filter((f) => !f.startsWith('lib/image/'))
    // the visitor's composed photo and the certificate renderer / PDF writer produce DOWNLOADS (never stored) and are the only other canvases
    expect(offenders.sort()).toEqual(['lib/certificates/pdf.js', 'lib/certificates/render.js', 'nodes/landing-page/photoCompose.js'])
  })
})
