import { describe, expect, it } from 'vitest'
import { describeReport, formatBytes, ltr } from './format.js'

describe('formatBytes', () => {
  it('uses B / KB / MB with Western digits', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(180 * 1024)).toBe('180 KB')
    expect(formatBytes(2.1 * 1024 * 1024)).toBe('2.1 MB')
    expect(formatBytes(24 * 1024 * 1024)).toBe('24 MB')
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(null)).toBe('')
  })
  it('speaks Arabic units for the Arabic UI (the Library shows a file size per resource)', () => {
    expect(formatBytes(2048, 'ar')).toBe('2 ك.ب')
    expect(formatBytes(900, 'ar')).toBe('900 بايت')
  })
})

describe('describeReport: the "optimised" sentence', () => {
  it('reports the saving, or the plain conversion when WebP is not smaller', () => {
    const a = describeReport({ kind: 'converted', sourceBytes: 2.1 * 1024 * 1024, bytes: 180 * 1024 })
    expect(a.key).toBe('image.optimised')
    expect(a.vars).toEqual({ from: ltr('2.1 MB'), to: ltr('180 KB'), percent: ltr('-92%') })
    expect(describeReport({ kind: 'converted', sourceBytes: 1000, bytes: 1400 }).key).toBe('image.converted')
    // 99.6% saved is shown as -99%, never -100% (the stored file still has bytes)
    expect(describeReport({ kind: 'converted', sourceBytes: 16 * 1024 * 1024, bytes: 66 * 1024 }).vars.percent).toBe(ltr('-99%'))
  })
  it('kept WebP and vector have their own sentences', () => {
    expect(describeReport({ kind: 'kept', sourceBytes: 90 * 1024, bytes: 90 * 1024 })).toEqual({ key: 'image.kept', vars: { to: ltr('90 KB') } })
    expect(describeReport({ kind: 'vector', sourceBytes: 4096, bytes: 4096 }).key).toBe('image.vector')
  })
})
