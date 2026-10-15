/**
 * Conflicts between two writers of the same record (owner decisions 20.3 / 20.4: the manager and the founder edit the same company, neither may overwrite the other unseen).
 *
 * The server refuses a save whose version token is stale (`alumni_stale`: the row changed after the form loaded). That is a ROW-level guard; this module makes it FIELD-level for
 * the person: after a refusal the form re-reads the fresh record and asks, for every field the person edited that the other side ALSO changed to something different, which value
 * wins. A field only one side touched is never a conflict (the person's edit is re-applied on top of the fresh record, the other side's change is kept).
 *
 * Values are FORM values (`companyToForm`, `founderToForm`, `snapshotToForm`): strings / numbers / arrays, `''` and `null` count as the same "empty".
 */
import { sameValue } from './alumni.js'

/**
 * `base` = the form values the person loaded, `mine` = the form values now, `fresh` = the form values of the record as it is now, `keys` = the keys the person edited.
 * -> `[{ key, base, mine, theirs }]`: the keys the other side changed since `base` to a value that differs from `mine`.
 */
export function findConflicts({ base, mine, fresh, keys }) {
  const out = []
  for (const key of keys ?? []) {
    const changedByOther = !sameValue(base?.[key], fresh?.[key])
    if (changedByOther && !sameValue(mine?.[key], fresh?.[key])) out.push({ key, base: base?.[key] ?? null, mine: mine?.[key] ?? null, theirs: fresh?.[key] ?? null })
  }
  return out
}

/** The keys the other side changed meanwhile among the keys I did NOT edit (shown as "also changed by ..." information; nothing to decide). */
export function otherSideChanges({ base, fresh, keys }) {
  return (keys ?? []).filter((k) => !sameValue(base?.[k], fresh?.[k]))
}

/**
 * After the person decided: which of his edited keys are re-applied on top of the fresh record. A field that is not in conflict is always kept; a conflicting field is kept only when
 * the person chose "mine" (no choice = theirs: the safe default, nothing is overwritten unseen).
 * `choices` = `{ [key]: 'mine' | 'theirs' }`.
 */
export function keysToKeep({ keys, conflicts, choices }) {
  const conflicting = new Set((conflicts ?? []).map((c) => c.key))
  return (keys ?? []).filter((k) => !conflicting.has(k) || choices?.[k] === 'mine')
}

/** Every conflict has a choice (the dialog's confirm button waits for this). */
export const allDecided = (conflicts, choices) => (conflicts ?? []).every((c) => choices?.[c.key] === 'mine' || choices?.[c.key] === 'theirs')
