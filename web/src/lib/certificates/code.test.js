import { describe, expect, it } from 'vitest'
import { formatCertCodeInput, normalizeCertCode } from './code.js'

describe('certificate code normalisation (same rules as the server)', () => {
  it('formats any case / separators into XXXX-XXXX-XXXX', () => {
    expect(normalizeCertCode('ab12cd34ef56')).toBe('AB12-CD34-EF56')
    expect(normalizeCertCode(' ab12 cd34-ef56 ')).toBe('AB12-CD34-EF56')
    expect(normalizeCertCode('AB12-CD34-EF56')).toBe('AB12-CD34-EF56')
  })
  it('maps the Crockford look-alikes (O -> 0, I and L -> 1)', () => {
    expect(normalizeCertCode('0O0O-1I1L-0000')).toBe('0000-1111-0000')
  })
  it('rejects wrong lengths, the letter U and junk', () => {
    expect(normalizeCertCode('AB12-CD34')).toBeNull()
    expect(normalizeCertCode('AB12-CD34-EF56-GH78')).toBeNull()
    expect(normalizeCertCode('ABCD-EFGH-JKMU')).toBeNull()
    expect(normalizeCertCode('')).toBeNull()
    expect(normalizeCertCode(null)).toBeNull()
    expect(normalizeCertCode('ab12<script>')).toBeNull()
  })
  it('formats while typing', () => {
    expect(formatCertCodeInput('ab12cd')).toBe('AB12-CD')
    expect(formatCertCodeInput('ab12cd34ef56zz99')).toBe('AB12-CD34-EF56')
    expect(formatCertCodeInput('ab1')).toBe('AB1')
    expect(formatCertCodeInput('')).toBe('')
  })
})
