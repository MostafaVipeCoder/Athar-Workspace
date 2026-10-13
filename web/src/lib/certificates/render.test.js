import { describe, expect, it } from 'vitest'
import { canvasToBlob, certificateFileName, ensureFonts, renderCertificate } from './render.js'
import { SAMPLES, certValues, defaultField, normalizeField } from './layout.js'

/** A fake 2D canvas that records every call in order (no DOM canvas in jsdom). Every character is 0.5 em wide. */
function fakeCanvas(log) {
  const ctx = {
    _font: '', fillStyle: '', direction: 'ltr', textAlign: 'left', textBaseline: 'alphabetic',
    get font() { return this._font },
    set font(v) { this._font = v },
    fillRect: (...a) => log.push(['fillRect', ctx.fillStyle, ...a]),
    drawImage: (...a) => log.push(['drawImage', ...a.slice(1)]),
    fillText: (text, x, y) => log.push(['fillText', text, Math.round(x), Math.round(y), ctx.font, ctx.direction, ctx.textAlign, ctx.fillStyle]),
    measureText: (s) => ({ width: s.length * (Number(/(\d+(?:\.\d+)?)px/.exec(ctx._font)?.[1]) || 10) * 0.5 }),
  }
  const canvas = {
    _w: 0, _h: 0,
    get width() { return this._w }, set width(v) { this._w = v; log.push(['width', v]) },
    get height() { return this._h }, set height(v) { this._h = v; log.push(['height', v]) },
    getContext: () => ctx,
    toBlob: (cb, type) => cb(new Blob(['x'], { type })),
  }
  return canvas
}
const image = { width: 2000, height: 1400 }

