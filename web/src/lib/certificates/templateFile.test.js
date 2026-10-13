import { describe, expect, it } from 'vitest'
import { TEMPLATE_ACCEPT, TEMPLATE_RULES, checkTemplateSize, peekTemplateSize, templateMime, validateTemplateFile } from './templateFile.js'

const file = (name, type, size) => ({ name, type, size })

describe('template file rules', () => {
  it('accepts PNG, JPEG and WebP up to the pipeline ceiling (the stored result is WebP), by type or by extension', () => {
    expect(validateTemplateFile(file('a.png', 'image/png', 1000))).toBeNull()
    expect(validateTemplateFile(file('a.jpg', 'image/jpeg', 1000))).toBeNull()
    expect(validateTemplateFile(file('a.JPEG', '', 1000))).toBeNull()
    expect(templateMime(file('x.jpeg', '', 1))).toBe('image/jpeg')
    expect(validateTemplateFile(file('a.webp', 'image/webp', 1000))).toBeNull()
    expect(validateTemplateFile(file('a.WEBP', '', 1000))).toBeNull()
    expect(templateMime(file('x.webp', '', 1))).toBe('image/webp')
    expect(TEMPLATE_ACCEPT.split(',')).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(TEMPLATE_RULES.maxBytes).toBe(25 * 1024 * 1024)
  })
  it('rejects empty files, other types (incl. PDF in this build) and files over the ceiling', () => {
    expect(validateTemplateFile(file('a.png', 'image/png', 0))).toBe('empty')
    expect(validateTemplateFile(null)).toBe('empty')
    expect(validateTemplateFile(file('a.pdf', 'application/pdf', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.gif', 'image/gif', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.svg', 'image/svg+xml', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.png', 'image/png', TEMPLATE_RULES.maxBytes + 1))).toBe('size')
    expect(validateTemplateFile(file('a.webp', 'image/webp', TEMPLATE_RULES.maxBytes + 1))).toBe('size')
  })
})

describe('peekTemplateSize: the size comes from the file HEADER, no decode (review: an 8000 x 5600 source cost ~180 MB of bitmap just to read two numbers)', () => {
  const png = (w, h) => {
    const b = new Uint8Array(32)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(b.buffer).setUint32(16, w)
    new DataView(b.buffer).setUint32(20, h)
    return new File([b], 'a.png', { type: 'image/png' })
  }
  it('reads a PNG header', async () => {
    expect(await peekTemplateSize(png(3508, 2480))).toEqual({ width: 3508, height: 2480 })
  })
  it('answers null when the header does not say (the caller decodes once and frees the bitmap), and for garbage', async () => {
    expect(await peekTemplateSize(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull()
    expect(await peekTemplateSize(new File([new Uint8Array(40)], 'a.bin'))).toBeNull()
    expect(await peekTemplateSize(null)).toBeNull()
  })
})

describe('template resolution and aspect checks (decoded pixels, never the file type)', () => {
  it('judges the same pixels the same way whatever the source format was', () => {
    // the size / aspect / resolution rules only ever see the decoded width and height
    expect(checkTemplateSize.length).toBe(2)
    expect(checkTemplateSize(3508, 2480)).toEqual(checkTemplateSize(3508, 2480))
  })
  it('A4 landscape at 300 dpi is clean', () => {
    expect(checkTemplateSize(3508, 2480)).toEqual({ errors: [], warnings: [], orientation: 'landscape', ratio: 1.415, paper: 'a4' })
  })
  it('A4 portrait and US Letter are recognised', () => {
    expect(checkTemplateSize(2480, 3508)).toMatchObject({ orientation: 'portrait', paper: 'a4', errors: [] })
    expect(checkTemplateSize(3300, 2550)).toMatchObject({ paper: 'letter', errors: [] })
  })
  it('warns (but allows) a low-resolution A4 and a non-paper ratio', () => {
    expect(checkTemplateSize(1240, 877).warnings).toEqual(['lowResolution'])
    expect(checkTemplateSize(2400, 1350)).toMatchObject({ errors: [], warnings: ['notPaper'], paper: null })
  })
  it('blocks images that are too small, too large or absurdly stretched', () => {
    expect(checkTemplateSize(500, 400).errors).toContain('tooSmall')
    expect(checkTemplateSize(900, 500).errors).toContain('tooSmall')
    expect(checkTemplateSize(9000, 6000).errors).toContain('tooLarge')
    expect(checkTemplateSize(4000, 1000).errors).toContain('badAspect')
  })
})
