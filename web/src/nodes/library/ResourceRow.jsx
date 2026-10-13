import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ExternalLink, EyeOff, FileText, GripVertical, Headphones, Image as ImageIcon, Link2, Lock, PlayCircle, Trash2, Upload } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field, SELECT_CLASS, LABEL_CLASS } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { cn } from '../../lib/cn.js'
import { FILE_ACCEPT, RESOURCE_TYPES, RESOURCE_VISIBILITY, categoryName, formatBytes, hostOf, isHttpUrl, isImageMime, resourceTitle, typeFromUrl } from './libraryLogic.js'
import { openFile } from './openResource.js'

const TYPE_ICON = { readable: FileText, audible: Headphones, visual: PlayCircle, link: Link2 }

/**
 * One resource of the editor draft: a compact line (grip, icon, title, visibility, preview, expand, arrows, remove) and an
 * inline editor (bilingual title + description, type, category, visibility, the link or the file, the cover). Everything
 * goes to the parent's draft (`onChange(next)`); nothing is written before the frame's Save. `userType` stays false until the
 * PM touches the type, so pasting a link keeps suggesting a type from its host.
 */
export default function ResourceRow({ resource: r, index, count, categories, errors, expanded, onToggle, onChange, onRemove, onMove, onReplaceFile, onUseLink, onCover, onCoverClear, onPreviewError, dragHandleProps, dragging, reorderable }) {
  const { t, lang } = useLanguage()
  const fileInput = useRef(null)
  const [typeTouched, setTypeTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const title = resourceTitle(r, lang) || t('library.edit.untitled')
  const Icon = isImageMime(r.mime) ? ImageIcon : TYPE_ICON[r.type] ?? FileText
  const patch = (p) => onChange({ ...r, ...p })
  const err = errors?.[r.id] ?? {}
  const iconBtn = ''

  async function preview() {
    if (r.filePath) {
      try { await openFile(r) } catch (e) { onPreviewError?.(e) }
    }
  }
  async function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try { await onReplaceFile(r, file) } finally { setBusy(false) }
  }
  const sub = [t(`library.type.${r.type}`), r.filePath ? formatBytes(r.bytes, lang) : hostOf(r.url), categories.find((c) => c.id === r.categoryId) ? categoryName(categories.find((c) => c.id === r.categoryId), lang) : ''].filter(Boolean).join(' · ')

  return (
    <article className={cn('rounded-card border bg-card', err.title || err.url || err.source ? 'border-destructive' : 'border-border', dragging && 'opacity-50')} data-testid="resource-row" data-resource={r.id} aria-label={title}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        {reorderable && (
          <button type="button" className="tap-target inline-flex cursor-grab items-center justify-center text-muted-foreground" aria-label={t('library.edit.dragHint')} {...dragHandleProps}>
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface text-primary" aria-hidden="true">
          {r.coverPath ? <img src={publicThumbUrl(r.coverPath)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p dir="auto" className="truncate font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        {r.visibility !== 'public' && (
          <Badge tone={r.visibility === 'hidden' ? 'neutral' : 'blue'}>
            {r.visibility === 'hidden' ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <Lock className="h-3 w-3" aria-hidden="true" />}
            {t(`library.visibility.${r.visibility}.short`)}
          </Badge>
        )}
        <div className="flex w-full flex-wrap items-center justify-between gap-1 sm:w-auto sm:justify-end">
         <div className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`vis-${r.id}`}>{`${t('library.edit.visibility')}: ${title}`}</label>
          <select id={`vis-${r.id}`} className={cn(SELECT_CLASS, 'w-auto py-1 text-sm')} value={r.visibility} onChange={(e) => patch({ visibility: e.target.value })} data-testid="row-visibility">
            {RESOURCE_VISIBILITY.map((v) => <option key={v} value={v}>{t(`library.visibility.${v}.short`)}</option>)}
          </select>
          {r.filePath ? (
            <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${t('library.edit.preview')}: ${title}`} onClick={preview}><ExternalLink className="h-4 w-4" aria-hidden="true" /></Button>
          ) : isHttpUrl(r.url) ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-foreground transition-colors duration-300 hover:bg-surface" aria-label={`${t('library.edit.preview')}: ${title}`}><ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
          ) : null}
          <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${expanded ? t('library.edit.collapse') : t('library.edit.expand')}: ${title}`} aria-expanded={expanded} onClick={onToggle} data-testid="row-expand">
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </Button>
         </div>
         <div className="flex items-center gap-1">
          {reorderable && (
            <>
              <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${t('library.edit.moveUp')}: ${title}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
              <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${t('library.edit.moveDown')}: ${title}`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
            </>
          )}
          <Button size="icon" variant="ghost" className={cn(iconBtn, 'text-destructive')} aria-label={`${t('library.edit.remove')}: ${title}`} onClick={onRemove} data-testid="row-remove"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
         </div>
        </div>
      </div>
      {(err.title || err.url || err.source) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive-text">{t(`library.err.${err.title ?? err.url ?? err.source}`)}</p>
      )}

      {expanded && (
        <div className="space-y-4 border-t border-border p-3 sm:p-4" data-testid="resource-editor">
          <BilingualField label={t('library.edit.title')} value={r.title} onChange={(v) => patch({ title: v })} error={err.title ? t('library.err.title') : undefined} required />
          <BilingualField label={t('library.edit.description')} as="textarea" rows={2} value={r.description} onChange={(v) => patch({ description: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('library.edit.type')} as="select" value={r.type} onChange={(e) => { setTypeTouched(true); patch({ type: e.target.value }) }} data-testid="row-type">
              {RESOURCE_TYPES.map((x) => <option key={x} value={x}>{t(`library.type.${x}`)}</option>)}
            </Field>
            <Field label={t('library.edit.category')} as="select" value={r.categoryId ?? ''} onChange={(e) => patch({ categoryId: e.target.value || null })} data-testid="row-category">
              <option value="">{t('library.edit.noCategory')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{categoryName(c, lang) || t('library.edit.untitledCategory')}</option>)}
            </Field>
          </div>
          <fieldset className="space-y-1">
            <legend className={LABEL_CLASS}>{t('library.edit.visibility')}</legend>
            {RESOURCE_VISIBILITY.map((v) => (
              <label key={v} className="flex min-h-9 items-start gap-2 text-sm">
                <input type="radio" className="mt-1" name={`vis-${r.id}`} value={v} checked={r.visibility === v} onChange={() => patch({ visibility: v })} />
                <span>{t(`library.visibility.${v}`)}<span className="block text-xs text-muted-foreground">{t(`library.visibility.${v}.hint`)}</span></span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-2" data-testid="resource-source">
            {r.filePath ? (
              <>
                <p className={LABEL_CLASS}>{t('library.edit.file')}</p>
                <p className="text-sm text-muted-foreground" dir="ltr">{[r.mime, formatBytes(r.bytes, lang)].filter(Boolean).join(' · ')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" loading={busy} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{t('library.edit.replaceFile')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => onUseLink(r)}>{t('library.edit.useLink')}</Button>
                </div>
              </>
            ) : (
              <>
                <Field label={t('library.edit.url')} type="url" dir="ltr" inputMode="url" placeholder="https://" value={r.url} error={err.url || err.source ? t(`library.err.${err.url ?? err.source}`) : undefined} data-testid="row-url"
                  onChange={(e) => patch({ url: e.target.value, ...(typeTouched ? {} : { type: typeFromUrl(e.target.value) }) })} />
                <Button size="sm" variant="outline" loading={busy} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{t('library.edit.uploadInstead')}</Button>
              </>
            )}
            <input ref={fileInput} type="file" accept={FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pickFile} />
          </div>

          <ImageField
            label={t('library.edit.cover')}
            profile="content"
            src={r.coverPath ? publicImageUrl(r.coverPath) : null}
            thumb={r.coverPath ? publicThumbUrl(r.coverPath) : null}
            aspect="16 / 10"
            labels={{ choose: t('image.choose'), replace: t('image.replace'), remove: t('image.remove'), hint: t('library.edit.coverHint') }}
            errorText={(p) => t(`errors.image.${p}`)}
            onFile={(file) => onCover(r, file)}
            onClear={() => onCoverClear(r)}
          />
        </div>
      )}
    </article>
  )
}
