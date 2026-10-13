import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Download, Image as ImageIcon, Pencil, Share2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import { translate } from '../../i18n/core.js'
import { pickBi } from './landingLogic.js'
import { canvasToPngBlob, composeToCanvas, decodePhoto, initialTransform, loadFrameImage } from './photoCompose.js'
import { canShareFiles } from './clipboard.js'
import './i18n.js'

const CropModal = lazy(() => import('./CropModal.jsx'))

const PRIMARY_BTN =
  'inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-primary/35 bg-background px-5 text-base font-bold text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
const SOLID_BTN =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border-[1.5px] border-primary bg-primary px-4 text-[0.95rem] font-bold text-primary-foreground shadow-[0_4px_14px_hsl(var(--primary)/0.25)] transition duration-200 hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
const SOFT_BTN =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border-[1.5px] border-primary/35 bg-background px-4 text-[0.95rem] font-bold text-primary transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

/**
 * "Personalize the Moment" (landing-page.html lines 1350-1415): the visitor picks a photo, it is cropped to 4:5 and composited with the
 * PM's transparent PNG frame ON THE VISITOR'S DEVICE (the photo is never uploaded; the only thing recorded is that an upload / download
 * happened). Texts, button labels and the frames come from the page config; with more than one frame a picker appears (decision 01-14).
 * Props: config (normalised `personalize`), frames (models), frameUrl(frame) -> public URL, lang, compact, track, slug (file name),
 * preview (the editor's live preview: nothing is recorded), id (section anchor).
 */
