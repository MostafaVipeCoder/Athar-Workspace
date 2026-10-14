import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'

const show = (props) => renderWithProviders(<ConfirmDialog open title="Leave without saving?" message="Your edits are lost." confirmLabel="Leave" cancelLabel="Stay" onConfirm={() => {}} onCancel={() => {}} {...props} />)

describe('ConfirmDialog first focus', () => {
  it('a DESTRUCTIVE confirmation starts on the safe button (Stay), so Enter / Space never discards unsaved work', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    show({ destructive: true, onConfirm, onCancel })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a normal confirmation keeps the focus on its confirm button', async () => {
    show({ destructive: false })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave' })).toHaveFocus())
  })
})
