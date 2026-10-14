import { useContext } from 'react'
import { UNSAFE_DataRouterContext, useBeforeUnload, useBlocker } from 'react-router-dom'
import { ConfirmDialog } from '../../ui/ConfirmDialog.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import './i18n.js'

/** The in-app part: only mounted under a data router (`useBlocker` does not exist under a plain <MemoryRouter>, which the component tests use). */
function RouteBlocker({ when }) {
  const { t } = useLanguage()
  const blocker = useBlocker(when)
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={t('alumni.common.leaveTitle')}
      message={t('alumni.common.leaveBody')}
      confirmLabel={t('alumni.common.leave')}
      cancelLabel={t('alumni.common.stay')}
      destructive
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  )
}

/**
 * Warns before unsaved edits are lost: the browser's own prompt on a reload / tab close, and a ConfirmDialog (never window.confirm) on an in-app navigation
 * (the bottom tabs, a link, the back button). Renders nothing while `when` is false.
 */
export default function UnsavedGuard({ when }) {
  const inDataRouter = Boolean(useContext(UNSAFE_DataRouterContext))
  useBeforeUnload((e) => {
    if (when) e.preventDefault()
  })
  return inDataRouter ? <RouteBlocker when={when} /> : null
}
