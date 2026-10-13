import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNodeContext } from './NodeContext.js'
import { invalidateNodeOutputs } from './invalidate.js'
import { useToast } from '../../ui/Toast.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { AppError } from '../../data/errors.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Draft state with an EXPLICIT save (design 06 section 4.3 / 5.5):
 * - edits live in a local draft; nothing is written until save();
 * - save() sends the draft with the revision it was based on (optimistic concurrency); a conflict keeps the draft;
 * - after a successful save the connected views refresh (invalidateNodeOutputs) and a toast says how many.
 */
export function useNodeConfig() {
  const { node, manifest, adapter, graph, projectId } = useNodeContext()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { t } = useLanguage()

  const incoming = useMemo(() => ({ ...manifest.defaultConfig(), ...(node.config ?? {}) }), [manifest, node.config])
  const [base, setBase] = useState({ id: node.id, rev: node.rev ?? 0, config: incoming })
  const [draft, setDraft] = useState(incoming)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Adopt a newer saved state from outside (another session / refresh) unless the user has unsaved edits.
  const dirty = !same(draft, base.config)
  if (node.id !== base.id) {
    setBase({ id: node.id, rev: node.rev ?? 0, config: incoming })
    setDraft(incoming)
  } else if ((node.rev ?? 0) > base.rev && !dirty) {
    setBase({ id: node.id, rev: node.rev, config: incoming })
    setDraft(incoming)
  }

  const update = useCallback((partial) => setDraft((d) => ({ ...d, ...partial })), [])
  const reset = useCallback(() => setDraft(base.config), [base.config])

  /**
   * `extraPatch` (optional) adds node columns to the same atomic save_node call (whitelist of the RPC: name_en, name_ar,
   * visibility, show_to_participants). Used by Settings screens that edit the name/visibility next to the config.
   * `opts.children` (optional) = the node's typed children (form questions/sections, agenda days...) written by the
   * type's save_children_<type> in the SAME transaction (04 section 5.2), so a definition never ends half-saved.
   */
  const save = useCallback(async (extraPatch = null, opts = {}) => {
    setSaving(true)
    setError(null)
    try {
      const patch = { config: draft, ...(extraPatch && typeof extraPatch === 'object' && !extraPatch.nativeEvent ? extraPatch : {}) }
      const result = await adapter.saveNode(node.id, base.rev, patch, { children: opts?.children ?? null })
      setBase({ id: node.id, rev: result.rev, config: draft })
      const refreshed = await invalidateNodeOutputs(queryClient, graph, node.id, projectId)
      toast.success(t('node.saved', { count: refreshed }))
      return { ok: true, rev: result.rev, refreshed }
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('unknown', { cause: e })
      setError(err)
      toast.error(err.code === 'conflict' ? t('node.conflict') : t('node.saveFailed'))
      return { ok: false, error: err }
    } finally {
      setSaving(false)
    }
  }, [adapter, node.id, base.rev, draft, queryClient, graph, projectId, toast, t])

  return { config: draft, update, setConfig: setDraft, dirty, saving, error, save, reset, rev: base.rev }
}
