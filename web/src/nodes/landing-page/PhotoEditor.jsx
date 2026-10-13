import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { framePublicUrl, uploadFramePng } from '../../data/landing.js'
import { OUT_H, OUT_W, inspectFrameFile } from './photoCompose.js'
import { LABEL_KEYS, MAX_FRAMES, emptyFrame, moveItem } from './landingLogic.js'

const CHECKER = { backgroundImage: 'conic-gradient(hsl(var(--border)) 25%, transparent 0 50%, hsl(var(--border)) 0 75%, transparent 0)', backgroundSize: '16px 16px' }

/**
 * "Personalize the Moment" in the builder (design 07 section 6, decision 01-14): the section's texts and button labels, and the LIST of frames
 * (PM-uploaded transparent PNGs, 4:5, at least 1080 x 1350, <= 5 MB). A frame is validated in the browser before it is uploaded (PNG, 4:5, a
 * transparent window AND visible artwork); the window found in the alpha channel is stored and drawn as a dashed safe-zone over a sample
 * photo so the PM can see where a face will land. The visitor's photo never leaves the visitor's browser. Frames are written with the page
 * (one Save); the file is uploaded as soon as it is chosen, and files nobody references after Save are removed.
 * Props: config (personalize), patch(partial), frames, setFrames, projectId, onUploaded(path), onRemoved(frame, index) (Undo toast of the parent).
 */
export default function PhotoEditor({ config, patch, frames, setFrames, projectId, onUploaded, onRemoved }) {
  const { t } = useLanguage()
  const toast = useToast()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState([])
  const labels = config.labels

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProblems([])
    setBusy(true)
    try {
      const r = await inspectFrameFile(file)
      if (r.problems.length) {
        setProblems(r.problems)
        return
      }
      const path = await uploadFramePng(file, { projectId })
      onUploaded(path)
      setFrames((cur) => [...cur, emptyFrame({ name: file.name.replace(/\.png$/i, '').slice(0, 80), path, windowX: r.window?.x ?? null, windowY: r.window?.y ?? null, windowW: r.window?.w ?? null, windowH: r.window?.h ?? null })])
      toast.success(t('landing.frames.added'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }
  const edit = (id, p) => setFrames((cur) => cur.map((f) => (f.id === id ? { ...f, ...p } : f)))

  return (
    <div className="space-y-5" data-testid="photo-editor">
      <section className="space-y-4 rounded-card border p-4 sm:p-5">
        <label className="flex min-h-9 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} data-testid="personalize-enabled" />
          <span className="font-semibold">{t('landing.photo.enabled')}<span className="block text-xs font-normal text-muted-foreground">{t('landing.photo.enabledHint')}</span></span>
        </label>
        <BilingualField label={t('landing.photo.title')} value={config.title} onChange={(title) => patch({ title })} />
        <BilingualField label={t('landing.photo.body')} value={config.body} onChange={(body) => patch({ body })} as="textarea" rows={3} />
        <details className="rounded-card border bg-surface/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t('landing.photo.labels')}</summary>
          <p className="mt-1 text-xs text-muted-foreground">{t('landing.photo.labelsHint')}</p>
          <div className="mt-3 space-y-3">
            {LABEL_KEYS.map((k) => <BilingualField key={k} label={t(`landing.photo.label.${k}`)} value={labels[k]} onChange={(v) => patch({ labels: { ...labels, [k]: v } })} />)}
          </div>
        </details>
      </section>

      <section className="space-y-4 rounded-card border p-4 sm:p-5" data-testid="frames-editor">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-bold">{t('landing.frames.heading')}</h3>
            <p className="text-sm text-muted-foreground">{t('landing.frames.hint')}</p>
          </div>
          <div>
            <input ref={inputRef} type="file" accept="image/png" className="sr-only" tabIndex={-1} onChange={onFile} data-testid="frame-input" aria-label={t('landing.frames.add')} />
            <Button onClick={() => inputRef.current?.click()} loading={busy} disabled={frames.length >= MAX_FRAMES}><ImagePlus className="h-4 w-4" aria-hidden="true" />{t('landing.frames.add')}</Button>
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-md bg-surface p-3 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{t('landing.frames.privacy')}</p>
        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="frame-problems">
            <p className="font-semibold text-destructive-text">{t('landing.frames.rejected')}</p>
            <ul className="mt-1 list-disc ps-5">{problems.map((p) => <li key={p}>{t(`landing.frames.err.${p}`, { w: OUT_W, h: OUT_H })}</li>)}</ul>
          </div>
        )}
        {frames.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('landing.frames.none')}</p>
        ) : (
          <ul className="space-y-3">
            {frames.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-start gap-4 rounded-card border bg-card p-3" data-testid="frame-row">
                <div className="relative aspect-[4/5] w-32 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-primary/20 to-primary/5" aria-label={t('landing.frames.safeZone')} role="img">
                  <div className="absolute inset-0 opacity-30" style={CHECKER} aria-hidden="true" />
                  <img src={framePublicUrl(f.path)} alt="" className="absolute inset-0 h-full w-full" />
                  {f.windowW && f.windowH && (
                    <div aria-hidden="true" className="absolute border-2 border-dashed border-accent" style={{ insetInlineStart: `${(f.windowX / OUT_W) * 100}%`, top: `${(f.windowY / OUT_H) * 100}%`, width: `${(f.windowW / OUT_W) * 100}%`, height: `${(f.windowH / OUT_H) * 100}%`, borderRadius: f.shape === 'circle' ? '50%' : 0 }} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Field label={t('landing.frames.name')} value={f.name} onChange={(e) => edit(f.id, { name: e.target.value })} maxLength={80} />
                  <p className="text-xs text-muted-foreground">{f.windowW ? t('landing.frames.window', { w: f.windowW, h: f.windowH }) : t('landing.frames.noWindow')}</p>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setFrames((cur) => moveItem(cur, i, i - 1))} aria-label={t('landing.edit.moveUp')}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" disabled={i === frames.length - 1} onClick={() => setFrames((cur) => moveItem(cur, i, i + 1))} aria-label={t('landing.edit.moveDown')}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => onRemoved(f, i)} aria-label={t('landing.edit.remove')} data-testid="remove-frame"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('landing.edit.remove')}</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {frames.length > 1 && <p className="text-xs text-muted-foreground">{t('landing.frames.pickerNote')}</p>}
      </section>
    </div>
  )
}
