import { useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { previewNationalId, useAlumniLookups } from '../../data/alumni.js'
import { digitsOnly, lookupLabel } from '../../lib/alumni.js'
import { cairoToday, nationalIdProgress, NATIONAL_ID_LENGTH } from '../../lib/nationalId.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { INPUT_CLASS, LABEL_CLASS, Field } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { ChipSelect } from './pickers.jsx'
import { DerivedValue } from './blocks.jsx'
import { useLookupOptions } from './useLookupOptions.js'
import './i18n.js'
import './i18n.id.js'

// the number is masked with the browser's own text-security (a type="password" input would offer to save / autofill the account password here)
const MASKED = '[-webkit-text-security:disc]'
const day = (iso) => (iso ? `${String(iso).slice(0, 10)}T12:00:00` : null) // local noon: a date-only string would shift a day west of UTC

/**
 * THE ONE place a national ID is typed (design 09 5.6 / 14.2, decision 19).
 *
 *  - the field is masked by default with a reveal toggle; it only accepts digits (`digitsOnly`, Arabic-Indic digits included);
 *  - INSTANT feedback with a clear reason per failure (lib/nationalId.js, the same rules as the database): century at digit 1, the date at digit 7, the governorate
 *    at digit 9, the length at 15 digits;
 *  - at 14 valid digits the SERVER derives the values shown in the read-only card (`preview_national_id`: the same SQL as the database). The client never derives
 *    a date, an age, a gender or a governorate itself;
 *  - the typed date of birth / gender exist ONLY while there is no ID, flagged "self-declared" (the ID always wins and erases them on save);
 *  - the number is never put in a URL, a query key, a log line or a toast: it lives in the form state and is sent in the body of a POST on Save.
 *
 * Controlled: `value` = the digits typed ('' = none; the saved number of the owner when untouched), `onChange(digits)`. `identity` = the founder block's `identity`
 * (own payload: `national_id` present; manager payload: only `id_masked`, with `onReveal` for the audited reveal). `selfBirthDate` / `selfGender` + `onSelfChange(key, v)`.
 * (The parent validates the whole form with lib/alumniForms `validateFounderForm`, the same instant rules, so it needs no callback from here.)
 * `serverError` = an i18n key of a refusal already mapped to this field, `conflict` = the number belongs to someone else, `replaced` = the notice of the last save.
 */
export default function NationalIdField({ identity, value, onChange, selfBirthDate = '', selfGender = '', onSelfChange, serverError, conflict = false, replaced = [], onReveal, disabled }) {
  const { t, tn, lang, formatDate } = useLanguage()
  const id = useId()
  const lookups = useAlumniLookups()
  const genderOptions = useLookupOptions('gender', null)
  const [show, setShow] = useState(false)
  const [replacing, setReplacing] = useState(false) // the person chose to change / remove the saved number (manager mode: also what ends the saved view)
  const inputRef = useRef(null)
  const [preview, setPreview] = useState({ for: null, status: 'idle', data: null, reason: null })

  const governorateCodes = (lookups.data?.governorates ?? []).map((g) => Number(g.code))
  const typed = digitsOnly(value, NATIONAL_ID_LENGTH + 1)
  const progress = nationalIdProgress(typed, { governorateCodes: governorateCodes.length ? governorateCodes : null })
  const hasSaved = Boolean(identity?.has_national_id)
  const ownSaved = identity?.national_id ?? null
  const viewingSaved = hasSaved && (ownSaved !== null ? typed === digitsOnly(ownSaved) : !replacing && typed === '')

  // the server derives the card for a client-valid, complete number; an answer is only used for the digits it was asked about (no network call per keystroke)
  useEffect(() => {
    if (viewingSaved || !progress.complete) return undefined
    let alive = true
    previewNationalId(typed)
      .then((r) => alive && setPreview(r?.valid ? { for: typed, status: 'ok', data: r, reason: null } : { for: typed, status: 'invalid', data: null, reason: r?.reason ?? 'digits' }))
      .catch(() => alive && setPreview({ for: typed, status: 'error', data: null, reason: null }))
    return () => { alive = false }
  }, [typed, progress.complete, viewingSaved])

  const current = preview.for === typed ? preview : { for: typed, status: progress.complete && !viewingSaved ? 'loading' : 'idle', data: null, reason: null }
  const problem = progress.problem ?? (current.status === 'invalid' ? current.reason : null)

  // "Change number" lands in the empty field
  useEffect(() => { if (replacing && !viewingSaved) inputRef.current?.focus() }, [replacing, viewingSaved])

  const errorText = conflict ? t('alumni.err.nidConflict') : problem ? t(`alumni.err.nid.${problem}`) : serverError ?? null
  const errId = `${id}-err`
  const hintId = `${id}-hint`

  // what the read-only card shows: the saved (server) values, or the server's answer for the typed number
  const derived = viewingSaved
    ? identity?.derived && identity.source === 'id' ? { birth_date: identity.derived.birth_date, age: identity.derived.age, gender: identity.derived.gender, governorateLabel: lookupLabel(lookups.data, 'governorate', identity.derived.governorate, lang) } : null
    : current.status === 'ok' ? { birth_date: current.data.birth_date, age: current.data.age, gender: current.data.gender, governorateLabel: current.data.governorate?.[`name_${lang}`] ?? '' } : null

  function changeNumber() {
    setReplacing(true)
    onChange('')
  }

  const shownSaved = show ? ownSaved : identity?.id_masked

  return (
    <div className="space-y-4" data-testid="national-id-field">
      {viewingSaved ? (
        <div className="space-y-2">
          <span className={LABEL_CLASS}>{t('alumni.idField.label')}</span>
          <div className="flex flex-wrap items-center gap-2 rounded-input border border-input bg-input-bg px-3 py-2">
            <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <span dir="ltr" className="min-w-0 flex-1 font-mono text-base tracking-wider" data-testid="national-id-saved">{shownSaved}</span>
            {(ownSaved !== null || onReveal) && (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={show}
                onClick={() => (ownSaved !== null ? setShow((s) => !s) : onReveal?.())}
                aria-label={show ? t('alumni.idField.hide') : t('alumni.idField.show')}
              >
                {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                {show ? t('alumni.idField.hide') : t('alumni.idField.show')}
              </Button>
            )}
          </div>
          {!disabled && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={changeNumber}>{t('alumni.idField.change')}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setReplacing(true); onChange('') }}>{t('alumni.idField.remove')}</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('alumni.idField.privacy')}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={id} className={LABEL_CLASS}>{t('alumni.idField.label')}</label>
          <div className="relative" dir="ltr">
            <input
              id={id}
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              name="alumni-national-id"
              data-1p-ignore="true"
              data-lpignore="true"
              disabled={disabled}
              value={typed}
              aria-invalid={errorText ? true : undefined}
              aria-describedby={[errorText ? errId : null, hintId].filter(Boolean).join(' ')}
              onChange={(e) => onChange(digitsOnly(e.target.value, NATIONAL_ID_LENGTH + 1))}
              className={cn(INPUT_CLASS, 'pe-12 font-mono tracking-wider', !show && MASKED, errorText && 'border-destructive')}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-pressed={show}
              aria-label={show ? t('alumni.idField.hide') : t('alumni.idField.show')}
              className="absolute inset-y-0 end-0 flex min-w-11 items-center justify-center rounded-e-input text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {show ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
          <p id={hintId} className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span>{t('alumni.idField.hint')}</span>
            {typed !== '' && typed.length < NATIONAL_ID_LENGTH && !problem && <span aria-live="polite">{t('alumni.idField.progress', { count: typed.length })}</span>}
            {current.status === 'loading' && <span aria-live="polite">{t('alumni.idField.checking')}</span>}
          </p>
          {errorText && <p id={errId} role="alert" className="text-xs text-destructive-text">{errorText}</p>}
          {current.status === 'error' && !errorText && <p className="text-xs text-muted-foreground">{t('alumni.idField.previewFailed')}</p>}
          {hasSaved && typed === '' && ownSaved !== null && (
            <p className="text-xs text-muted-foreground">{t('alumni.idField.removeNote')}</p>
          )}
        </div>
      )}

      {derived && (
        <div className="space-y-3 rounded-card border border-primary/30 bg-primary/5 p-4" role="status" aria-live="polite" data-testid="national-id-derived">
          <div>
            <h3 className="text-base font-bold">{t('alumni.idField.derivedTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('alumni.idField.derivedHint')}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <DerivedValue origin="id" label={t('alumni.idField.birth')} value={derived.birth_date ? formatDate(day(derived.birth_date), { dateStyle: 'long' }) : ''} />
            <DerivedValue origin="id" label={t('alumni.idField.age')} value={derived.age !== null && derived.age !== undefined ? tn('alumni.idField.years', derived.age) : ''} />
            <DerivedValue origin="id" label={t('alumni.idField.gender')} value={derived.gender ? lookupLabel(lookups.data, 'gender', derived.gender, lang) : ''} />
            <DerivedValue origin="id" label={t('alumni.idField.from')} value={derived.governorateLabel} />
          </dl>
        </div>
      )}

      {replaced?.length > 0 && (
        <div role="status" className="space-y-1 rounded-card border border-accent bg-accent/20 p-3 text-sm" data-testid="national-id-replaced">
          <p className="font-semibold">{t('alumni.idField.replacedTitle')}</p>
          <ul className="list-disc ps-5">
            {replaced.map((r) => (
              <li key={r.field}>
                {r.field === 'birth_date'
                  ? t('alumni.idField.replacedBirth', { typed: formatDate(day(r.typed), { dateStyle: 'long' }), fromId: formatDate(day(r.from_id), { dateStyle: 'long' }) })
                  : t('alumni.idField.replacedGender', { typed: lookupLabel(lookups.data, 'gender', r.typed, lang), fromId: lookupLabel(lookups.data, 'gender', r.from_id, lang) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* the self-declared fallback: ONLY while there is no ID (typed or saved) */}
      {!viewingSaved && typed === '' && (
        <div className="space-y-3 rounded-card border border-dashed border-input p-4" data-testid="national-id-self">
          <div>
            <h3 className="text-base font-bold">{t('alumni.idField.selfTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('alumni.idField.selfHint')}</p>
          </div>
          <Field
            type="date"
            label={t('alumni.idField.selfBirth')}
            dir="ltr"
            max={cairoToday()}
            value={selfBirthDate}
            disabled={disabled}
            onChange={(e) => onSelfChange?.('self_birth_date', e.target.value)}
            hint={t('alumni.idField.selfFlag')}
          />
          <ChipSelect
            label={t('alumni.idField.selfGender')}
            options={genderOptions.options}
            value={selfGender}
            allowClear
            disabled={disabled}
            onChange={(v) => onSelfChange?.('self_gender', v)}
          />
          {identity?.source === 'self' && identity?.derived?.age !== null && identity?.derived?.age !== undefined && selfBirthDate === (identity?.self_birth_date ?? '') && (
            <dl><DerivedValue origin="self" label={t('alumni.idField.age')} value={tn('alumni.idField.years', identity.derived.age)} /></dl>
          )}
        </div>
      )}
    </div>
  )
}
