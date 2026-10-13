import { useState } from 'react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { WithdrawDialog } from './WithdrawDialog.jsx'

const asList = (x) => (Array.isArray(x) ? x : [x])

/**
 * The ONE interaction of "Withdrawn" (decision 17.1) shared by every screen that can mark someone as withdrawn (Lists,
 * Selection board, Participants page): `withdraw(itemOrItems)` opens the confirmation (what happens + optional reason);
 * confirming calls `onWithdraw(items, reason)` and shows a toast with Undo (= `onReinstate`); `reinstate(itemOrItems)` is
 * immediate (it IS the undo) and says so. Errors become a toast with the specific message. `nameOf(item)` = display name.
 * Returns `{ withdraw, reinstate, dialog, busy }`: render `dialog` once in the screen.
 */
export function useWithdrawFlow({ onWithdraw, onReinstate, nameOf }) {
  const { t, tn } = useLanguage()
  const toast = useToast()
  const [pending, setPending] = useState(null) // the items waiting for the confirmation
  const [busy, setBusy] = useState(false)

  const label = (items) => (items.length === 1 ? nameOf(items[0]) : items.length)
  // one item: its name; several: a PLURAL entry (Arabic has six forms: "2 items" and "11 items" are not written like "5 items")
  const doneKey = (items, one, many) => (items.length === 1 ? t(one, { name: label(items) }) : tn(many, items.length))

  async function reinstate(x) {
    const items = asList(x)
    try {
      await onReinstate(items)
      toast.success(doneKey(items, 'entity.withdraw.reinstated', 'entity.withdraw.reinstatedMany'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  async function confirm(reason) {
    const items = pending
    setBusy(true)
    try {
      await onWithdraw(items, reason)
      setPending(null)
      toast.success(doneKey(items, 'entity.withdraw.done', 'entity.withdraw.doneMany'), {
        action: { label: t('entity.withdraw.undo'), onClick: () => reinstateSilently(items) },
      })
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }
  // Undo: the reinstatement without a second toast on success
  async function reinstateSilently(items) {
    try {
      await onReinstate(items)
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  const dialog = pending ? <WithdrawDialog names={pending.map((i) => nameOf(i))} busy={busy} onConfirm={confirm} onClose={() => setPending(null)} /> : null
  return { withdraw: (x) => setPending(asList(x)), reinstate, dialog, busy }
}
