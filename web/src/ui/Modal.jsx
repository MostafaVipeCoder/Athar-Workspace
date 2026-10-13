import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/cn.js'

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal: role=dialog, aria-modal, labelled by its title, Esc closes, focus is trapped and restored,
 * body scroll is locked. Bottom-sheet on phones, centred card from `sm`. Look: 15px panel radius, 1px border,
 * dropdown shadow, black 70% backdrop (the site's card overlay), Hepta Slab title.
 */
export function Modal({ open, onClose, title, description, children, footer, closeLabel = 'Close', className, dismissible = true }) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  // the latest onClose without re-running the focus effect: a parent that passes a new inline handler on every render (e.g. while the
  // user types in a field inside the dialog) must not move the focus back to the first control on each keystroke
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return undefined
    returnFocus.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    const first = panel?.querySelector('[data-autofocus]') ?? panel?.querySelector(FOCUSABLE) ?? panel
    first?.focus()

    function onKey(e) {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      returnFocus.current?.focus?.()
    }
  }, [open, dismissible])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 animate-in fade-in" aria-hidden="true" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[90dvh] w-full flex-col rounded-t-card border bg-card text-card-foreground shadow-dropdown',
          'animate-in fade-in zoom-in-95 safe-bottom sm:max-w-md sm:rounded-card',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="tap-target -me-2 -mt-2 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t p-4 px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
