import { describe, expect, it } from 'vitest'
import {
  SAMPLES, anchorX, certValues, defaultField, detectDirection, fieldBox, fieldFromRow, fieldToRow, fontString, formatCertDate, layoutText, moveField, normalizeField,
  nudge, resizeField, sortFields, validateFields, wrapLines,
} from './layout.js'

// a fake text metric: every character is `px / 2` wide (deterministic, no canvas)
const measure = (s, px) => s.length * px * 0.5

describe('fractional placement', () => {
  it('turns fractions into pixels of any canvas size (the preview scale never matters)', () => {
    const f = defaultField('participant_name') // x .5, y .46, w .6, size .045
    const big = fieldBox(f, 3508, 2480)
    const small = fieldBox(f, 1000, 707)
    expect(big.cx).toBeCloseTo(1754)
    expect(big.cy).toBeCloseTo(0.46 * 2480)
    expect(big.width).toBeCloseTo(0.6 * 3508)
    expect(big.fontPx).toBeCloseTo(0.045 * 3508)
    // the same fractions on a smaller canvas = the same picture, scaled
    expect(small.cx / 1000).toBeCloseTo(big.cx / 3508)
    expect(small.width / 1000).toBeCloseTo(big.width / 3508)
    expect(small.fontPx / 1000).toBeCloseTo(big.fontPx / 3508)
  })

  it('the QR box is a square whose side is a fraction of the width, centred on (x, y)', () => {
    const qr = defaultField('verification_qr')
    const box = fieldBox(qr, 2000, 1000)
    expect(box.width).toBe(box.height)
    expect(box.width).toBeCloseTo(0.1 * 2000)
    expect(box.left + box.width / 2).toBeCloseTo(0.9 * 2000)
    expect(box.top + box.height / 2).toBeCloseTo(0.82 * 1000)
  })

  it('clamps fractions into their legal ranges and keeps the QR square', () => {
    const f = normalizeField({ var: 'participant_name', x: 1.7, y: -3, w: 9, size: 5, color: 'red', weight: 123, align: 'diagonal', direction: 'up', maxLines: 99 })
    expect(f.x).toBe(1)
    expect(f.y).toBe(0)
    expect(f.w).toBe(1)
    expect(f.size).toBe(0.2)
    expect(f.color).toBe('#1a1a2e')
    expect([400, 500, 700, 800]).toContain(f.weight)
    expect(f.align).toBe('center')
    expect(f.direction).toBe('auto')
    expect(f.maxLines).toBe(4)
    const q = normalizeField({ var: 'verification_qr', x: 0.5, y: 0.5, w: 0.9, size: 0.02 })
    expect(q.w).toBe(0.5)
    expect(q.size).toBe(q.w)
  })

  it('moves by fractions of the canvas (never off the page) and resizes around the centre', () => {
    const f = defaultField('program_name')
    const moved = moveField(f, 0.1, -0.2)
    expect(moved.x).toBeCloseTo(0.6)
    expect(moved.y).toBeCloseTo(0.42)
    expect(moveField(f, 5, 5)).toMatchObject({ x: 1, y: 1 })
    const wider = resizeField(f, 0.1)
    expect(wider.w).toBeCloseTo(f.w + 0.1)
    expect(wider.x).toBe(f.x)
    const qr = resizeField(defaultField('verification_qr'), 0.05)
    expect(qr.w).toBeCloseTo(0.15)
    expect(qr.size).toBeCloseTo(0.15)
    expect(nudge(f, 'ArrowLeft', 0.01).x).toBeCloseTo(f.x - 0.01)
    expect(nudge(f, 'Enter', 0.01)).toBe(f)
  })

  it('round-trips a field through the DB row shape', () => {
    const f = { ...defaultField('company_name'), x: 0.123456789, color: '#ABCDEF', shrinkToFit: true }
    const row = fieldToRow(f)
    expect(row).toMatchObject({ var: 'company_name', max_lines: 1, shrink_to_fit: true, color: '#abcdef' })
    expect(row.x).toBe(0.12346)
    expect(fieldFromRow(row)).toEqual(normalizeField(f))
  })

  it('sorts fields by variable and validates the draft', () => {
    const fields = [defaultField('verification_qr'), defaultField('participant_name')]
    expect(sortFields(fields).map((f) => f.var)).toEqual(['participant_name', 'verification_qr'])
    expect(validateFields(fields)).toEqual([])
    expect(validateFields([defaultField('program_name')])).toEqual([{ code: 'noName' }])
    expect(validateFields([defaultField('participant_name'), defaultField('participant_name')])).toContainEqual({ code: 'duplicate', var: 'participant_name' })
  })
})

