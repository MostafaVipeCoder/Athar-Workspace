import { useState } from 'react'
import './i18n.js'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { renderTemplate, sanitizePreviewHtml, splitAddresses } from '../../lib/email.js'

/**
 * ONE bilingual e-mail template editor with placeholder chips and a live preview (design 07 section 1.5), shared by the
 * nodes that own templates (Booking; the Selection E-mails tab keeps its send panel around the same shape).
 * `template` = { enabled, subject, body_html, subject_ar, body_html_ar, cc[], admin[] }; `onChange(next)` receives the
 * whole template; `placeholders` = the allowed keys; `sampleVars` = values for the preview; `error` = a message key
 * ('unknownPlaceholder' | 'badAddress') or null; `showLists` toggles the CC / admin fields.
 */
export function TemplateEditor({ template, onChange, placeholders = [], sampleVars = {}, error = null, showLists = true, testId = 'template-editor' }) {
  const { t, lang } = useLanguage()
  const [tplLang, setTplLang] = useState(lang === 'ar' ? 'ar' : 'en')
  const subjField = tplLang === 'ar' ? 'subject_ar' : 'subject'
  const bodyField = tplLang === 'ar' ? 'body_html_ar' : 'body_html'
  const patch = (next) => onChange({ ...template, ...next })
  const insert = (ph) => patch({ [bodyField]: `${template[bodyField]}${template[bodyField] && !template[bodyField].endsWith(' ') ? ' ' : ''}{{${ph}}}` })
  const previewSubject = renderTemplate(tplLang === 'ar' ? template.subject_ar || template.subject : template.subject || template.subject_ar, sampleVars)
  const previewBody = sanitizePreviewHtml(renderTemplate(tplLang === 'ar' ? template.body_html_ar || template.body_html : template.body_html || template.body_html_ar, sampleVars, { html: true }))

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid={testId}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={template.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="h-4 w-4" />{t('email.enabled')}</label>
          <div className="ms-auto inline-flex rounded-md border" role="group" aria-label={t('email.lang.en')}>
            {['en', 'ar'].map((l) => (
              <Button key={l} size="sm" variant={tplLang === l ? 'secondary' : 'ghost'} onClick={() => setTplLang(l)} aria-pressed={tplLang === l}>{t(`email.lang.${l}`)}</Button>
            ))}
          </div>
        </div>
        <Field label={t('email.subject')} value={template[subjField]} dir={tplLang === 'ar' ? 'rtl' : 'ltr'} onChange={(e) => patch({ [subjField]: e.target.value })} data-testid="tpl-subject" />
        <Field as="textarea" rows={10} label={t('email.body')} value={template[bodyField]} dir={tplLang === 'ar' ? 'rtl' : 'ltr'} onChange={(e) => patch({ [bodyField]: e.target.value })} inputClassName="min-h-48 py-2 font-mono text-sm" data-testid="tpl-body" />
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="me-1 font-medium">{t('email.placeholders')}:</span>
          {placeholders.map((p) => (
            <button key={p} type="button" onClick={() => insert(p)} className="inline-flex min-h-8 items-center rounded-full border border-input bg-background px-2 py-0.5 font-mono hover:bg-surface max-md:min-h-11" aria-label={t('email.insert', { key: p })} dir="ltr">{`{{${p}}}`}</button>
          ))}
        </div>
        {showLists && (
          <>
            <Field label={t('email.cc')} value={template.cc.join(', ')} dir="ltr" onChange={(e) => patch({ cc: splitAddresses(e.target.value) })} />
            <Field label={t('email.admin')} value={template.admin.join(', ')} dir="ltr" onChange={(e) => patch({ admin: splitAddresses(e.target.value) })} />
          </>
        )}
        {error && <p className="text-xs text-destructive-text" role="alert">{t(`email.${error}`, { list: placeholders.join(', ') })}</p>}
      </section>
      <section className="space-y-2" data-testid="template-preview">
        <h3 className="text-sm font-semibold">{t('email.preview')}</h3>
        <p className="text-xs text-muted-foreground">{t('email.previewHint')}</p>
        <div className="rounded-card border bg-surface/60 p-4" dir={tplLang === 'ar' ? 'rtl' : 'ltr'}>
          <p className="mb-2 font-semibold" data-testid="preview-subject">{previewSubject}</p>
          {/* PM-authored template, sanitised (scripts / handlers stripped); values are HTML-escaped by the renderer */}
          <div className="prose prose-sm max-w-none text-sm leading-relaxed" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: previewBody }} />
        </div>
      </section>
    </div>
  )
}
export default TemplateEditor