export default function PersonalizeSection({ config, frames, frameUrl, lang, compact, track, slug, preview = false, id = 'landing-personalize', scrollMt = '' }) {
  const tl = useMemo(() => (key, vars) => translate(lang, key, vars), [lang])
  const label = (k, fallback) => pickBi(config.labels?.[k], lang) || tl(fallback)
  const inputRef = useRef(null)
  const [photo, setPhoto] = useState(null) // { bitmap, width, height, url }
  const [transform, setTransform] = useState(initialTransform())
  const [result, setResult] = useState(null) // { url, blob }
  const [frameId, setFrameId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const frameCache = useRef(new Map())
  const urls = useRef({ photo: null, result: null })

  const frame = useMemo(() => frames.find((f) => f.id === frameId) ?? frames[0] ?? null, [frames, frameId])
  const frameSrc = frame ? frameUrl(frame) : ''

  useEffect(() => {
    const u = urls.current
    return () => {
      if (u.photo) URL.revokeObjectURL(u.photo)
      if (u.result) URL.revokeObjectURL(u.result)
    }
  }, [])

  const getFrameImage = useCallback(async (f) => {
    if (!f) return null
    const src = frameUrl(f)
    if (!frameCache.current.has(src)) frameCache.current.set(src, loadFrameImage(src).catch(() => null))
    return frameCache.current.get(src)
  }, [frameUrl])

  const compose = useCallback(async (ph, tr, f) => {
    const img = await getFrameImage(f)
    if (f && !img) setError(tl('landing.photo.frameFailed'))
    const canvas = composeToCanvas(document.createElement('canvas'), { photo: ph.bitmap, photoW: ph.width, photoH: ph.height, transform: tr, frame: img })
    const blob = await canvasToPngBlob(canvas)
    const url = URL.createObjectURL(blob)
    if (urls.current.result) URL.revokeObjectURL(urls.current.result)
    urls.current.result = url
    setResult({ url, blob })
  }, [getFrameImage, tl])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(tl('landing.photo.notImage'))
      return
    }
    setError('')
    setBusy(true)
    try {
      const decoded = await decodePhoto(file)
      if (urls.current.photo) URL.revokeObjectURL(urls.current.photo)
      const url = URL.createObjectURL(file)
      urls.current.photo = url
      const next = { ...decoded, url }
      const tr = initialTransform()
      await compose(next, tr, frame)
      setPhoto(next)
      setTransform(tr)
      if (!preview) track?.('image_upload')
    } catch {
      setError(tl('landing.photo.decodeFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function onApply(tr) {
    setEditing(false)
    setTransform(tr)
    setBusy(true)
    try {
      await compose(photo, tr, frame)
    } catch {
      setError(tl('landing.photo.composeFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function onPickFrame(f) {
    setFrameId(f.id)
    if (!photo) return
    setBusy(true)
    try {
      await compose(photo, transform, f)
    } catch {
      setError(tl('landing.photo.composeFailed'))
    } finally {
      setBusy(false)
    }
  }

  const choose = () => inputRef.current?.click()
  const fileName = `${slug || 'athar'}-athar.png`

  async function onShareFile() {
    if (!result) return
    try {
      await navigator.share({ files: [new File([result.blob], fileName, { type: 'image/png' })], title: pickBi(config.title, lang) })
    } catch {
      /* closed */
    }
  }

  const title = pickBi(config.title, lang)
  const body = pickBi(config.body, lang)
  const showShare = Boolean(result) && canShareFiles()

  return (
    <section id={id} aria-label={title || tl('landing.photo.section')} className={cn('relative bg-background', compact ? 'py-10' : 'py-20', scrollMt)} data-testid="personalize-section">
      <div className={cn('mx-auto flex max-w-[1080px] px-5 sm:px-6', compact ? 'flex-col items-center gap-7' : 'items-stretch justify-between gap-[52px]')}>
        <div className={cn('flex flex-col', compact ? 'w-full' : 'max-w-[500px] flex-1')}>
          {title && <h2 dir="auto" className={`font-display text-primary ${compact ? 'text-[2.1rem] leading-[1.1]' : 'text-[clamp(2.3rem,4.8vw,3.6rem)] leading-[1.05]'}`} style={{ whiteSpace: 'pre-line' }}>{title}</h2>}
          {body && <p dir="auto" className={`mt-4 text-md text-muted-foreground ${compact ? 'max-w-full' : 'max-w-[460px]'}`}>{body}</p>}
          {!compact && <div className="landing-dots mt-8 min-h-[240px] w-full flex-1" aria-hidden="true" />}
        </div>

        <div className={cn('flex w-full flex-col items-center gap-4', compact ? 'max-w-[350px]' : 'max-w-[440px] flex-1')}>
          <button
            type="button"
            onClick={photo ? () => setEditing(true) : choose}
            aria-label={photo ? label('edit', 'landing.photo.edit') : label('choose', 'landing.photo.choose')}
            className={cn(
              'relative flex aspect-[4/5] w-full max-w-[440px] items-center justify-center overflow-hidden rounded-[22px] bg-gradient-to-br from-primary/10 to-primary/20 transition duration-200 hover:-translate-y-0.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:rounded-[28px]',
              photo ? 'border-[1.5px] border-primary/30' : 'border-[1.5px] border-dashed border-primary/30',
            )}
            data-testid="photo-frame"
          >
            {result ? (
              <img src={result.url} alt={tl('landing.photo.previewAlt')} className="h-full w-full object-cover" data-testid="photo-result" />
            ) : (
              <span className="pointer-events-none flex flex-col items-center gap-3 text-primary opacity-70">
                <ImageIcon className="h-14 w-14" strokeWidth={1.6} aria-hidden="true" />
                <span className="text-sm font-bold">{label('placeholder', 'landing.photo.placeholder')}</span>
              </span>
            )}
            {!result && frameSrc && <img src={frameSrc} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" data-testid="photo-frame-overlay" />}
            {busy && <span role="status" className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm font-semibold text-primary">{tl('landing.photo.working')}</span>}
          </button>

          {frames.length > 1 && (
            <fieldset className="w-full max-w-[440px]" data-testid="frame-picker">
              <legend className="mb-2 text-sm font-semibold text-athar-ink">{tl('landing.photo.chooseFrame')}</legend>
              <div className="flex flex-wrap justify-center gap-2.5">
                {frames.map((f, i) => (
                  <label key={f.id} className="relative cursor-pointer">
                    <input type="radio" name="landing-frame" className="peer sr-only" checked={f.id === frame?.id} onChange={() => onPickFrame(f)} aria-label={f.name || tl('landing.photo.frameN', { n: i + 1 })} />
                    <span className="block h-[70px] w-14 overflow-hidden rounded-md border-2 border-border bg-gradient-to-br from-primary/10 to-primary/20 transition peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      <img src={frameUrl(f)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={onFile} data-testid="photo-input" aria-label={label('choose', 'landing.photo.choose')} />

          {!photo ? (
            <button type="button" onClick={choose} className={cn(PRIMARY_BTN, 'landing-pulse')} data-testid="choose-photo">
              <Camera className="h-5 w-5" aria-hidden="true" />
              {label('choose', 'landing.photo.choose')}
            </button>
          ) : (
            <div className="flex w-full max-w-[440px] flex-col items-center gap-2.5">
              <div className="flex w-full gap-2.5">
                <a href={result?.url} download={fileName} onClick={() => !preview && track?.('image_download')} className={SOLID_BTN} data-testid="download-photo" aria-disabled={!result}>
                  <Download className="h-[18px] w-[18px]" aria-hidden="true" />
                  {label('download', 'landing.photo.download')}
                </a>
                <button type="button" onClick={() => setEditing(true)} className={SOFT_BTN} data-testid="edit-photo">
                  <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />
                  {label('edit', 'landing.photo.edit')}
                </button>
              </div>
              {showShare && (
                <button type="button" onClick={onShareFile} className={cn(SOFT_BTN, 'w-full flex-none')} data-testid="share-photo">
                  <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
                  {tl('landing.photo.sharePicture')}
                </button>
              )}
              <button type="button" onClick={choose} className="inline-flex min-h-11 items-center justify-center gap-1.5 px-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary hover:underline" data-testid="change-photo">
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                {label('change', 'landing.photo.change')}
              </button>
            </div>
          )}
          <p className="max-w-[440px] text-center text-xs text-muted-foreground">{tl('landing.photo.privacy')}</p>
          {error && <p role="alert" className="text-center text-sm text-destructive-text" data-testid="photo-error">{error}</p>}
        </div>
      </div>

      {editing && photo && (
        <Suspense fallback={null}>
          <CropModal open onClose={() => setEditing(false)} onApply={onApply} photo={photo} frameUrl={frameSrc} transform={transform} lang={lang} />
        </Suspense>
      )}
    </section>
  )
}
