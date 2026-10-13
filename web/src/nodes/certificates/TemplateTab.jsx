import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ImagePlus, Plus, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { EmptyState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { removeTemplateFiles, signedTemplateUrl, uploadTemplateFile } from '../../data/certificates.js'
import { VARIABLES, SAMPLES, SAMPLE_KEYS, certValues, defaultField, sortFields } from '../../lib/certificates/layout.js'
import { TEMPLATE_ACCEPT, checkTemplateSize, decodeTemplateFile, loadTemplateImage, validateTemplateFile } from '../../lib/certificates/templateFile.js'
import { buildPublicUrl } from '../../lib/links.js'
import CanvasEditor from './CanvasEditor.jsx'
import FieldPanel from './FieldPanel.jsx'
import './i18n.js'

/**
 * Template tab (design 07 section 4.3): upload the certificate design (PNG / JPEG, validated and uploaded as is to the private bucket),
 * place the variables on a live canvas (drag, side handles, keys), style each field, and test with a long Arabic and a long English
 * name. The draft lives in Edit.jsx (ONE save_node with `children.template`); this component only edits it.
 * Files uploaded in the session are tracked in `assets` so a discarded draft does not leave orphans in the bucket.
 */
export default function TemplateTab({ draft, setDraft, language, projectId, nodeId, assets, versionNote }) {
  const { t } = useLanguage()
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(null) // 'checking' | 'uploading'
  const [problem, setProblem] = useState(null) // a blocked upload: { errors: [], file }
  const [local, setLocal] = useState({}) // path -> decoded image of a file uploaded in this session
  const [selected, setSelected] = useState(null)
  const [sampleKey, setSampleKey] = useState(language === 'ar' ? 'longAr' : 'longEn')
  const [overflow, setOverflow] = useState({})
  const [dragging, setDragging] = useState(false)

  const path = draft?.filePath ?? null
  const remote = useQuery({
    queryKey: ['certificate', 'templateImage', path],
    queryFn: async () => loadTemplateImage(await signedTemplateUrl(path)),
    enabled: Boolean(path) && !local[path],
    staleTime: 30 * 60 * 1000,
  })
  const loaded = path ? (local[path] ?? remote.data ?? null) : null

  const sample = SAMPLES[sampleKey]
  const values = useMemo(() => certValues(sample.snapshot, sample.code, language), [sample, language])
  const verifyUrl = useMemo(() => buildPublicUrl('verify', sample.code), [sample])
  const fields = draft?.fields ?? []
  const size = draft ? checkTemplateSize(draft.widthPx, draft.heightPx) : null
  const field = fields.find((f) => f.var === selected) ?? null

  const patchFields = (fn) => setDraft((d) => (d ? { ...d, fields: sortFields(fn(d.fields)) } : d))
  const changeField = (key, next) => patchFields((list) => list.map((f) => (f.var === key ? next : f)))
  function addVariable(key) {
    patchFields((list) => (list.some((f) => f.var === key) ? list : [...list, defaultField(key)]))
    setSelected(key)
  }
  function removeVariable(key) {
    const removed = fields.find((f) => f.var === key)
    if (!removed) return
    patchFields((list) => list.filter((f) => f.var !== key))
    setSelected(null)
    toast.info(t('certificates.edit.removed', { name: t(`certificates.var.${key}`) }), {
      action: { label: t('canvas.undo'), onClick: () => patchFields((list) => (list.some((f) => f.var === key) ? list : [...list, removed])) },
    })
  }

  async function choose(file) {
    if (!file) return
    setProblem(null)
    const bad = validateTemplateFile(file)
    if (bad) { setProblem({ errors: [`file.${bad}`], file: file.name }); return }
    setBusy('checking')
    let decoded
    try {
      decoded = await decodeTemplateFile(file)
    } catch {
      setBusy(null)
      setProblem({ errors: ['decode'], file: file.name })
      return
    }
    const check = checkTemplateSize(decoded.width, decoded.height)
    if (check.errors.length) {
      setBusy(null)
      setProblem({ errors: check.errors.map((e) => `size.${e}`), file: file.name })
      return
    }
    setBusy('uploading')
    try {
      const up = await uploadTemplateFile(file, { projectId, nodeId })
      assets.current.files.add(up.path)
      if (draft?.filePath) {
        // an image of this session that is replaced is garbage at once; a saved image is removed after the save (it may be an older version's)
        if (assets.current.files.has(draft.filePath)) { assets.current.files.delete(draft.filePath); removeTemplateFiles([draft.filePath]) } else assets.current.garbage.add(draft.filePath)
      }
      setLocal((l) => ({ ...l, [up.path]: { image: decoded.image, width: decoded.width, height: decoded.height } }))
      setDraft((d) => ({ filePath: up.path, widthPx: decoded.width, heightPx: decoded.height, version: d?.version ?? 0, fields: d?.fields ?? [] }))
    } catch (e) {
      setProblem({ errors: [e?.messageKey?.startsWith('certificates.err.') ? e.messageKey.replace('certificates.', '') : 'upload'], file: file.name })
    } finally {
      setBusy(null)
    }
  }
  const onDrop = (e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer?.files?.[0]) }

  const problemText = (code) => t(`certificates.${code.startsWith('err.') ? code : `err.${code}`}`)

  return (
    <div className="space-y-5" data-testid="template-tab">
      <section className="space-y-3 rounded-card border border-border p-4" aria-labelledby="cert-image-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 id="cert-image-title" className="font-display text-lg font-bold">{t('certificates.tpl.image.title')}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">{t('certificates.tpl.image.hint')}</p>
            <p className="text-xs text-muted-foreground">{t('certificates.tpl.lang', { language: t(`certificates.language.${language}`) })} · {t('certificates.tpl.langHint')}</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={input} type="file" accept={TEMPLATE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="template-file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
            <Button variant={draft ? 'outline' : 'primary'} loading={Boolean(busy)} onClick={() => input.current?.click()} data-testid="choose-template">
              {draft ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
              {busy === 'uploading' ? t('certificates.tpl.image.uploading') : busy === 'checking' ? t('certificates.tpl.image.checking') : draft ? t('certificates.tpl.image.replace') : t('certificates.tpl.image.choose')}
            </Button>
          </div>
        </div>

        {draft && size && (
          <div className="flex flex-wrap items-center gap-2" data-testid="template-facts">
            <Badge tone="neutral"><span dir="ltr">{t('certificates.tpl.image.size', { width: draft.widthPx, height: draft.heightPx })}</span></Badge>
            <Badge tone="neutral">{size.paper ? t(`certificates.tpl.image.paper.${size.paper}`) : t('certificates.tpl.image.paper.none')} · {t(`certificates.tpl.image.${size.orientation}`)}</Badge>
          </div>
        )}
        {size?.warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-md bg-accent/40 p-2 text-sm" data-testid={`warn-${w}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(`certificates.warn.${w}`)}</p>
        ))}
        {problem && (
          <div role="alert" className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="template-problem">
            {problem.errors.map((c) => <p key={c}>{problem.file ? `${problem.file}: ` : ''}{problemText(c)}</p>)}
          </div>
        )}
        {versionNote && <p className="rounded-md bg-surface p-2 text-sm text-muted-foreground" data-testid="version-note">{t('certificates.edit.versionNote')}</p>}
      </section>

      {!draft ? (
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          className={cn('rounded-card border-2 border-dashed p-2 transition-colors', dragging ? 'border-primary bg-primary/5' : 'border-transparent')}>
          <EmptyState icon={ImagePlus} title={t('certificates.tpl.empty.title')} body={t('certificates.tpl.empty.body')}
            action={<Button onClick={() => input.current?.click()} loading={Boolean(busy)}>{t('certificates.tpl.image.drop')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('certificates.tpl.preview.title')}>
              <span className="text-sm font-medium">{t('certificates.tpl.preview.title')}</span>
              {SAMPLE_KEYS.map((k) => (
                <button key={k} type="button" aria-pressed={sampleKey === k} onClick={() => setSampleKey(k)} data-testid={`sample-${k}`}
                  className={cn('tap-target rounded-md px-3 text-sm', sampleKey === k ? 'bg-primary text-primary-foreground' : 'border border-input hover:bg-surface')}>
                  {t(`certificates.sample.${k}`)}
                </button>
              ))}
            </div>
            {loaded ? (
              <CanvasEditor image={loaded.image} width={loaded.width} height={loaded.height} fields={fields} selected={selected} onSelect={setSelected}
                onChange={changeField} onRemove={removeVariable} values={values} verifyUrl={verifyUrl} onOverflow={setOverflow} />
            ) : remote.error ? (
              <p role="alert" className="rounded-card border border-destructive/40 p-4 text-sm">{t('certificates.view.error')}</p>
            ) : (
              <Loading label={t('certificates.tpl.image.loading')} />
            )}
            <p className="text-xs text-muted-foreground">{t('certificates.tpl.dragHint')}</p>
          </div>

          <div className="min-w-0 space-y-4">
            <section className="space-y-2" aria-labelledby="cert-vars-title">
              <h3 id="cert-vars-title" className="font-display text-lg font-bold">{t('certificates.tpl.vars.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('certificates.tpl.vars.hint')}</p>
              <ul className="grid gap-1.5">
                {VARIABLES.map((v) => {
                  const placed = fields.some((f) => f.var === v.key)
                  const name = t(`certificates.var.${v.key}`)
                  return (
                    <li key={v.key}>
                      <button type="button" onClick={() => (placed ? setSelected(v.key) : addVariable(v.key))} data-testid={`var-${v.key}`} aria-pressed={placed ? selected === v.key : undefined}
                        aria-label={placed ? t('certificates.tpl.select', { name }) : t('certificates.tpl.add', { name })}
                        className={cn('tap-target flex w-full items-center justify-between gap-2 rounded-md border px-3 text-start text-sm', placed ? (selected === v.key ? 'border-primary bg-primary/10' : 'border-input bg-surface') : 'border-dashed border-input hover:bg-surface')}>
                        <span>{name}</span>
                        {placed ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-4 w-4 text-success" aria-hidden="true" />{t('certificates.tpl.placed')}</span> : <Plus className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {!fields.some((f) => f.var === 'participant_name') && <p className="text-xs text-destructive-text" data-testid="no-name-warning">{t('certificates.edit.noName')}</p>}
            </section>
            <FieldPanel field={field} width={draft.widthPx} overflow={Boolean(field && overflow[field.var])} onChange={(next) => changeField(next.var, next)} onRemove={removeVariable} />
          </div>
        </div>
      )}
    </div>
  )
}
