import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../test/render.jsx'
import { useToast } from './Toast.jsx'

/** WCAG 2.2.1: a toast with an Undo button must not vanish while the pointer is on it or the focus is inside it. */
function Fire({ withAction = false }) {
  const toast = useToast()
  return <button type="button" onClick={() => toast.success('Saved', withAction ? { action: { label: 'Undo', onClick: () => {} } } : undefined)}>fire</button>
}
const fire = () => fireEvent.click(screen.getByText('fire'))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Toast timing', () => {
  it('dismisses itself after 5 seconds', () => {
    renderWithProviders(<Fire />)
    fire()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(4900) })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('stays while the pointer is over it, then leaves after the remaining time (at least one second)', () => {
    renderWithProviders(<Fire />)
    fire()
    const toast = screen.getByText('Saved').closest('[role="status"]')
    act(() => { vi.advanceTimersByTime(3000) })
    fireEvent.mouseEnter(toast)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Saved')).toBeInTheDocument() // paused
    fireEvent.mouseLeave(toast)
    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.getByText('Saved')).toBeInTheDocument() // 2 s were left, never less than 1 s
    act(() => { vi.advanceTimersByTime(2200) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('stays while the keyboard focus is on its Undo button, and resumes when the focus leaves the toast', () => {
    renderWithProviders(<Fire withAction />)
    fire()
    const undo = screen.getByRole('button', { name: 'Undo' })
    undo.focus()
    fireEvent.focus(undo)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    fireEvent.blur(undo, { relatedTarget: document.body })
    act(() => { vi.advanceTimersByTime(5200) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('moving the focus from Undo to the close button inside the same toast does not resume the countdown', () => {
    renderWithProviders(<Fire withAction />)
    fire()
    const undo = screen.getByRole('button', { name: 'Undo' })
    const close = screen.getAllByRole('button').find((b) => b !== undo && b.closest('[role="status"]'))
    fireEvent.focus(undo)
    fireEvent.blur(undo, { relatedTarget: close })
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
})
