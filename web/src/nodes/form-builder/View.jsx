import { useMemo } from 'react'
import { Eye, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { useFormDefinition, useFormLink } from '../../data/forms.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { resolveTimeZone } from '../../lib/time/tz.js'
import FormRenderer from './FormRenderer.jsx'
import { normalizeFormConfig } from './formLogic.js'

/** View mode = the PM preview: the SAME renderer as /forms/:ref fed with the saved definition; submitting stores nothing. */
export default function FormView() {
  const { node, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const def = useFormDefinition(node.id)
  const link = useFormLink(node.id)
  const config = useMemo(() => normalizeFormConfig(node.config), [node.config])
  const url = link.data?.slug ? buildPublicUrl('form', canonicalRef({ slug: link.data.slug, id: node.id })) : null
  const form = useMemo(() => (def.data ? {
    node_id: node.id, project_id: node.project_id, name_en: node.name_en, name_ar: node.name_ar,
    description_en: config.description.en, description_ar: config.description.ar,
    cover_path: def.data.form.cover_path, thank_you: config.thank_you, social: config.social,
    is_open: true, allow_uploads: def.data.questions.some((q) => q.type === 'file'),
    sections: def.data.sections, questions: def.data.questions,
  } : null), [def.data, node, config])

  return (
    <NodeFrame actions={url ? <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('form.view.openPublic')}</a> : null}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('form.view.preview')}{!url && ` ${t('form.view.noLink')}`}
      </p>
      {def.error ? <ErrorState error={def.error} onRetry={def.refetch} /> : def.isPending ? <Loading /> : (
        <div className="mx-auto max-w-2xl" data-testid="form-preview">
          <FormRenderer key={node.rev} form={form} preview publicUrl={url} tz={resolveTimeZone(graph?.project?.timezone)} onSubmit={async () => { toast.info(t('form.view.previewSubmitted')); return { ok: true } }} />
        </div>
      )}
    </NodeFrame>
  )
}
