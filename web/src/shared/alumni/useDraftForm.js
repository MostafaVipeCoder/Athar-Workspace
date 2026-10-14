import { useCallback, useRef, useState } from 'react'

/**
 * A draft of a server record (design 09 forms): `values` are what the person is editing, `base` is what the server last returned. Nothing is saved by typing
 * (explicit Save only, so a half-typed company never reaches the registry).
 *
 *   const form = useDraftForm(() => companyToForm(company), { version: company.updated_at, isDirty: (values, base) => Object.keys(buildCompanyPatch(base, values)).length > 0 })
 *   form.values, form.set('stage', 'mvp'), form.setMany({ sector, subsector }), form.reset() (Undo), form.rebase(nextInitial, nextVersion)
 *
 * `version` identifies the server state (the record's `updated_at`): when it changes while the form is CLEAN the form follows the server (another founder saved, a
 * refetch); while the form is DIRTY the person's edits are kept and the base is left alone (the Save then reports `alumni_stale`, the page offers a reload).
 * `rebase(initial, version, keepKeys)` is called after a successful save (the saved values become the base) or after a stale reload (`keepKeys` = the keys the person
 * edited: they are re-applied on top of the fresh server values).
 * Uploaded-but-unsaved files (`track(path)`) are handed to `onDiscard(paths)` when the form is undone or replaced, so an abandoned logo does not stay in storage.
 */
export function useDraftForm(makeInitial, { version = null, isDirty = null, onDiscard = null } = {}) {
  const [state, setState] = useState(() => {
    const initial = makeInitial()
    return { version, base: initial, values: initial }
  })
  const tracked = useRef(new Set())

  // follow the server while the form is clean (derive during render: no effect, no flash of stale values); a dirty draft keeps the person's edits
  let current = state
  if (version !== state.version && !(isDirty ? isDirty(state.values, state.base) : false)) {
    const initial = makeInitial()
    current = { version, base: initial, values: initial }
    setState(current)
  }

  const set = useCallback((key, value) => setState((s) => ({ ...s, values: { ...s.values, [key]: value } })), [])
  const setMany = useCallback((patch) => setState((s) => ({ ...s, values: { ...s.values, ...patch } })), [])

  const discard = useCallback((keep = []) => {
    const stale = [...tracked.current].filter((p) => !keep.includes(p))
    tracked.current = new Set()
    if (stale.length) onDiscard?.(stale)
  }, [onDiscard])

  const reset = useCallback(() => {
    setState((s) => ({ ...s, values: s.base }))
    discard()
  }, [discard])

  const rebase = useCallback((initial, nextVersion, keepKeys = null) => {
    setState((s) => {
      const values = keepKeys ? { ...initial, ...Object.fromEntries(keepKeys.filter((k) => k in s.values).map((k) => [k, s.values[k]])) } : initial
      return { version: nextVersion, base: initial, values }
    })
    // after a save the saved file is the new base; a stale reload keeps the edits (and their uploads)
    if (!keepKeys) tracked.current = new Set()
  }, [])

  const track = useCallback((path) => { if (path) tracked.current.add(path) }, [])

  return { values: current.values, base: current.base, set, setMany, reset, rebase, track, discard, version: current.version }
}
