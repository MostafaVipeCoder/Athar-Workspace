import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { getCertificateDefinition, removeTemplateFiles, useCertificateDefinition, useCertificatesAdmin } from '../../data/certificates.js'
import { keys } from '../../data/queryKeys.js'
import IssueTab from './IssueTab.jsx'
import TemplateTab from './TemplateTab.jsx'
import { normalizeCertConfig, sameDraft, templateDraft, toChildren, validateDraft } from './certConfig.js'

const TABS = ['template', 'issue']

/**
 * Edit mode (design 01 section 3.10): two tabs.
 *  - Template: the certificate design + positioned variables for the node's language (ONE draft, saved with ONE save_node whose
 *    `children.template` is validated and versioned by the server; the config is saved untouched);
 *  - Issue certificates: the attended participants of the project and their certificates (row-level server actions, no draft).
 * The template draft is adopted from the server unless the user has unsaved edits; files uploaded in the session are removed again
 * when they never get saved, and a replaced image is removed after the save only when no template version still references it.
 */
export default function CertificatesEdit() {
  const { node, projectId } = useNodeContext()
  const { t } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'template'
  const { config: raw, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeCertConfig(raw), [raw])
  const language = config.language
  const def = useCertificateDefinition(node.id)
  const admin = useCertificatesAdmin(node.id)
  const assets = useRef({ files: new Set(), garbage: new Set() })
  const [state, setState] = useState({ key: null, base: null, draft: null })

  const loaded = useMemo(() => (def.data ? templateDraft(def.data, language) : undefined), [def.data, language])
  const key = `${node.id}:${language}`
  const draftDirty = state.key === key && !sameDraft(state.draft, state.base)
  // adopt the loaded template (language switch, first load, a newer saved state) unless the user has unsaved edits
  if (loaded !== undefined && (state.key !== key || (!sameDraft(loaded, state.base) && !draftDirty))) {
    setState({ key, base: loaded, draft: loaded })
  }
  const draft = state.key === key ? state.draft : (loaded ?? null)
  const setDraft = (next) => setState((s) => ({ ...s, key, draft: typeof next === 'function' ? next(s.key === key ? s.draft : loaded ?? null) : next }))
  const dirty = draftDirty || configDirty
  const hasIssued = (admin.data?.rows ?? []).some((r) => r.certificate)

  useEffect(() => {
    const a = assets.current
    return () => {
      // leaving the editor with unsaved uploads: they belong to nobody
      removeTemplateFiles([...a.files])
    }
  }, [])

  async function onSave() {
    const { errors } = validateDraft(draft)
    if (errors.length) { toast.error(t(errors[0].code === 'noImage' ? 'certificates.edit.save.noImage' : 'certificates.edit.saveBlocked')); return }
    const result = await save(null, { children: toChildren(draft, language) })
    if (!result.ok) return
    setState((s) => ({ ...s, base: s.draft }))
    // the server may have created a new template VERSION: re-read, then drop the files nobody references any more
    try {
      const rows = await qc.fetchQuery({ queryKey: keys.certificateDef(node.id), queryFn: () => getCertificateDefinition(node.id), staleTime: 0 })
      const used = new Set(rows.map((r) => r.file_path))
      const a = assets.current
      const drop = [...a.files, ...a.garbage].filter((p) => !used.has(p))
      if (drop.length) removeTemplateFiles(drop)
      a.files.clear()
      a.garbage.clear()
      qc.setQueryData(keys.certificateDef(node.id), rows)
    } catch { /* the cleanup is best effort: a later save retries it */ }
    qc.invalidateQueries({ queryKey: keys.certificatesAdmin(node.id) })
  }

  const subtitle = draft
    ? t('certificates.edit.subtitle', { language: t(`certificates.language.${language}`), count: draft.fields.length })
    : t('certificates.edit.subtitle.none', { language: t(`certificates.language.${language}`) })

  const tabs = (
    <div className="mb-4 flex flex-wrap items-center gap-1" role="tablist" aria-label={t('certificates.edit.tabs')}>
      {TABS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`tab-${k}`}
          onClick={() => { const next = new URLSearchParams(params); next.set('tab', k); setParams(next, { replace: true }) }}
          className={cn('tap-target rounded-md px-3 text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')}>
          {t(`certificates.edit.tab.${k}`)}
        </button>
      ))}
    </div>
  )

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave} showSave={tab === 'template'} subtitle={subtitle}>
      {tabs}
      {tab === 'issue' ? (
        <IssueTab node={node} projectId={projectId} />
      ) : def.error ? (
        <ErrorState error={def.error} onRetry={def.refetch} />
      ) : def.isPending ? (
        <Loading />
      ) : (
        <TemplateTab draft={draft} setDraft={setDraft} language={language} projectId={projectId} nodeId={node.id} assets={assets} versionNote={hasIssued && Boolean(draft)} />
      )}
    </NodeFrame>
  )
}
