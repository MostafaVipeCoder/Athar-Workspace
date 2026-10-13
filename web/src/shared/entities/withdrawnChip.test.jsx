import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/render.jsx'
import { translate, translatePlural } from '../../i18n/core.js'
import './i18n.js'
import { WithdrawnChip } from './WithdrawnChip.jsx'

describe('WithdrawnChip: the ONE chip of decision 17.1', () => {
  it('is a red badge with the shared words, and the PM-only reason as its tooltip', () => {
    renderWithProviders(<WithdrawnChip reason="moved abroad" />, { route: '/?lang=en' })
    const chip = screen.getByTestId('withdrawn-chip')
    expect(chip).toHaveTextContent('Withdrawn')
    expect(chip).toHaveAttribute('title', 'Reason: moved abroad')
    expect(chip.className).toMatch(/text-destructive-text/) // the dark red: AA on its tint
    expect(chip.className).not.toMatch(/opacity-/)
  })
  it('takes its own test id and class (the call sites keep theirs)', () => {
    renderWithProviders(<WithdrawnChip data-testid="mentor-withdrawn" className="ms-1" />, { route: '/?lang=en' })
    expect(screen.getByTestId('mentor-withdrawn')).toHaveClass('ms-1')
    expect(screen.getByTestId('mentor-withdrawn')).not.toHaveAttribute('title')
  })
  it('speaks Arabic', () => {
    renderWithProviders(<WithdrawnChip />, { route: '/?lang=ar' })
    expect(screen.getByTestId('withdrawn-chip')).toHaveTextContent('منسحب')
  })
})

describe('the bulk Withdrawn sentences have all six Arabic plural forms (review: "2 عناصر" / "11 عناصر" were wrong)', () => {
  const ar = (key, n) => translatePlural('ar', key, n)
  it('the dialog title', () => {
    expect(ar('entity.withdraw.titleMany', 2)).toBe('تحديد عنصرين كمنسحبين؟')
    expect(ar('entity.withdraw.titleMany', 5)).toBe('تحديد 5 عناصر كمنسحبة؟')
    expect(ar('entity.withdraw.titleMany', 11)).toBe('تحديد 11 عنصراً كمنسحب؟')
    expect(ar('entity.withdraw.titleMany', 100)).toBe('تحديد 100 عنصر كمنسحب؟')
  })
  it('the done / reinstated toasts', () => {
    expect(ar('entity.withdraw.doneMany', 2)).toBe('تم تحديد عنصرين كمنسحبين.')
    expect(ar('entity.withdraw.doneMany', 7)).toBe('تم تحديد 7 عناصر كمنسحبة.')
    expect(ar('entity.withdraw.doneMany', 12)).toBe('تم تحديد 12 عنصراً كمنسحب.')
    expect(ar('entity.withdraw.reinstatedMany', 2)).toBe('أُلغي انسحاب عنصرين.')
    expect(ar('entity.withdraw.reinstatedMany', 3)).toBe('أُلغي انسحاب 3 عناصر.')
    expect(ar('entity.withdraw.reinstatedMany', 30)).toBe('أُلغي انسحاب 30 عنصراً.')
  })
  it('English singular / plural', () => {
    expect(translatePlural('en', 'entity.withdraw.titleMany', 1)).toBe('Mark 1 item as withdrawn?')
    expect(translatePlural('en', 'entity.withdraw.titleMany', 4)).toBe('Mark 4 items as withdrawn?')
    expect(translatePlural('en', 'entity.withdraw.doneMany', 3)).toBe('3 items marked as withdrawn.')
  })
  it('the body no longer says "تبقى تراهم أنت"', () => {
    expect(translate('ar', 'entity.withdraw.body')).not.toMatch(/تبقى تراهم/)
  })
})
