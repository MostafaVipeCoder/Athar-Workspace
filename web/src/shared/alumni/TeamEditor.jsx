import { useState } from 'react'
import { Crown, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useAlumniLookups } from '../../data/alumni.js'
import { lookupLabel } from '../../lib/alumni.js'
import { cairoToday } from '../../lib/nationalId.js'
import { phoneForPatch, PHONE_COUNTRIES } from '../../lib/alumniForms.js'
import { diffPatch } from '../../lib/alumni.js'
import { validatePhone } from '../../lib/contact.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { PhoneField } from '../../ui/PhoneField.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { ChipSelect } from './pickers.jsx'
import { useAlumniErrorText } from './useAlumniErrorText.js'
import { useLookupOptions } from './useLookupOptions.js'
import './i18n.js'
import './i18n.company.js'

const MEMBER_KEYS = ['name_ar', 'name_en', 'role', 'self_gender', 'self_birth_date', 'education_status', 'phone']

/**
 * Add / edit a team member. `mode` = 'record' (a co-founder without an account: name, role, gender, date of birth, education, phone; all self-declared, the lead founder
 * cannot enter a national ID for somebody else) or 'me' (my own row: only my role here, everything else is my profile).
 */
function MemberModal({ mode, member, onClose, onSave }) {
  const { t } = useLanguage()
  const errorText = useAlumniErrorText()
  const gender = useLookupOptions('gender', null)
  const education = useLookupOptions('education_status', null)
  const base = { name_ar: member?.name_ar ?? '', name_en: member?.name_en ?? '', role: member?.role ?? '', self_gender: member?.gender ?? '', self_birth_date: member?.birth_date ?? '', education_status: member?.education_status ?? '', phone: member?.phone ?? '' }
  const [values, setValues] = useState(base)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const keys = mode === 'me' ? ['role'] : MEMBER_KEYS
  const patch = diffPatch({ ...base, phone: phoneForPatch(base.phone) }, { ...values, phone: phoneForPatch(values.phone) }, keys)

  async function submit(e) {
    e.preventDefault()
    const found = {}
    if (mode === 'record' && !values.name_ar.trim() && !values.name_en.trim()) found.name_ar = t('alumni.reason.required')
    if (values.role.length > 60) found.role = t('alumni.reason.too_long')
    if (mode === 'record' && values.phone.trim() && !validatePhone(values.phone, PHONE_COUNTRIES).valid) found.phone = t('alumni.reason.bad_value')
    if (mode === 'record' && values.self_birth_date && (values.self_birth_date > cairoToday() || values.self_birth_date < '1900-01-01')) found.self_birth_date = t('alumni.reason.bad_date')
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length) return
    if (member && Object.keys(patch).length === 0) { onClose(); return }
    setBusy(true)
    try {
      await onSave(patch)
      onClose()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'me' ? t('alumni.common.team.editMyRole') : member ? t('alumni.common.team.editMember') : t('alumni.common.team.addMember')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="member-form" loading={busy}>{t('common.save')}</Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} noValidate className="space-y-field-gap">
        {mode === 'record' && (
          <>
            <div className="grid gap-field-gap sm:grid-cols-2">
              <Field label={t('alumni.common.team.nameAr')} dir="rtl" lang="ar" value={values.name_ar} error={errors.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
              <Field label={t('alumni.common.team.nameEn')} dir="ltr" lang="en" value={values.name_en} onChange={(e) => set('name_en', e.target.value)} />
            </div>
          </>
        )}
        <Field label={t('alumni.common.team.role')} value={values.role} error={errors.role} hint={t('alumni.common.team.roleHint')} onChange={(e) => set('role', e.target.value)} />
        {mode === 'record' && (
          <>
            <ChipSelect label={t('alumni.common.team.gender')} options={gender.options} value={values.self_gender} allowClear onChange={(v) => set('self_gender', v)} error={errors.self_gender} hint={t('alumni.common.team.selfHint')} />
            <Field type="date" dir="ltr" label={t('alumni.common.team.birth')} max={cairoToday()} value={values.self_birth_date} error={errors.self_birth_date} onChange={(e) => set('self_birth_date', e.target.value)} />
            <ChipSelect label={t('alumni.common.educationStatus')} options={education.options} value={values.education_status} allowClear onChange={(v) => set('education_status', v)} />
            <PhoneField label={t('alumni.common.phone')} countries={PHONE_COUNTRIES} value={values.phone} onChange={(v) => set('phone', v)} error={errors.phone} />
          </>
        )}
        {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
      </form>
    </Modal>
  )
}

/**
 * The founding team of a company (design 09 3.2 / 8): the founders registered on the platform and the RECORDS the lead founder typed for co-founders without an account.
 *  - a founder edits only his own role and the records without an account; a registered co-founder's details are private to him (read-only row);
 *  - any member can mark the CEO (the primary founder: the "CEO" columns of the owner's sheet come from him);
 *  - the three counts are DERIVED from these rows (team size, female founders, founders below 35): never typed.
 * Callbacks return promises: `onSaveMember(founderId | null, patch)` (null adds a record), `onRemove(founderId)`, `onSetCeo(founderId)`.
 */
export default function TeamEditor({ team = [], counts, ceoFounderId, canEdit = true, onSaveMember, onRemove, onSetCeo }) {
  const { t, tn, pick, lang } = useLanguage()
  const lookups = useAlumniLookups()
  const confirm = useConfirm()
  const [modal, setModal] = useState(null) // { mode, member }
  const [busyId, setBusyId] = useState(null)
  const errorText = useAlumniErrorText()
  const [error, setError] = useState(null)

  async function run(id, fn) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(m) {
    const name = pick(m, 'name')
    const ok = await confirm({ title: t('alumni.common.team.removeTitle', { name }), message: t('alumni.common.team.removeBody'), confirmLabel: t('alumni.common.team.remove'), destructive: true })
    if (ok) await run(m.founder_id, () => onRemove(m.founder_id))
  }

  return (
    <div className="space-y-4" data-testid="team-editor">
      {counts && (
        <dl className="grid grid-cols-3 gap-2 rounded-card border bg-surface/60 p-3 text-center sm:gap-4" data-testid="team-counts">
          {[['team_size', counts.team_size], ['female_founders', counts.female_founders], ['founders_under_35', counts.founders_under_35]].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dd className="text-2xl font-bold">{v ?? '—'}</dd>
              <dt className="text-xs text-muted-foreground">{t(`alumni.common.team.${k}`)}</dt>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-muted-foreground">{t('alumni.common.team.derivedNote')}</p>

      <ul className="space-y-2">
        {team.map((m) => {
          const isCeo = m.founder_id === ceoFounderId
          const record = !m.has_account
          const editable = canEdit && (m.is_me || record)
          const name = pick(m, 'name') || t('alumni.common.notSet')
          const showPersonal = m.is_me || record
          return (
            <li key={m.founder_id} className="space-y-2 rounded-card border bg-card p-3" data-testid="team-member">
              <div className="flex items-start gap-3">
                <Avatar name={name} id={m.founder_id} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    <span className="min-w-0 break-words">{name}</span>
                    {isCeo && <Badge tone="amber"><Crown className="h-3 w-3" aria-hidden="true" />{t('alumni.common.team.ceo')}</Badge>}
                    {m.is_me && <Badge tone="blue">{t('alumni.common.team.you')}</Badge>}
                    {record && <Badge tone="outline">{t('alumni.common.team.record')}</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">{m.role || t('alumni.common.team.noRole')}</p>
                  {showPersonal && (m.gender || m.age !== null && m.age !== undefined) && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {m.gender && <span>{lookupLabel(lookups.data, 'gender', m.gender, lang)}</span>}
                      {m.age !== null && m.age !== undefined && <span>{tn('alumni.idField.years', m.age)}</span>}
                      {m.source && <Badge tone={m.source === 'id' ? 'blue' : 'amber'}>{t(m.source === 'id' ? 'alumni.common.fromId' : 'alumni.common.selfDeclared')}</Badge>}
                    </p>
                  )}
                  {!showPersonal && <p className="text-xs text-muted-foreground">{t('alumni.common.team.privateNote')}</p>}
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {!isCeo && (
                    <Button variant="outline" size="sm" loading={busyId === m.founder_id} onClick={() => run(m.founder_id, () => onSetCeo(m.founder_id))}>
                      <Crown className="h-4 w-4" aria-hidden="true" />
                      {t('alumni.common.team.makeCeo')}
                    </Button>
                  )}
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => setModal({ mode: m.is_me ? 'me' : 'record', member: m })}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      {m.is_me ? t('alumni.common.team.editMyRole') : t('common.edit')}
                    </Button>
                  )}
                  {record && (
                    <Button variant="ghost" size="sm" disabled={busyId === m.founder_id} onClick={() => remove(m)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('alumni.common.team.remove')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}
      {canEdit && (
        <Button variant="outline" onClick={() => setModal({ mode: 'record', member: null })}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t('alumni.common.team.addMember')}
        </Button>
      )}
      {modal && (
        <MemberModal
          key={modal.member?.founder_id ?? 'new'}
          mode={modal.mode}
          member={modal.member}
          onClose={() => setModal(null)}
          onSave={(patch) => onSaveMember(modal.member?.founder_id ?? null, patch)}
        />
      )}
    </div>
  )
}
