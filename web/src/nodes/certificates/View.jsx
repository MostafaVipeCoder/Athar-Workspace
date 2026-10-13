import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { cn } from '../../lib/cn.js'
import { signedTemplateUrl, useCertificateDefinition, useCertificatesAdmin } from '../../data/certificates.js'
import { SAMPLES, SAMPLE_KEYS, certValues } from '../../lib/certificates/layout.js'
import { loadTemplateImage } from '../../lib/certificates/templateFile.js'
import { buildPublicUrl, staffPath } from '../../lib/links.js'
import PreviewCanvas from './PreviewCanvas.jsx'
import { normalizeCertConfig, summarize, templateDraft } from './certConfig.js'

/**
 * View mode (PM preview, design 06 4.3): the saved template drawn by the SAME renderer the founders' downloads and the verifier use,
 * with sample data (a long Arabic name, a long English name, a short one), plus the issue counts and the way into the Issue panel.
 */
export default function CertificatesView() {
  const { node, projectId } = useNodeContext()
  const { t } = useLanguage()
  const config = useMemo(() => normalizeCertConfig(node.config), [node.config])
  const def = useCertificateDefinition(node.id)
  const admin = useCertificatesAdmin(node.id)
  const draft = useMemo(() => (def.data ? templateDraft(def.data, config.language) : undefined), [def.data, config.language])
  const [sampleKey, setSampleKey] = useState(config.language === 'ar' ? 'longAr' : 'longEn')
  const img = useQuery({
    queryKey: ['certificate', 'templateImage', draft?.filePath],
    queryFn: async () => loadTemplateImage(await signedTemplateUrl(draft.filePath)),
    enabled: Boolean(draft?.filePath),
    staleTime: 30 * 60 * 1000,
  })
  const sample = SAMPLES[sampleKey]
  const values = useMemo(() => certValues(sample.snapshot, sample.code, config.language), [sample, config.language])
  const counts = summarize(admin.data?.rows)
  const langName = t(`certificates.language.${config.language}`)

  const actions = (
    <>
      <Link to={staffPath.node(projectId, node.id, 'edit')} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('certificates.view.edit')}</Link>
      <Link to={`${staffPath.node(projectId, node.id, 'edit')}?tab=issue`} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('certificates.view.issue')}</Link>
    </>
  )

  return (
    <NodeFrame actions={actions} subtitle={admin.data ? t('certificates.view.counts', { issued: counts.issued, pending: counts.pending }) : undefined}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('certificates.view.preview')}
      </p>
      {def.error ? <ErrorState error={def.error} onRetry={def.refetch} /> : def.isPending ? <Loading /> : !draft ? (
        <EmptyState title={t('certificates.view.noTemplate', { language: langName })} body={t('certificates.view.noTemplateBody')} />
      ) : (
        <div className="space-y-3" data-testid="certificates-view">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('certificates.tpl.preview.title')}>
            <span className="text-sm font-medium">{t('certificates.tpl.preview.title')}</span>
            {SAMPLE_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={sampleKey === k} onClick={() => setSampleKey(k)} data-testid={`sample-${k}`}
                className={cn('tap-target rounded-md px-3 text-sm', sampleKey === k ? 'bg-primary text-primary-foreground' : 'border border-input hover:bg-surface')}>
                {t(`certificates.sample.${k}`)}
              </button>
            ))}
          </div>
          {img.error ? <ErrorState error={img.error} onRetry={img.refetch} /> : img.isPending ? <Loading label={t('certificates.tpl.image.loading')} /> : (
            <PreviewCanvas image={img.data.image} width={img.data.width} height={img.data.height} fields={draft.fields} values={values} verifyUrl={buildPublicUrl('verify', sample.code)} label={t('certificates.tpl.canvas')} />
          )}
        </div>
      )}
    </NodeFrame>
  )
}
