import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useLanguage } from '../i18n/LanguageProvider.jsx'

const ToastContext = createContext(null)

/** White card (15px radius, dropdown shadow) with a 4px colour bar on the start edge and a coloured icon per tone. */
const TONES = {
  success: { icon: CheckCircle2, bar: 'border-s-success', iconCls: 'text-success' },
  error: { icon: XCircle, bar: 'border-s-destructive', iconCls: 'text-destructive-text' },
  // a real 'warning' tone (the old app rendered warnings red): yellow bar, black icon
  warning: { icon: AlertTriangle, bar: 'border-s-accent', iconCls: 'text-foreground' },
  info: { icon: Info, bar: 'border-s-primary', iconCls: 'text-primary' },
}

/**
 * Stack of toasts in an aria-live region. Replaces every alert() (design 06 section 6.1).
 * WCAG 2.2.1 (timing adjustable): a toast does not disappear under the pointer or the keyboard focus - the countdown PAUSES while it is
 * hovered or holds focus (the Undo button of a destructive action must stay reachable) and resumes with at least one second left.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const idRef = useRef(0)
  const { t } = useLanguage()

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id)?.handle)
    timers.current.delete(id)
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  const pause = useCallback((id) => {
    const tm = timers.current.get(id)
    if (!tm || !tm.handle) return
    clearTimeout(tm.handle)
    tm.handle = null
    tm.remaining = Math.max(1000, tm.remaining - (Date.now() - tm.started))
  }, [])
  const resume = useCallback(
    (id) => {
      const tm = timers.current.get(id)
      if (!tm || tm.handle) return
      tm.started = Date.now()
      tm.handle = setTimeout(() => dismiss(id), tm.remaining)
    },
    [dismiss],
  )

  const push = useCallback(
    (message, { tone = 'info', duration = 5000, action = null } = {}) => {
      const id = (idRef.current += 1)
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }])
      if (duration > 0) timers.current.set(id, { handle: setTimeout(() => dismiss(id), duration), started: Date.now(), remaining: duration })
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((tm) => clearTimeout(tm.handle))
  }, [])

  const api = useMemo(
    () => ({
      toast: push,
      success: (m, o) => push(m, { ...o, tone: 'success' }),
      error: (m, o) => push(m, { ...o, tone: 'error', duration: o?.duration ?? 8000 }),
      warning: (m, o) => push(m, { ...o, tone: 'warning' }),
      info: (m, o) => push(m, { ...o, tone: 'info' }),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 safe-bottom sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map(({ id, message, tone, action }) => {
          const { icon: Icon, bar, iconCls } = TONES[tone] ?? TONES.info
          return (
            <div
              key={id}
              role={tone === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => pause(id)}
              onMouseLeave={() => resume(id)}
              onFocus={() => pause(id)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) resume(id) }}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-s-4 bg-card p-3 pe-2 text-sm text-card-foreground shadow-dropdown animate-in fade-in slide-in-from-bottom-2',
                bar,
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconCls)} aria-hidden="true" />
              <p className="min-w-0 flex-1 break-words">{message}</p>
              {action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(id)
                    action.onClick?.()
                  }}
                  className="shrink-0 rounded-sm bg-cta px-2 py-1 text-xs font-bold text-cta-foreground transition hover:brightness-95"
                >
                  {action.label}
                </button>
              )}
              <button type="button" onClick={() => dismiss(id)} aria-label={t('common.close')} className="-m-1 rounded-sm p-1 text-muted-foreground hover:bg-surface hover:text-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
