import { describe, expect, it } from 'vitest'
import { gifFrames, looksLikeSvg, sniffImage } from './sniff.js'
import { avifBytes, gifBytes, heicBytes, jpegBytes, pdfBytes, pngBytes, svgText, webpBytes } from './testFixtures.js'

const sniff = (bytes) => sniffImage(Uint8Array.from(bytes))

describe('sniffImage: the format comes from the bytes', () => {
  it('reads PNG, JPEG, GIF and WebP sizes', () => {
    expect(sniff(pngBytes({ width: 640, height: 480 }))).toMatchObject({ type: 'png', width: 640, height: 480, animated: false })
    expect(sniff(jpegBytes({ width: 4032, height: 3024 }))).toMatchObject({ type: 'jpeg', width: 4032, height: 3024, animated: false })
    expect(sniff(gifBytes({ width: 100, height: 50 }))).toMatchObject({ type: 'gif', width: 100, height: 50, animated: false })
    expect(sniff(webpBytes({ kind: 'VP8X', width: 1920, height: 1080 }))).toMatchObject({ type: 'webp', width: 1920, height: 1080 })
    expect(sniff(webpBytes({ kind: 'VP8L', width: 300, height: 200 }))).toMatchObject({ type: 'webp', width: 300, height: 200 })
    expect(sniff(webpBytes({ kind: 'VP8 ', width: 321, height: 123 }))).toMatchObject({ type: 'webp', width: 321, height: 123 })
  })

  it('detects animation: GIF frames, APNG, animated WebP', () => {
    expect(sniff(gifBytes({ frames: 1 })).animated).toBe(false)
    expect(sniff(gifBytes({ frames: 3 })).animated).toBe(true)
    expect(sniff(pngBytes({ animated: true })).animated).toBe(true)
    expect(sniff(webpBytes({ animated: true })).animated).toBe(true)
    expect(sniff(webpBytes({ animated: false })).animated).toBe(false)
    expect(gifFrames(Uint8Array.from(gifBytes({ frames: 2 }))).frames).toBe(2)
    // a GIF cut inside its first frame cannot be judged: treated as animated rather than flattened silently
    expect(sniff(gifBytes({ frames: 1 }).slice(0, 25)).animated).toBe(true)
  })

  it('recognises what a browser may not decode or must not store', () => {
    expect(sniff(heicBytes()).type).toBe('heic')
    expect(sniff(avifBytes()).type).toBe('avif')
    expect(sniff(pdfBytes()).type).toBe('pdf')
    expect(sniff([0x42, 0x4d, 0, 0, 0, 0]).type).toBe('bmp')
    expect(sniff([...new TextEncoder().encode(svgText())]).type).toBe('svg')
    expect(sniff([...new TextEncoder().encode('just some text here')]).type).toBe('unknown')
    expect(sniff([1, 2]).type).toBe('unknown')
  })
})

describe('looksLikeSvg', () => {
  it('accepts a BOM, an XML prolog, comments and a doctype before the root', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true)
    expect(looksLikeSvg(String.fromCharCode(0xfeff) + '<?xml version="1.0"?><!-- c --><svg viewBox="0 0 1 1"/>')).toBe(true)
    expect(looksLikeSvg('<!DOCTYPE svg PUBLIC "x" "y"><svg/>')).toBe(true)
    expect(looksLikeSvg('<html><body><svg/></body></html>')).toBe(false)
    expect(looksLikeSvg('')).toBe(false)
  })
})
