import { describe, expect, it } from 'vitest'
import { TEMPLATE_RULES, checkTemplateSize, templateMime, validateTemplateFile } from './templateFile.js'

const file = (name, type, size) => ({ name, type, size })

describe('template file rules', () => {
  it('accepts PNG and JPEG up to 10 MB, by type or by extension', () => {
    expect(validateTemplateFile(file('a.png', 'image/png', 1000))).toBeNull()
    expect(validateTemplateFile(file('a.jpg', 'image/jpeg', 1000))).toBeNull()
    expect(validateTemplateFile(file('a.JPEG', '', 1000))).toBeNull()
    expect(templateMime(file('x.jpeg', '', 1))).toBe('image/jpeg')
  })
  it('rejects empty files, other types (incl. PDF in this build) and files over 10 MB', () => {
    expect(validateTemplateFile(file('a.png', 'image/png', 0))).toBe('empty')
    expect(validateTemplateFile(null)).toBe('empty')
    expect(validateTemplateFile(file('a.pdf', 'application/pdf', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.gif', 'image/gif', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.svg', 'image/svg+xml', 1000))).toBe('type')
    expect(validateTemplateFile(file('a.png', 'image/png', TEMPLATE_RULES.maxBytes + 1))).toBe('size')
  })
})

describe('template resolution and aspect checks', () => {
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
