import { useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { fieldBox, moveField, nudge, resizeField } from '../../lib/certificates/layout.js'
import { renderCertificate } from '../../lib/certificates/render.js'
import './i18n.js'

/**
 * The positioning editor (design 07 section 4.3): a LIVE canvas of the template with the sample values drawn exactly as the final
 * certificate is (the same renderCertificate), and one draggable box per field laid over it. Everything is in FRACTIONS of the
 * template (lib/certificates/layout.js), so the preview size never matters. Drag = move, the two side handles = box width (the QR has
 * a corner handle = its size), arrow keys = nudge (Shift = bigger). The stage is `dir="ltr"` on purpose: the canvas world is
 * physical, the page direction only mirrors the panels around it.
 */
export default function CanvasEditor({ image, width, height, fields, selected, onSelect, onChange, onRemove, values, verifyUrl, onOverflow }) {
  const { t } = useLanguage()
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const drag = useRef(null)
  const [pixels, setPixels] = useState(0)

  // the canvas is drawn at the DISPLAYED width x device pixel ratio (never more than the template)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const read = () => setPixels(Math.round(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const drawKey = useMemo(() => JSON.stringify([fields, values, verifyUrl]), [fields, values, verifyUrl])
  useEffect(() => {
    if (!image || !canvasRef.current || !pixels) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      renderCertificate({ canvas: canvasRef.current, image, fields, values, verifyUrl, scale: Math.min(1, (pixels * dpr) / width) })
        .then((out) => { if (!cancelled) onOverflow?.(out.overflow) })
        .catch(() => {})
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
    // fields/values/verifyUrl are compared by value through drawKey; the callbacks are intentionally not dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, width, pixels, drawKey])

  function begin(e, field, mode) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    onSelect(field.var)
    drag.current = { var: field.var, mode, x: e.clientX, y: e.clientY, start: field, rect: stageRef.current.getBoundingClientRect() }
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / d.rect.width
    const dy = (e.clientY - d.y) / d.rect.height
    if (d.mode === 'move') onChange(d.var, moveField(d.start, dx, dy))
    else if (d.mode === 'left') onChange(d.var, resizeField(d.start, -2 * dx))
    else onChange(d.var, resizeField(d.start, 2 * dx))
  }
  function end(e) {
    if (!drag.current) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    drag.current = null
  }
  function key(e, field) {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove?.(field.var); return }
    if (!e.key.startsWith('Arrow')) return
    e.preventDefault()
    onChange(field.var, nudge(field, e.key, e.shiftKey ? 0.01 : 0.002))
  }

  return (
    <div
      ref={stageRef}
      dir="ltr"
      className="relative w-full touch-pan-y select-none overflow-hidden rounded-card border border-border bg-surface"
      style={{ aspectRatio: `${width} / ${height}` }}
      data-testid="canvas-stage"
      onPointerDown={() => onSelect(null)}
    >
      <canvas ref={canvasRef} role="img" aria-label={t('certificates.tpl.canvas')} className="absolute inset-0 h-full w-full" />
      {fields.map((field) => {
        const box = fieldBox(field, width, height)
        const isQr = field.var === 'verification_qr'
        const active = selected === field.var
        const name = t(`certificates.var.${field.var}`)
        return (
          <div
            key={field.var}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={t('certificates.tpl.field.label', { name })}
            data-testid={`field-${field.var}`}
            data-active={active || undefined}
            className={cn(
              'absolute cursor-move touch-none rounded-xs outline-offset-0 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              active ? 'z-20 bg-primary/10 ring-2 ring-primary' : 'z-10 outline-dashed outline-1 outline-primary/50 hover:bg-primary/5',
            )}
            style={{ left: `${(box.left / width) * 100}%`, top: `${(box.top / height) * 100}%`, width: `${(box.width / width) * 100}%`, height: `${(box.height / height) * 100}%` }}
            onPointerDown={(e) => begin(e, field, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => key(e, field)}
            onFocus={() => onSelect(field.var)}
          >
            {active && (
              <span className="pointer-events-none absolute -top-6 start-0 z-30 whitespace-nowrap rounded-xs bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground" dir="auto">
                {name}
              </span>
            )}
            {active && !isQr && (
              <>
                <span role="presentation" aria-label={t('certificates.tpl.handle.width', { name })} data-testid={`handle-left-${field.var}`} className="absolute -start-2 top-1/2 z-30 h-8 w-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-sm border-2 border-background bg-primary" onPointerDown={(e) => begin(e, field, 'left')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
                <span role="presentation" aria-label={t('certificates.tpl.handle.width', { name })} data-testid={`handle-right-${field.var}`} className="absolute -end-2 top-1/2 z-30 h-8 w-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-sm border-2 border-background bg-primary" onPointerDown={(e) => begin(e, field, 'right')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              </>
            )}
            {active && isQr && (
              <span role="presentation" aria-label={t('certificates.tpl.handle.size', { name })} data-testid={`handle-size-${field.var}`} className="absolute -bottom-2 -end-2 z-30 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-background bg-primary" onPointerDown={(e) => begin(e, field, 'right')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            )}
          </div>
        )
      })}
      {fields.length === 0 && image && (
        <p className="pointer-events-none absolute inset-x-4 bottom-3 rounded-md bg-background/90 p-2 text-center text-xs text-muted-foreground">{t('certificates.tpl.vars.hint')}</p>
      )}
    </div>
  )
}

