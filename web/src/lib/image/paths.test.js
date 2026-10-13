import { describe, expect, it } from 'vitest'
import { buildImagePath, isThumbPath, thumbPath, variantsOf } from './paths.js'

describe('image paths', () => {
  it('follows the <owner>/<kind>/<uuid>.webp convention with a derived _t thumbnail', () => {
    expect(buildImagePath('owner', 'cover', 'abc')).toBe('owner/cover/abc.webp')
    expect(buildImagePath('owner', 'logo', 'abc', 'svg')).toBe('owner/logo/abc.svg')
    expect(thumbPath('owner/cover/abc.webp')).toBe('owner/cover/abc_t.webp')
    expect(thumbPath('')).toBe('')
    expect(thumbPath(null)).toBe('')
  })
  it('a thumbnail, an SVG or a legacy raster is its own display file', () => {
    expect(thumbPath('o/k/abc_t.webp')).toBe('o/k/abc_t.webp')
    expect(thumbPath('o/k/abc.svg')).toBe('o/k/abc.svg')
    expect(thumbPath('o/k/abc.png')).toBe('o/k/abc.png')
    expect(isThumbPath('o/k/abc_t.webp')).toBe(true)
    expect(isThumbPath('o/k/abc.webp')).toBe(false)
  })
  it('variantsOf lists the file and its thumbnail once', () => {
    expect(variantsOf('o/k/abc.webp')).toEqual(['o/k/abc.webp', 'o/k/abc_t.webp'])
    expect(variantsOf('o/k/abc.svg')).toEqual(['o/k/abc.svg'])
    expect(variantsOf('')).toEqual([])
  })
})
