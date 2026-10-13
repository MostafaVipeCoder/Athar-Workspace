import { useState } from 'react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Longest reason the DB accepts (`withdrawn_invalid`, 1000 characters). */
export const REASON_MAX = 1000

/**
 * Confirmation of "Mark as withdrawn" (decision 17.1): what happens (the person / company leaves every accepted or active
 * list the next steps use, but stays visible to the PM and can be reinstated), an OPTIONAL reason (PM-only) and the explicit
 * action button. Used by the Lists and Selection managers and by the Participants page. `names` = display names of the
 * items to withdraw (one -> its name in the title, several -> the count).
 */
export function WithdrawDialog({ names = [], busy = false, onConfirm, onClose }) {
  const { t, tn } = useLanguage()
  const [reason, setReason] = useState('')
  const title = names.length === 1 ? t('entity.withdraw.title', { name: names[0] || '-' }) : tn('entity.withdraw.titleMany', names.length)
  const tooLong = reason.length > REASON_MAX
  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={title}
      description={t('entity.withdraw.body')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim() || null)} loading={busy} disabled={tooLong} data-testid="withdraw-confirm">{t('entity.withdraw.confirm')}</Button>
        </>
      }
    >
      <Field
        as="textarea"
        rows={3}
        label={t('entity.withdraw.reason')}
        hint={t('entity.withdraw.reasonHint')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={REASON_MAX + 1}
        error={tooLong ? t('entity.withdraw.reasonTooLong') : undefined}
        inputClassName="min-h-20 py-2"
        data-autofocus
        data-testid="withdraw-reason"
      />
    </Modal>
  )
}
