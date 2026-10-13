import { useEffect, useMemo, useRef, useState } from 'react'
import { renderCertificate } from '../../lib/certificates/render.js'

/**
 * A read-only canvas of a template with values (the PM View). Same renderer as the editor and the downloads; drawn at the displayed
 * width x device pixel ratio.
 */
export default function PreviewCanvas({ image, width, height, fields, values, verifyUrl, label }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [pixels, setPixels] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderCertificate({ canvas: canvasRef.current, image, fields, values, verifyUrl, scale: Math.min(1, (pixels * dpr) / width) }).catch(() => { if (cancelled) return })
    return () => { cancelled = true }
    // fields/values/verifyUrl are compared by value through drawKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, width, pixels, drawKey])
  return (
    <div ref={wrapRef} dir="ltr" className="relative w-full overflow-hidden rounded-card border border-border bg-surface" style={{ aspectRatio: `${width} / ${height}` }} data-testid="preview-canvas">
      <canvas ref={canvasRef} role="img" aria-label={label} className="h-full w-full" />
    </div>
  )
}
