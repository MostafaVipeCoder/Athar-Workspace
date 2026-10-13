import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import '../../nodes/certificates/i18n.js'
import { renderPayloadToCanvas } from './renderPayload.js'

/**
 * An issued certificate drawn on a canvas from its render payload (see renderPayload.js). ONE component for the PM's preview of an
 * issued certificate, the founder's "My certificate" preview and the public verifier. The canvas is drawn at the displayed width
 * (x device pixel ratio, at most the template's native size) so a phone never decodes a 4000 px picture just to show it; downloads
 * render again at full size. `payload` null shows nothing.
 */
export default function CertificateView({ payload, className, label }) {
  const { t } = useLanguage()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [state, setState] = useState('loading') // loading | ready | error
  const aspect = payload?.template?.width_px && payload?.template?.height_px ? payload.template.width_px / payload.template.height_px : 1.414

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    setWidth(Math.round(el.getBoundingClientRect().width))
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!payload || !canvasRef.current || !width) return undefined
    let cancelled = false
    const nativeWidth = payload.template.width_px || 3508
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    const scale = Math.min(1, (width * dpr) / nativeWidth)
    setState('loading')
    renderPayloadToCanvas(payload, canvasRef.current, { scale })
      .then(() => { if (!cancelled) setState('ready') })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [payload, width])

  if (!payload) return null
  return (
    <div ref={wrapRef} className={cn('relative w-full overflow-hidden rounded-card border border-border bg-surface', className)} style={{ aspectRatio: String(aspect) }} data-testid="certificate-view" data-state={state}>
      <canvas ref={canvasRef} role="img" aria-label={label ?? t('certificates.view.alt', { name: payload.snapshot?.person_name ?? payload.snapshot?.participant_name ?? '' })} className={cn('h-full w-full transition-opacity duration-300', state === 'ready' ? 'opacity-100' : 'opacity-0')} />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">{t('certificates.view.loading')}</span>
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm" role="alert">
          <AlertCircle className="h-6 w-6 text-destructive-text" aria-hidden="true" />
          {t('certificates.view.error')}
        </div>
      )}
    </div>
  )
}
