import { describe, expect, it, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { useWithdrawFlow } from './useWithdrawFlow.jsx'
import { WithdrawDialog, REASON_MAX } from './WithdrawDialog.jsx'

/** A tiny screen around the hook: one button per action, the dialog rendered once. */
function Harness({ onWithdraw, onReinstate, items }) {
  const flow = useWithdrawFlow({ nameOf: (i) => i.name, onWithdraw, onReinstate })
  return (
    <div>
      <button type="button" onClick={() => flow.withdraw(items)}>open</button>
      <button type="button" onClick={() => flow.reinstate(items)}>reinstate</button>
      {flow.dialog}
    </div>
  )
}
const one = [{ id: 'a', name: 'Alpha Co' }]
const three = [{ id: 'a', name: 'Alpha Co' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }]

describe('Withdrawn dialog and flow (decision 17.1)', () => {
  it('says what happens, trims the optional reason, passes ALL the items, then shows the toast with Undo (= reinstate)', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const onReinstate = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<Harness items={three} onWithdraw={onWithdraw} onReinstate={onReinstate} />, { route: '/x?lang=en' })
    await user.click(screen.getByText('open'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Mark 3 items as withdrawn?')
    expect(dlg).toHaveTextContent('can reinstate them at any time')
    await user.type(within(dlg).getByTestId('withdraw-reason'), '  gone  ')
    await user.click(within(dlg).getByTestId('withdraw-confirm'))
    await waitFor(() => expect(onWithdraw).toHaveBeenCalledWith(three, 'gone'))
    expect(await screen.findByText('3 items marked as withdrawn.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(onReinstate).toHaveBeenCalledWith(three))
  })

  it('the reason is optional (null), and Arabic shows the Arabic words (منسحب)', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<Harness items={one} onWithdraw={onWithdraw} onReinstate={vi.fn()} />, { route: '/x?lang=ar' })
    await user.click(screen.getByText('open'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('تحديد "Alpha Co" كمنسحب؟')
    await user.click(within(dlg).getByTestId('withdraw-confirm'))
    await waitFor(() => expect(onWithdraw).toHaveBeenCalledWith(one, null))
    expect(await screen.findByText('تم تحديد "Alpha Co" كمنسحب.')).toBeInTheDocument()
  })

  it('a server error keeps the dialog open and shows the specific message; cancelling writes nothing', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { messageKey: 'entity.withdraw.err.invalid' }))
    renderWithProviders(<Harness items={one} onWithdraw={onWithdraw} onReinstate={vi.fn()} />, { route: '/x?lang=en' })
    await user.click(screen.getByText('open'))
    await user.click(within(await screen.findByRole('dialog')).getByTestId('withdraw-confirm'))
    expect(await screen.findByText('The withdrawal could not be saved: check the reason.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onWithdraw).toHaveBeenCalledTimes(1)
  })

  it('reinstating is immediate (no dialog) and says so', async () => {
    const user = userEvent.setup()
    const onReinstate = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<Harness items={one} onWithdraw={vi.fn()} onReinstate={onReinstate} />, { route: '/x?lang=en' })
    await user.click(screen.getByText('reinstate'))
    await waitFor(() => expect(onReinstate).toHaveBeenCalledWith(one))
    expect(await screen.findByText('"Alpha Co" is reinstated.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a reason over the 1000 characters the DB accepts blocks the button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<WithdrawDialog names={['A']} onConfirm={vi.fn()} onClose={vi.fn()} />, { route: '/x?lang=en' })
    const box = screen.getByTestId('withdraw-reason')
    await user.click(box)
    await user.paste('x'.repeat(REASON_MAX + 1))
    expect(await screen.findByText('The reason can have at most 1000 characters.')).toBeInTheDocument()
    expect(screen.getByTestId('withdraw-confirm')).toBeDisabled()
  })
})
