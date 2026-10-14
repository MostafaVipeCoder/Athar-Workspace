import { useState } from 'react'
import { useAlumniMutations } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { CheckRow } from './ui.jsx'
import { reviewState } from './columns.js'
import { useAdminErrorText, useAdminFormat } from './hooks.js'
import './i18n.common.js'
import './company.i18n.js'

/**
 * The fields only a manager owns (design 09 M3): the alumni mark, the directory veto, the review stamp and the private Hint. Each is saved at ONCE through the manager
 * RPC (a patch of one key; a manager's note does not move the company's concurrency token). Used by the company page and by the directory drawer.
 * `company` = the manager payload's `company` (`is_alumni`, `internal { hint, directory_hidden, reviewed_at }`, `updated_at`).
 */
export default function ManagerFields({ company }) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const fmt = useAdminFormat()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { saveAdminCompany } = useAlumniMutations()
  const internal = company.internal ?? {}
  const [hint, setHint] = useState(internal.hint ?? '')
  const [hintBase, setHintBase] = useState(internal.hint ?? '')
  const review = reviewState({ reviewed_at: internal.reviewed_at, updated_at: company.updated_at })
  const busy = saveAdminCompany.isPending

  async function save(patch, ok) {
    try {
      const r = await saveAdminCompany.mutateAsync({ companyId: company.id, patch })
      toast.success(ok)
      return r
    } catch (e) {
      toast.error(`${d('saveFailed')} ${errorText(e)}`)
      return null
    }
  }
  async function saveHint() {
    const value = hint.trim() === '' ? null : hint.trim()
    const r = await save({ internal: { hint: value } }, d('hintSaved'))
    if (r) setHintBase(hint)
  }

  return (
    <div className="space-y-3" data-testid="manager-fields">
      <CheckRow checked={Boolean(company.is_alumni)} disabled={busy} label={d('alumni')} hint={d('alumniHint')} onChange={(v) => save({ is_alumni: v }, v ? d('alumniOn') : d('alumniOff'))} />
      <CheckRow checked={Boolean(internal.directory_hidden)} disabled={busy} label={d('veto')} hint={d('vetoHint')} onChange={(v) => save({ internal: { directory_hidden: v } }, v ? d('vetoOn') : d('vetoOff'))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{internal.reviewed_at ? d('reviewedAt', { date: fmt.date(internal.reviewed_at) }) : d('review.never')}{review === 'changed' && ` · ${d('review.changed')}`}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => save({ internal: { reviewed: true } }, d('reviewedSaved'))}>{d('markReviewed')}</Button>
      </div>
      <div className="space-y-2">
        <Field as="textarea" label={d('hint')} hint={d('hintHelp')} rows={3} maxLength={2000} value={hint} onChange={(e) => setHint(e.target.value)} />
        <Button size="sm" disabled={busy || hint === hintBase} loading={busy} onClick={saveHint}>{d('hintSave')}</Button>
      </div>
    </div>
  )
}
