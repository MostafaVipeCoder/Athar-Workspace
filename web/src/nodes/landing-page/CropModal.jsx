import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { Modal } from '../../ui/Modal.jsx'
import { translate } from '../../i18n/core.js'
import { Button } from '../../ui/Button.jsx'
import { FRAME_ASPECT, ZOOM_MAX, ZOOM_MIN, clampTransform, coverBase, initialTransform } from './photoCompose.js'
import './i18n.js'

const STEP_PAN = 0.02
const STEP_PAN_BIG = 0.1
const STEP_ZOOM = 0.2
const MIN_VP = 180

/**
 * The crop dialog of "Personalize the Moment" (landing-page.html lines 1421-1455, 1569-1653): the photo in a 4:5 viewport with the
 * frame on top and a 3 x 3 grid; drag to move (mouse / touch / pen via pointer events), pinch or wheel or the slider or +/- to zoom
 * (1x to 3.5x), arrow keys to move and +/- to zoom when the viewport has focus. The photo can never leave the frame empty
 * (`clampTransform`). The pan is a fraction of the viewport, so what is previewed here is exactly what the 1080 x 1350 export draws.
 *
 * Props: photo { url, width, height } (url = an object URL of the visitor's file), frameUrl (the frame image shown on top, or ''),
 * transform (the current one), onApply(transform), onClose().
 */
export default function CropModal({ open, onClose, onApply, photo, frameUrl, transform, lang }) {
  const tl = useMemo(() => (key, vars) => translate(lang, key, vars), [lang])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tl('landing.crop.title')}
      closeLabel={tl('landing.close')}
      className="landing-page sm:max-w-md"
      footer={null}
    >
      {open && <CropBody key={photo?.url} photo={photo} frameUrl={frameUrl} initial={transform} onApply={onApply} onClose={onClose} tl={tl} lang={lang} />}
    </Modal>
  )
}

function CropBody({ photo, frameUrl, initial, onApply, onClose, tl, lang }) {
  const wrapRef = useRef(null)
  const viewRef = useRef(null)
  const [vp, setVp] = useState({ w: 280, h: 350 })
  const [draft, setDraft] = useState(() => initial ?? initialTransform())
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  const geo = useMemo(() => ({ imgW: photo.width, imgH: photo.height, vpW: vp.w, vpH: vp.h }), [photo.width, photo.height, vp.w, vp.h])
  const apply = useCallback((t) => clampTransform(t, geo), [geo])
  const set = useCallback((fn) => setDraft((cur) => clampTransform(typeof fn === 'function' ? fn(cur) : fn, geo)), [geo])

  // viewport size: as wide as the dialog allows, never taller than half the screen (a phone must still see the buttons)
  useLayoutEffect(() => {
    const measure = () => {
      const wrapW = wrapRef.current?.getBoundingClientRect().width || 280
      const maxH = Math.max(MIN_VP * 1.25, Math.min(window.innerHeight * 0.5, 440))
      const w = Math.max(MIN_VP, Math.min(wrapW, maxH * FRAME_ASPECT))
      setVp({ w: Math.round(w), h: Math.round(w / FRAME_ASPECT) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // wheel zoom needs a non-passive listener (React's onWheel is passive)
  useEffect(() => {
    const el = viewRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      set((cur) => ({ ...cur, scale: cur.scale + e.deltaY * -0.0015 }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [set])

  const dist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  function onPointerDown(e) {
    viewRef.current?.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startGesture(e)
  }
  function startGesture(e) {
    if (pointers.current.size === 2) gesture.current = { type: 'pinch', d: dist() || 1, scale: draft.scale }
    else if (pointers.current.size === 1) {
      const p = [...pointers.current.values()][0]
      gesture.current = { type: 'pan', x: p.x ?? e.clientX, y: p.y ?? e.clientY, nx: draft.nx, ny: draft.ny }
    } else gesture.current = null
  }
  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan' && pointers.current.size === 1) set((cur) => ({ ...cur, nx: g.nx + (e.clientX - g.x) / vp.w, ny: g.ny + (e.clientY - g.y) / vp.h }))
    else if (g.type === 'pinch' && pointers.current.size === 2) set((cur) => ({ ...cur, scale: g.scale * (dist() / g.d) }))
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    startGesture(e)
  }
  function onKeyDown(e) {
    const big = e.shiftKey ? STEP_PAN_BIG : STEP_PAN
    const move = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, -big], ArrowDown: [0, big] }[e.key]
    if (move) {
      e.preventDefault()
      set((cur) => ({ ...cur, nx: cur.nx + move[0], ny: cur.ny + move[1] }))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      set((cur) => ({ ...cur, scale: cur.scale + STEP_ZOOM / 2 }))
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      set((cur) => ({ ...cur, scale: cur.scale - STEP_ZOOM / 2 }))
    } else if (e.key === '0') {
      e.preventDefault()
      setDraft(initialTransform())
    }
  }

  const base = coverBase(photo.width, photo.height, vp.w, vp.h)
  const dw = base.w * draft.scale
  const dh = base.h * draft.scale
  const imgStyle = { position: 'absolute', left: vp.w / 2 - dw / 2 + draft.nx * vp.w, top: vp.h / 2 - dh / 2 + draft.ny * vp.h, width: dw, height: dh, maxWidth: 'none', userSelect: 'none' }

  return (
    <div className="space-y-4" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} data-testid="crop-body">
      <div ref={wrapRef} className="flex justify-center">
        {/* the viewport is always LTR: pointer maths and absolute positions must not mirror */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a pan/zoom surface: pointer + keyboard are its whole job */}
        <div
          ref={viewRef}
          dir="ltr"
          role="application"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the surface must be focusable for the arrow / +/- keys
          tabIndex={0}
          aria-label={tl('landing.crop.viewport')}
          aria-describedby="landing-crop-hint"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="landing-grid-overlay relative cursor-grab touch-none select-none overflow-hidden rounded-[22px] bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          style={{ width: vp.w, height: vp.h }}
          data-testid="crop-viewport"
        >
          <img src={photo.url} alt="" draggable={false} style={imgStyle} data-testid="crop-photo" />
          {frameUrl && <img src={frameUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" data-testid="crop-frame" />}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[22px] border-2 border-white/65" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button type="button" aria-label={tl('landing.crop.zoomOut')} onClick={() => set((c) => ({ ...c, scale: c.scale - STEP_ZOOM }))} className="tap-target inline-flex items-center justify-center rounded-md border border-primary/15 bg-primary/5 text-primary transition-colors hover:border-primary hover:bg-primary/10">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step="0.02"
            value={draft.scale}
            onChange={(e) => set((c) => ({ ...c, scale: parseFloat(e.target.value) }))}
            aria-label={tl('landing.crop.zoom')}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
            data-testid="crop-zoom"
          />
          <button type="button" aria-label={tl('landing.crop.zoomIn')} onClick={() => set((c) => ({ ...c, scale: c.scale + STEP_ZOOM }))} className="tap-target inline-flex items-center justify-center rounded-md border border-primary/15 bg-primary/5 text-primary transition-colors hover:border-primary hover:bg-primary/10">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p id="landing-crop-hint" className="text-center text-sm text-muted-foreground">{tl('landing.crop.hint')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setDraft(initialTransform())} data-testid="crop-reset">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {tl('landing.crop.reset')}
        </Button>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" onClick={onClose} data-testid="crop-cancel">{tl('landing.crop.cancel')}</Button>
          <Button variant="secondary" onClick={() => onApply(apply(draft))} data-testid="crop-apply">{tl('landing.crop.apply')}</Button>
        </div>
      </div>
    </div>
  )
}