describe('renderCertificate (fake canvas)', () => {
  it('loads the fonts BEFORE drawing, then paints white, the template, the texts in variable order and the QR last', async () => {
    const log = []
    const order = []
    const fontLoader = async (font, text) => { order.push(font === null ? 'ready' : `load ${font} "${text}"`); log.push(['fonts', font === null ? 'ready' : 'load']) }
    const fields = [defaultField('verification_qr'), defaultField('program_name'), defaultField('participant_name')]
    const values = certValues(SAMPLES.short.snapshot, SAMPLES.short.code, 'en')
    const out = await renderCertificate({ canvas: fakeCanvas(log), image, fields, values, verifyUrl: 'https://app.example/verify/AB12-CD34-EF56', fontLoader })

    const names = log.map((e) => e[0])
    // fonts first (loads, then ready), then the canvas is sized, then painted
    expect(names.indexOf('fonts')).toBe(0)
    expect(order.at(-1)).toBe('ready')
    expect(order[0]).toMatch(/^load 700 32px "Tajawal"/)
    expect(order.some((o) => o.includes('"Sara Ali"'))).toBe(true)
    expect(names.lastIndexOf('fonts')).toBeLessThan(names.indexOf('width'))
    expect(names.indexOf('width')).toBeLessThan(names.indexOf('fillRect'))
    expect(log.find((e) => e[0] === 'fillRect')).toEqual(['fillRect', '#ffffff', 0, 0, 2000, 1400])
    expect(names.indexOf('fillRect')).toBeLessThan(names.indexOf('drawImage'))
    expect(log.find((e) => e[0] === 'drawImage')).toEqual(['drawImage', 0, 0, 2000, 1400])
    // text lines in variable order (participant_name, program_name), then the QR rectangles
    const texts = log.filter((e) => e[0] === 'fillText')
    expect(texts.map((t) => t[1])).toEqual(['Sara Ali', 'Athar Accelerator'])
    expect(names.indexOf('drawImage')).toBeLessThan(names.indexOf('fillText'))
    const lastText = names.lastIndexOf('fillText')
    const firstQrRect = names.findIndex((n, i) => n === 'fillRect' && i > lastText)
    expect(firstQrRect).toBeGreaterThan(lastText)
    expect(out.width).toBe(2000)
    expect(out.boxes.verification_qr.width).toBeCloseTo(0.1 * 2000)
  })

  it('draws Arabic as ONE whole right-to-left line (the browser shapes it), centred on the field', async () => {
    const log = []
    const f = normalizeField({ var: 'participant_name', x: 0.5, y: 0.5, w: 0.6, size: 0.04, shrinkToFit: true })
    const name = SAMPLES.longAr.snapshot.participant_name
    await renderCertificate({ canvas: fakeCanvas(log), image, fields: [f], values: { participant_name: name }, fontLoader: async () => {} })
    const t = log.filter((e) => e[0] === 'fillText')
    expect(t).toHaveLength(1)
    expect(t[0][1]).toBe(name)
    expect(t[0][2]).toBe(1000)
    expect(t[0][5]).toBe('rtl')
    expect(t[0][6]).toBe('center')
    expect(t[0][7]).toBe('#1a1a2e')
  })

  it('applies auto-fit: a long name is drawn smaller than a short one', async () => {
    const sizeOf = async (name) => {
      const log = []
      await renderCertificate({ canvas: fakeCanvas(log), image, fields: [normalizeField({ var: 'participant_name', w: 0.4, size: 0.05, shrinkToFit: true })], values: { participant_name: name }, fontLoader: async () => {} })
      return Number(/(\d+(?:\.\d+)?)px/.exec(log.find((e) => e[0] === 'fillText')[4])[1])
    }
    expect(await sizeOf('Sara Ali')).toBeCloseTo(100)
    expect(await sizeOf(SAMPLES.longEn.snapshot.participant_name)).toBeLessThan(100)
  })

  it('reports overflow and skips empty values', async () => {
    const log = []
    const out = await renderCertificate({
      canvas: fakeCanvas(log), image, fontLoader: async () => {},
      fields: [normalizeField({ var: 'participant_name', w: 0.1, size: 0.05 }), defaultField('company_name')],
      values: { participant_name: 'A very long name that cannot fit', company_name: '' },
    })
    expect(out.overflow.participant_name).toBe(true)
    expect(log.filter((e) => e[0] === 'fillText')).toHaveLength(1)
  })

  it('does not draw the QR without a verify URL', async () => {
    const log = []
    await renderCertificate({ canvas: fakeCanvas(log), image, fields: [defaultField('verification_qr')], values: {}, fontLoader: async () => {} })
    expect(log.filter((e) => e[0] === 'fillRect')).toHaveLength(1) // only the white page
  })

  it('scales to the preview size and caps the long side', async () => {
    const log = []
    const out = await renderCertificate({ canvas: fakeCanvas(log), image: { width: 8000, height: 5600 }, fields: [], values: {}, scale: 1, maxSide: 4000, fontLoader: async () => {} })
    expect(out.width).toBe(4000)
    expect(out.height).toBe(2800)
    const small = await renderCertificate({ canvas: fakeCanvas([]), image, fields: [], values: {}, scale: 0.25, fontLoader: async () => {} })
    expect([small.width, small.height]).toEqual([500, 350])
  })

  it('rejects a template without a size', async () => {
    await expect(renderCertificate({ canvas: fakeCanvas([]), image: { width: 0, height: 0 }, fields: [], values: {}, fontLoader: async () => {} })).rejects.toThrow(/no size/)
  })
})

describe('fonts and export helpers', () => {
  it('asks for each used font once with the exact text, skips the QR, then waits for document.fonts.ready', async () => {
    const calls = []
    const fields = [defaultField('participant_name'), defaultField('participant_name'), defaultField('verification_qr'), defaultField('company_name')]
    await ensureFonts(fields, { participant_name: 'سارة', company_name: 'Nile' }, { fontLoader: async (f, t) => { calls.push([f, t]) } })
    expect(calls.map((c) => c[1])).toEqual(['سارة', 'Nile', null])
    expect(calls.at(-1)).toEqual([null, null])
  })

  it('exports a PNG blob through toBlob', async () => {
    const blob = await canvasToBlob(fakeCanvas([]))
    expect(blob.type).toBe('image/png')
    await expect(canvasToBlob({})).rejects.toThrow(/cannot export/)
  })

  it('names files after the printed name and the code, safely', () => {
    expect(certificateFileName('Sara / Ali: "x"', 'AB12-CD34-EF56')).toBe('Certificate - Sara Ali x - AB12-CD34-EF56.png')
    expect(certificateFileName('', null, 'pdf')).toBe('Certificate.pdf')
  })
})
