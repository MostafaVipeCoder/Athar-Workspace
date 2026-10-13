import { describe, expect, it } from 'vitest'
import { buildPdf, canvasToPdfBlob, deflate, pageSizeFor, rgbaToRgb } from './pdf.js'

const text = (bytes) => new TextDecoder('latin1').decode(bytes)

describe('minimal PDF writer', () => {
  it('chooses A4 / Letter pages for matching proportions and fits other images to an A4 long side', () => {
    const a4 = pageSizeFor(3508, 2480)
    expect([Math.round(a4.w), Math.round(a4.h)]).toEqual([842, 595])
    const a4p = pageSizeFor(2480, 3508)
    expect([Math.round(a4p.w), Math.round(a4p.h)]).toEqual([595, 842])
    expect(pageSizeFor(2200, 1700)).toEqual({ w: 792, h: 612 })
    const wide = pageSizeFor(2000, 1000)
    expect(Math.round(wide.w)).toBe(842)
    expect(Math.round(wide.h)).toBe(421)
  })

  it('writes a well-formed PDF: header, 6 objects, an xref whose offsets point at them, the trailer and the image bytes', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252])
    const pdf = buildPdf({ width: 200, height: 100, kind: 'flate', bytes: payload, title: 'Certificate - Sara' })
    const s = text(pdf)
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toContain('/Filter /FlateDecode')
    expect(s).toContain('/Width 200 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8')
    expect(s).toContain('/Title (Certificate - Sara)')
    // every xref offset points at "<n> 0 obj"
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1])
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const offsets = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(6)
    offsets.forEach((off, i) => expect(s.slice(off, off + 8)).toBe(`${i + 1} 0 obj\n`))
    // the stream carries the exact bytes and /Length matches
    const len = Number(/\/Length (\d+) >>\nstream\n/.exec(s.slice(offsets[4]))[1])
    expect(len).toBe(payload.length)
    const start = pdf.indexOf(payload[0], offsets[4]) // find the first payload byte after the object start
    const streamAt = s.indexOf('stream\n', offsets[4]) + 'stream\n'.length
    expect([...pdf.slice(streamAt, streamAt + len)]).toEqual([...payload])
    expect(start).toBeGreaterThan(0)
  })

  it('embeds a JPEG with DCTDecode', () => {
    const s = text(buildPdf({ width: 10, height: 10, kind: 'jpeg', bytes: new Uint8Array([255, 216, 255, 217]) }))
    expect(s).toContain('/Filter /DCTDecode')
    expect(s).toContain('/Title (Certificate)')
  })

  it('drops non-ASCII and PDF-special characters from the Info title', () => {
    const s = text(buildPdf({ width: 10, height: 10, kind: 'jpeg', bytes: new Uint8Array(2), title: 'شهادة (A) \\ B' }))
    expect(s).toContain('/Title (A    B)')
  })

  it('packs RGBA to RGB, compositing transparency on white', () => {
    const rgb = rgbaToRgb(new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0, 100, 100, 100, 128]))
    expect([...rgb.slice(0, 3)]).toEqual([10, 20, 30])
    expect([...rgb.slice(3, 6)]).toEqual([255, 255, 255])
    expect(rgb[6]).toBeGreaterThan(100)
    expect(rgb[6]).toBeLessThan(255)
  })

  it('deflates with the platform CompressionStream (a zlib stream a PDF reader can inflate)', async () => {
    const raw = new Uint8Array(3000).fill(7)
    const packed = await deflate(raw)
    expect(packed).not.toBeNull()
    expect(packed.length).toBeLessThan(raw.length / 10)
    expect(packed[0]).toBe(0x78) // zlib header
    const source = new ReadableStream({ start(c) { c.enqueue(packed); c.close() } })
    const back = new Uint8Array(await new Response(source.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
    expect(back).toEqual(raw)
  })

  it('canvasToPdfBlob reads the canvas pixels and returns application/pdf', async () => {
    const w = 8
    const h = 4
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const canvas = { width: w, height: h, getContext: () => ({ getImageData: () => ({ data }) }), toBlob: () => { throw new Error('jpeg fallback not expected') } }
    const blob = await canvasToPdfBlob(canvas, { title: 'T' })
    expect(blob.type).toBe('application/pdf')
    const s = text(new Uint8Array(await blob.arrayBuffer()))
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s).toContain('/Width 8 /Height 4')
    expect(s).toContain('/FlateDecode')
  })
})
