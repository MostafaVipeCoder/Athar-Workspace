import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal.jsx'

function Host({ onEscape }) {
  const [text, setText] = useState('')
  // a NEW inline onClose on every keystroke, like most callers
  return (
    <Modal open onClose={() => onEscape(text)} title="Dialog">
      <label>
        Reason
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
    </Modal>
  )
}

describe('Modal', () => {
  it('keeps the focus in a field while the parent re-renders with a new onClose on every keystroke', async () => {
    const user = userEvent.setup()
    render(<Host onEscape={() => {}} />)
    const input = screen.getByLabelText('Reason')
    await user.click(input)
    await user.keyboard('issued twice')
    expect(input).toHaveValue('issued twice')
    expect(input).toHaveFocus()
  })

  it('Escape calls the LATEST onClose', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Host onEscape={spy} />)
    await user.type(screen.getByLabelText('Reason'), 'abc')
    await user.keyboard('{Escape}')
    expect(spy).toHaveBeenCalledWith('abc')
  })
})
