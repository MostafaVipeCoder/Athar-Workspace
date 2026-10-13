import { describe, expect, it } from 'vitest'
import { drawQr, qrMatrix } from './qr.js'

describe('local QR generation', () => {
  it('encodes a verification URL into a square module matrix (21 + 4k modules)', () => {
    const m = qrMatrix('https://app.example/verify/AB12-CD34-EF56')
    expect(m.size).toBeGreaterThanOrEqual(21)
    expect((m.size - 21) % 4).toBe(0)
    expect(m.modules).toHaveLength(m.size)
    expect(m.modules.every((r) => r.length === m.size)).toBe(true)
  })

  it('has the three finder patterns in the corners and is deterministic', () => {
    const a = qrMatrix('https://app.example/verify/AB12-CD34-EF56')
    const b = qrMatrix('https://app.example/verify/AB12-CD34-EF56')
    expect(a.modules).toEqual(b.modules)
    const n = a.size
    const finder = (r0, c0) => {
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 7; j += 1) {
          const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3))
          const expected = ring !== 2 // 7x7 dark ring, 5x5 light ring, 3x3 dark centre
          if (a.modules[r0 + i][c0 + j] !== expected) return false
        }
      }
      return true
    }
    expect(finder(0, 0)).toBe(true)
    expect(finder(0, n - 7)).toBe(true)
    expect(finder(n - 7, 0)).toBe(true)
  })

  it('different codes give different matrices; an empty text is refused', () => {
    expect(qrMatrix('https://x.example/verify/AAAA-AAAA-AAAA').modules).not.toEqual(qrMatrix('https://x.example/verify/BBBB-BBBB-BBBB').modules)
    expect(() => qrMatrix('')).toThrow(/nothing to encode/)
  })

  it('draws a white quiet zone and snapped dark modules inside the given square', () => {
    const rects = []
    const ctx = { fillStyle: '', fillRect: (...a) => rects.push([ctx.fillStyle, ...a]) }
    const m = qrMatrix('hi')
    drawQr(ctx, m, 100, 200, 300)
    expect(rects[0]).toEqual(['#ffffff', 100, 200, 300, 300])
    const dark = rects.slice(1)
    expect(dark.length).toBeGreaterThan(20)
    for (const [color, x, y, w, h] of dark) {
      expect(color).toBe('#000000')
      expect(x).toBeGreaterThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(200)
      expect(x + w).toBeLessThanOrEqual(400 + 1)
      expect(y + h).toBeLessThanOrEqual(500 + 1)
    }
  })

  it('never calls a third-party QR service (the as-is generator leaked every verify URL to a third-party image service)', () => {
    // every non-test source file of the app, as text (Vite glob): none may mention a QR / chart image service
    const sources = import.meta.glob(['/src/**/*.{js,jsx,css}', '!/src/**/*.test.*'], { query: '?raw', import: 'default', eager: true })
    const offenders = Object.entries(sources).filter(([, text]) => /qrserver|chart\.googleapis\.com\/chart|goqr\.me/i.test(text)).map(([path]) => path)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })
})
