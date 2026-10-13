import { useState } from 'react'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { STAFF_ROLES } from '../../../lib/constants.js'

/** Checkbox list of the three staff roles. `founder` (if present) is untouched by the RPC. */
export function RoleChecklist({ value, onChange, name = 'roles' }) {
  const { t } = useLanguage()
  const toggle = (r) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])
  return (
    <div className="space-y-2">
      {STAFF_ROLES.map((r) => (
        <label key={r} className="flex flex-wrap items-center gap-x-2 rounded-md border p-2 text-sm hover:bg-surface">
          <input type="checkbox" name={name} value={r} checked={value.includes(r)} onChange={() => toggle(r)} />
          <span className="font-medium">{t(`role.${r}`)}</span>
          <span className="block w-full ps-6 text-xs text-muted-foreground">{t(`role.hint.${r}`)}</span>
        </label>
      ))}
    </div>
  )
}

export default function RolesModal({ person, onClose, onSave }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [roles, setRoles] = useState(() => person.roles.filter((r) => STAFF_ROLES.includes(r)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isFounder = person.roles.includes('founder')

  async function save() {
    if (roles.length === 0) {
      toast.warning(t('staff.rolesRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(roles)
      toast.success(t('staff.rolesSaved'))
      onClose()
    } catch (err) {
      // the server message is the authority (m25 token -> errors.staffFounderExclusive; last super_admin guard -> 23514)
      const message =
        err?.messageKey === 'errors.staffFounderExclusive'
          ? t(err.messageKey)
          : err?.code === 'validation' && err?.cause?.message?.includes('super_admin')
            ? t('staff.lastAdmin')
            : t(err?.messageKey ?? 'errors.unknown')
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('staff.editRoles')}
      description={person.full_name || person.email}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={busy}>{t('common.save')}</Button>
        </>
      }
    >
      {isFounder && (
        <p className="mb-3 rounded-input border border-accent bg-accent/15 p-2 text-xs text-foreground" data-testid="founder-exclusive-hint">
          {t('staff.founderExclusiveHint')}
        </p>
      )}
      <RoleChecklist value={roles} onChange={setRoles} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="roles-error">
          {error}
        </p>
      )}
    </Modal>
  )
}