describe('text layout: auto-fit width, wrapping, direction', () => {
  const W = 1000
  const H = 700
  const base = normalizeField({ var: 'participant_name', x: 0.5, y: 0.5, w: 0.5, size: 0.05, shrinkToFit: true }) // box 500 px, font 50 px

  it('keeps the base size when the text fits', () => {
    const laid = layoutText(measure, 'Sara Ali', base, W, H) // 8 chars * 25 = 200 px
    expect(laid.fontPx).toBeCloseTo(50)
    expect(laid.lines).toHaveLength(1)
    expect(laid.overflow).toBe(false)
  })

  it('shrinks a long name until it fits the box width (auto-fit)', () => {
    const name = 'Alexandria Maximilian Wolfeschlegelstein-Hartmann III' // 54 chars -> 1350 px at 50 px
    const laid = layoutText(measure, name, base, W, H)
    expect(laid.fontPx).toBeLessThan(50)
    expect(laid.lines).toHaveLength(1)
    expect(laid.lines[0].width).toBeLessThanOrEqual(500.5)
    expect(laid.overflow).toBe(false)
  })

  it('never shrinks below 35 % of the base size and reports the overflow instead', () => {
    const laid = layoutText(measure, 'x'.repeat(400), base, W, H)
    expect(laid.fontPx).toBeCloseTo(50 * 0.35, 0)
    expect(laid.overflow).toBe(true)
  })

  it('without auto-fit the size is kept and the overflow is reported', () => {
    const laid = layoutText(measure, 'x'.repeat(60), { ...base, shrinkToFit: false }, W, H)
    expect(laid.fontPx).toBe(50)
    expect(laid.overflow).toBe(true)
  })

  it('wraps on word boundaries up to max lines and never cuts a word', () => {
    const lines = wrapLines((s) => s.length * 10, 'aaa bbb ccc ddd eee', 70, 3)
    expect(lines).toEqual(['aaa bbb', 'ccc ddd', 'eee'])
    expect(wrapLines((s) => s.length * 10, 'abcdefghijkl mn', 50, 2)).toEqual(['abcdefghijkl', 'mn'])
    expect(wrapLines((s) => s.length * 10, '  one   two ', 1000, 1)).toEqual(['one two'])
    expect(wrapLines(measure, '   ', 100, 2)).toEqual([])
  })

  it('a multi-line field shrinks only when the lines still do not fit', () => {
    const f = normalizeField({ ...base, maxLines: 2, w: 0.5 })
    const two = layoutText(measure, 'one two three four five six', f, W, H) // wraps at 500 px / 25 px per char = 20 chars
    expect(two.lines.length).toBeLessThanOrEqual(2)
    expect(two.overflow).toBe(false)
  })

  it('detects the direction of the first strong character (Arabic is RTL, Latin LTR) unless forced', () => {
    expect(detectDirection('عبد الرحمن')).toBe('rtl')
    expect(detectDirection('  123 Sara')).toBe('ltr')
    expect(detectDirection('٣ أحمد')).toBe('rtl')
    expect(detectDirection('', 'auto')).toBe('ltr')
    expect(detectDirection('Sara', 'rtl')).toBe('rtl')
    expect(detectDirection('أحمد', 'ltr')).toBe('ltr')
  })

  it('uses a taller line for right-to-left text', () => {
    const ltr = layoutText(measure, 'Sara', base, W, H)
    const rtl = layoutText(measure, 'سارة', base, W, H)
    expect(rtl.direction).toBe('rtl')
    expect(rtl.lineHeight).toBeGreaterThan(ltr.lineHeight)
  })

  it('anchors the text to the left edge, the centre or the right edge of the box', () => {
    const box = fieldBox(base, W, H)
    expect(anchorX({ ...base, align: 'left' }, box)).toBe(box.left)
    expect(anchorX({ ...base, align: 'center' }, box)).toBe(box.cx)
    expect(anchorX({ ...base, align: 'right' }, box)).toBe(box.left + box.width)
  })

  it('builds the canvas font string with the Arabic fallback behind every Latin font', () => {
    expect(fontString(normalizeField({ var: 'participant_name', font: 'Manrope', weight: 600 }), 48)).toBe('600 48px "Manrope", "Tajawal", sans-serif')
    expect(fontString(normalizeField({ var: 'participant_name', font: 'Tajawal', weight: 800 }), 31.234)).toBe('800 31.23px "Tajawal", sans-serif')
  })
})

describe('printed values', () => {
  it('formats dates in the template language with Western digits', () => {
    expect(formatCertDate('2026-10-12', 'en')).toBe('12 October 2026')
    const ar = formatCertDate('2026-10-12', 'ar')
    expect(ar).toMatch(/12/)
    expect(ar).toMatch(/2026/)
    expect(ar).toMatch(/أكتوبر|اكتوبر|أكتوبر/)
    expect(formatCertDate(null)).toBe('')
    expect(formatCertDate('not a date')).toBe('')
  })

  it('maps a snapshot + code to every variable', () => {
    const v = certValues({ participant_name: 'Sara Ali', company_name: 'Nile Labs', program_name: 'Athar', project_name: 'C5', completed_on: '2026-10-12', issued_on: '2026-10-13' }, 'AB12-CD34-EF56', 'en')
    expect(v).toEqual({ participant_name: 'Sara Ali', company_name: 'Nile Labs', program_name: 'Athar', project_name: 'C5', completion_date: '12 October 2026', issue_date: '13 October 2026', verification_code: 'AB12-CD34-EF56' })
    expect(certValues(null, null).participant_name).toBe('')
  })

  it('ships a long Arabic and a long English sample to test overflow', () => {
    expect(SAMPLES.longAr.snapshot.participant_name.length).toBeGreaterThan(30)
    expect(detectDirection(SAMPLES.longAr.snapshot.participant_name)).toBe('rtl')
    expect(SAMPLES.longEn.snapshot.participant_name.length).toBeGreaterThan(40)
    expect(detectDirection(SAMPLES.longEn.snapshot.participant_name)).toBe('ltr')
  })
})
