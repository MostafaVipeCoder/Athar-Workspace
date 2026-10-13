import { describe, expect, it } from 'vitest'
import { BUTTON_SIZES, BUTTON_VARIANTS, buttonClass } from './buttonStyles.js'

/** Review: the destructive variant was white on #f56c6c (2.82:1); a second, hand-patched way to draw a danger button existed in WithdrawDialog. */
describe('button styles', () => {
  it('destructive is filled with the DARK error red (about 6.5:1 with white), not the pale site red used for tints and borders', () => {
    expect(BUTTON_VARIANTS.destructive).toMatch(/\bbg-destructive-text\b/)
    expect(BUTTON_VARIANTS.destructive).not.toMatch(/\bbg-destructive\b(?!-)/)
    expect(buttonClass({ variant: 'destructive' })).toMatch(/text-destructive-foreground/)
  })
  it('a small button is a 44 px tap target on a phone and compact (36 px) from the lg breakpoint', () => {
    expect(BUTTON_SIZES.sm).toMatch(/\bmin-h-11\b/)
    expect(BUTTON_SIZES.sm).toMatch(/\blg:min-h-9\b/)
    expect(BUTTON_SIZES.md).toMatch(/\bmin-h-11\b/)
  })
})
