import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { findConflicts, keysToKeep } from '../../lib/alumniConflicts.js'
import ConflictDialog from './ConflictDialog.jsx'
import { useEditText } from './useEditText.js'
import './i18n.edit.js'

/**
 * What a form does after the server refused its save as stale (`alumni_stale`: the record changed after the form loaded). Instead of "reload and lose track", it
 *   1. fetches the fresh record, 2. finds the fields BOTH sides changed to different values, 3. with none: rebases on the fresh record keeping all my edits (a toast says so),
 *   4. with some: asks (ConflictDialog) which value to keep for each, then rebases keeping exactly those.
 * `form` = the useDraftForm; `toForm(payload)` the payload -> form values; `versionOf(payload)` the new version token; `whoOf(payload)` the `updated_source` of the fresh record
 * ('manager' | 'founder' | ...); `audience` 'manager' | 'founder'.
 * Returns `{ resolve({ fetchFresh, keys }), dialog, notice, clearNotice }`: render `dialog` and `notice` (the inline outcome: "their changes were loaded, yours stay") somewhere in the page and call `clearNotice()` after a successful save or an undo; `resolve` resolves to 'merged' | 'asking' | 'failed'.
 */
export function useStaleResolver({ form, toForm, versionOf, whoOf = () => null, audience = 'founder' }) {
  const { t } = useLanguage()
  const toast = useToast()
  const e = useEditText()
  const [pending, setPending] = useState(null)
  const [notice, setNotice] = useState(null)

  async function resolve({ fetchFresh, keys }) {
    let fresh
    try {
      fresh = await fetchFresh()
    } catch {
      toast.error(t('alumni.edit.conflict.reloadFailed'))
      return 'failed'
    }
    const freshForm = toForm(fresh)
    const version = versionOf(fresh)
    const who = e.who({ source: whoOf(fresh) }, audience)
    const conflicts = findConflicts({ base: form.base, mine: form.values, fresh: freshForm, keys })
    if (conflicts.length === 0) {
      form.rebase(freshForm, version, keys)
      setNotice(t('alumni.edit.conflict.merged', { who }))
      return 'merged'
    }
    setPending({ conflicts, freshForm, version, keys, who })
    return 'asking'
  }

  function apply(choices) {
    const keep = keysToKeep({ keys: pending.keys, conflicts: pending.conflicts, choices })
    form.rebase(pending.freshForm, pending.version, keep)
    setNotice(t('alumni.edit.conflict.mergedWithChoices'))
    setPending(null)
  }

  // a national ID is never shown in a conflict: "an ID is recorded" is all the dialog says
  const valueText = (key, value) => (key === 'national_id' ? e.valueText('national_id', Boolean(value)) : e.valueText(key, value))
  const dialog = pending ? (
    <ConflictDialog conflicts={pending.conflicts} who={pending.who} fieldLabel={e.fieldLabel} valueText={valueText} onResolve={apply} onCancel={() => setPending(null)} />
  ) : null
  // the outcome is an INLINE status, not a toast: a toast sits exactly where the Save bar is and covers the Save button for the seconds the person needs it (checked in the browser, RTL)
  const noticeElement = notice ? <p role="status" className="rounded-input bg-accent/20 p-3 text-sm" data-testid="stale-notice">{notice}</p> : null
  return { resolve, dialog, notice: noticeElement, clearNotice: () => setNotice(null), asking: Boolean(pending) }
}
