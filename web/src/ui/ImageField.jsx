import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, ImagePlus, Info, Trash2 } from 'lucide-react'
import { Img } from './Img.jsx'
import { Button } from './Button.jsx'
import { cn } from '../lib/cn.js'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { acceptFor, convertToWebp, describeReport, validateImageFile } from '../lib/image/index.js'

/**
 * Image picker with preview (design 06 section 6.1 ImageField, P18, owner decision 08 section 17.3 UNIVERSAL WEBP).
 * Generic: it does NOT upload. The page passes `onFile(file)` (a promise that resolves once the image is stored; the data layer's
 * `uploadImage` asks the pipeline for the SAME conversion again and gets it from the cache) and the current `src`/`thumb` URLs.
 *
 * What the user sees: pick -> "Reading the image / Converting to WebP / Preparing the thumbnail" with a progress bar -> "Uploading..."
 * -> "Optimised: 2.1 MB -> 180 KB (-91%)" (or "Already WebP", "SVG kept as is", the animated-GIF notice). The preview is the converted
 * image, i.e. exactly what is stored. A file that cannot be used (HEIC, corrupt, not an image, too big) is refused with a specific
 * ar/en message and nothing is uploaded.
 *
 * `profile` = which preparation (lib/image/profiles.js: cover, landing, content, avatar, logo, frame, template, attachment); it must match
 * the profile the page's upload uses (`uploadImage` derives it from `kind`) so the conversion is done once.
 */
export function ImageField({ label, src, thumb, onFile, onClear, disabled, aspect = '16 / 9', className, labels = {}, errorText, profile = 'content' }) {
  const id = useId()
  const { t } = useLanguage()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [report, setReport] = useState(null)
  const previewUrl = useRef(null)

  // the object URL stays alive while it is displayed; it is revoked when replaced or on unmount
  const swapPreview = useCallback((url) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = url
    setPreview(url)
  }, [])
  useEffect(() => () => swapPreview(null), [swapPreview])

  function failure(err) {
    const key = err?.messageKey
    if (key && key.startsWith('errors.image.')) return t(key)
    const custom = errorText?.('upload', err)
    if (custom) return custom
    if (key) {
      const text = t(key)
      if (text !== key) return text
    }
    return t('errors.image.upload')
  }

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = validateImageFile(file, profile)
    if (problem) {
      setError(t(`errors.${problem}`))
      return
    }
    setError(null)
    setReport(null)
    setBusy(true)
    setProgress({ stage: 'checking', percent: 2 })
    try {
      const result = await convertToWebp(file, { profile, onProgress: setProgress })
      swapPreview(URL.createObjectURL(result.full.blob))
      setReport(result.report)
      setProgress({ stage: 'uploading', percent: 100 })
      await onFile(file)
    } catch (err) {
      swapPreview(null)
      setReport(null)
      setError(failure(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const shown = preview ?? src
  const summary = report ? describeReport(report) : null
  return (
    <div className={cn('space-y-2', className)}>
      <span className="block text-sm font-medium text-athar-ink" id={`${id}-label`}>{label}</span>
      <div className="overflow-hidden rounded-card border">
        <Img src={shown} thumb={preview ? undefined : thumb} alt="" aspect={aspect} eager />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} id={id} type="file" accept={acceptFor(profile)} className="sr-only" tabIndex={-1} onChange={pick} disabled={disabled || busy} aria-labelledby={`${id}-label`} />
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {shown ? labels.replace ?? t('image.replace') : labels.choose ?? t('image.choose')}
        </Button>
        {shown && onClear && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => { swapPreview(null); setReport(null); onClear() }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {labels.remove ?? t('image.remove')}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{labels.hint ?? t('image.hint')}</span>
      </div>
      {busy && progress && (
        <div role="status" aria-live="polite" className="space-y-1" data-testid="image-progress">
          <p className="text-xs text-muted-foreground">{t(`image.stage.${progress.stage}`)}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <div className={cn('h-full rounded-full bg-primary transition-[width] duration-200', progress.stage === 'uploading' && 'animate-pulse')} style={{ width: `${Math.max(4, Math.min(100, progress.percent ?? 0))}%` }} />
          </div>
        </div>
      )}
      {!busy && summary && (
        <div role="status" aria-live="polite" className="space-y-0.5" data-testid="image-report">
          <p className="flex items-start gap-1.5 text-xs text-emerald-800"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(summary.key, summary.vars)}</p>
          {report.notices.map((n) => (
            <p key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`image.notice.${n}`, { w: report.width, h: report.height })}</p>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}
