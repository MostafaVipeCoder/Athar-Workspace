import { useId } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Trash2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field, LABEL_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { ALIGNS, DIRECTIONS, FONTS, QR_SIZE, TEXT_SIZE, WIDTH_RANGE, fontOf, normalizeField } from '../../lib/certificates/layout.js'
import './i18n.js'

const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight }
const SWATCHES = ['#1a1a2e', '#000000', '#1a27c9', '#ffffff', '#b8860b', '#7a1f1f']
const pct = (v) => Math.round(v * 1000) / 10

/** A labelled range input (the kit has none): label, current value text, and a slider with the Athar blue accent. */
function Range({ label, value, min, max, step, onChange, info, testId }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
        {info && <span className="text-xs text-muted-foreground" dir="ltr">{info}</span>}
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-full accent-primary" data-testid={testId} />
    </div>
  )
}

/**
 * Properties of the selected field: font family (Latin + Arabic-capable, the ones the app already loads), weight, size, colour,
 * alignment, direction (auto = first strong letter), auto-fit width, lines, box width and the exact position in percent.
 * The QR code only has its size and position. `onChange(patch)` receives a partial field; the parent normalises.
 */
export default function FieldPanel({ field, width, overflow = false, onChange, onRemove }) {
  const { t } = useLanguage()
  if (!field) {
    return <p className="rounded-card border border-dashed border-input p-4 text-sm text-muted-foreground" data-testid="field-panel-empty">{t('certificates.field.none')}</p>
  }
  const isQr = field.var === 'verification_qr'
  const font = fontOf(field.font)
  const set = (patch) => onChange(normalizeField({ ...field, ...patch }))
  const name = t(`certificates.var.${field.var}`)

  return (
    <section className="space-y-4 rounded-card border border-border p-4" aria-label={t('certificates.field.title')} data-testid="field-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold">{name}</h3>
        <Button size="sm" variant="ghost" onClick={() => onRemove(field.var)} aria-label={`${t('certificates.field.remove')}: ${name}`} data-testid="field-remove">
          <Trash2 className="h-4 w-4" aria-hidden="true" />{t('certificates.field.remove')}
        </Button>
      </div>

      {isQr ? (
        <>
          <Range label={t('certificates.field.qr.size')} value={field.w} min={QR_SIZE.min} max={0.3} step={0.005} info={`${pct(field.w)} %`} onChange={(v) => set({ w: v, size: v })} testId="qr-size" />
          <p className="text-xs text-muted-foreground">{t('certificates.field.qr.hint')}</p>
        </>
      ) : (
        <>
          {overflow && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive-text" data-testid="field-overflow">{t('certificates.field.overflow')}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('certificates.field.font')} as="select" value={field.font} onChange={(e) => set({ font: e.target.value })} hint={t('certificates.field.fonts.hint')} data-testid="field-font">
              {FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Field>
            <Field label={t('certificates.field.weight')} as="select" value={String(field.weight)} onChange={(e) => set({ weight: Number(e.target.value) })} data-testid="field-weight">
              {font.weights.map((w) => <option key={w} value={w}>{w}</option>)}
            </Field>
          </div>
          <Range label={t('certificates.field.size')} value={field.size} min={TEXT_SIZE.min} max={0.12} step={0.001} info={t('certificates.field.sizeInfo', { px: Math.round(field.size * width) })} onChange={(v) => set({ size: v })} testId="field-size" />
          <Range label={t('certificates.field.width')} value={field.w} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} step={0.005} info={`${pct(field.w)} %`} onChange={(v) => set({ w: v })} testId="field-width" />

          <div className="space-y-1.5">
            <span className={LABEL_CLASS} id="cert-align-label">{t('certificates.field.align')}</span>
            <div className="flex gap-1" role="group" aria-labelledby="cert-align-label">
              {ALIGNS.map((a) => {
                const Icon = ALIGN_ICON[a]
                return (
                  <button key={a} type="button" aria-pressed={field.align === a} onClick={() => set({ align: a })} data-testid={`align-${a}`}
                    className={cn('tap-target inline-flex flex-1 items-center justify-center gap-1 rounded-md border text-sm', field.align === a ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-surface')}>
                    <Icon className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t(`certificates.field.align.${a}`)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('certificates.field.direction')} as="select" value={field.direction} onChange={(e) => set({ direction: e.target.value })} hint={t('certificates.field.direction.hint')} data-testid="field-direction">
              {DIRECTIONS.map((d) => <option key={d} value={d}>{t(`certificates.field.direction.${d}`)}</option>)}
            </Field>
            <Field label={t('certificates.field.lines')} as="select" value={String(field.maxLines)} onChange={(e) => set({ maxLines: Number(e.target.value) })} data-testid="field-lines">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Field>
          </div>

          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={field.shrinkToFit} onChange={(e) => set({ shrinkToFit: e.target.checked })} data-testid="field-autofit" />
            <span>{t('certificates.field.autoFit')}<span className="block text-xs text-muted-foreground">{t('certificates.field.autoFitHint')}</span></span>
          </label>

          <div className="space-y-1.5">
            <span className={LABEL_CLASS}>{t('certificates.field.color')}</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" aria-label={c} aria-pressed={field.color === c} onClick={() => set({ color: c })} className={cn('h-9 w-9 rounded-full border-2', field.color === c ? 'border-primary ring-2 ring-primary/40' : 'border-input')} style={{ backgroundColor: c }} />
              ))}
              <input type="color" aria-label={t('certificates.field.color')} value={field.color} onChange={(e) => set({ color: e.target.value })} className="h-11 w-14 cursor-pointer rounded-md border border-input bg-background p-1" data-testid="field-color" />
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('certificates.field.x')} type="number" min="0" max="100" step="0.1" value={pct(field.x)} onChange={(e) => set({ x: Number(e.target.value) / 100 })} data-testid="field-x" />
        <Field label={t('certificates.field.y')} type="number" min="0" max="100" step="0.1" value={pct(field.y)} onChange={(e) => set({ y: Number(e.target.value) / 100 })} data-testid="field-y" />
      </div>
    </section>
  )
}
