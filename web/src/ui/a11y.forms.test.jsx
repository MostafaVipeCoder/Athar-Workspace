import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field.jsx'
import { BilingualField } from './BilingualField.jsx'
import { focusFirstInvalid } from './focusFirstInvalid.js'

describe('form error wiring (review: errors were not announced and were not tied to their fields)', () => {
  it('Field: the error is an alert, the control is aria-invalid and described by it', () => {
    render(<Field label="E-mail" error="Not valid" />)
    const input = screen.getByLabelText('E-mail')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Not valid')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
  })

  it('BilingualField: ONE message for the pair, and BOTH inputs are aria-invalid and described by it', () => {
    render(<BilingualField label="Title" value={{ en: '', ar: '' }} onChange={() => {}} error="The Arabic title is required." labels={{ en: 'English', ar: 'Arabic' }} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The Arabic title is required.')
    for (const name of ['English', 'Arabic']) {
      const input = screen.getByLabelText(name)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    }
  })

  it('BilingualField without an error stays quiet (no alert, no aria-invalid)', () => {
    render(<BilingualField label="Title" value={{ en: 'x', ar: '' }} onChange={() => {}} labels={{ en: 'English', ar: 'Arabic' }} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('English')).not.toHaveAttribute('aria-invalid')
  })

  it('focusFirstInvalid focuses the first aria-invalid control of a form and says whether it found one', () => {
    render(<form data-testid="f"><input aria-label="ok" /><input aria-label="bad one" aria-invalid="true" /><input aria-label="bad two" aria-invalid="true" /></form>)
    expect(focusFirstInvalid(screen.getByTestId('f'))).toBe(true)
    expect(screen.getByLabelText('bad one')).toHaveFocus()
    render(<form data-testid="g"><input aria-label="fine" /></form>)
    expect(focusFirstInvalid(screen.getByTestId('g'))).toBe(false)
  })
})
