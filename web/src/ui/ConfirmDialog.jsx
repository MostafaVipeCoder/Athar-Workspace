import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal.jsx'
import { Button } from './Button.jsx'
import { useLanguage } from '../i18n/LanguageProvider.jsx'

/** Presentational confirm dialog (controlled). */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, destructive = false, loading = false, onConfirm, onCancel }) {
  const { t } = useLanguage()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    />
  )
}

const ConfirmContext = createContext(null)

/** `const confirm = useConfirm(); if (await confirm({title, message, destructive})) ...` replaces window.confirm. */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve
        setRequest(options ?? {})
      }),
    [],
  )

  const settle = useCallback((value) => {
    resolver.current?.(value)
    resolver.current = null
    setRequest(null)
  }, [])

  const value = useMemo(() => confirm, [confirm])
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={request !== null}
        {...(request ?? {})}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
