import { useId } from 'react'
import { useAlumniLookups } from '../../data/alumni.js'
import { subsectorOptions, lookupOptions } from '../../lib/alumni.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Field, LABEL_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import './i18n.js'

/**
 * Single / multiple choice as chips (design 09 14.2): `options` = `[{ value, label }]` (lookupOptions), `aria-pressed` on every chip, 44 px targets, wraps in RTL.
 * Single: `value` is the chosen value (or ''), `onChange(value)`; `allowClear` lets a second tap on the chosen chip clear it. Multiple: `value` is an array.
 */
export function ChipSelect({ label, options, value, onChange, multiple = false, allowClear = false, error, hint, disabled, className, required }) {
  const id = useId()
  // multi mode compares as STRINGS: a list of ids / codes may hold numbers on one side and strings on the other (a URL, a form field)
  const chosen = (v) => (multiple ? (value ?? []).some((x) => String(x) === String(v)) : value === v)
  function toggle(v) {
    if (disabled) return
    if (multiple) onChange(chosen(v) ? (value ?? []).filter((x) => String(x) !== String(v)) : [...(value ?? []), v])
    else onChange(chosen(v) && allowClear ? '' : v)
  }
  return (
    <div className={cn('space-y-1.5', className)} role="group" aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-err` : undefined}>
      <span id={`${id}-label`} className={LABEL_CLASS}>
        {label}
        {required && <span aria-hidden="true" className="text-destructive-text"> *</span>}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={chosen(o.value)}
            disabled={disabled}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
              chosen(o.value) ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-background text-foreground hover:border-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}

/** A vocabulary field as a native select (long lists: stage, sector, governorate). Labels come from the lookups payload in the UI language; `kind` as in lib/alumni `lookupOptions`. */
export function LookupSelect({ kind, label, value, onChange, error, hint, disabled, className, required, placeholder, includeAbroad = false, number = false }) {
  const { t, lang } = useLanguage()
  const q = useAlumniLookups()
  const current = value === '' || value === null || value === undefined ? null : value
  const options = lookupOptions(q.data, kind, lang, { current, includeAbroad })
  // a stored value that is not (any longer) in the list is still shown, so saving does not silently drop it
  const known = options.some((o) => String(o.value) === String(current))
  return (
    <Field
      as="select"
      label={required ? <>{label}<span aria-hidden="true" className="text-destructive-text"> *</span></> : label}
      className={className}
      value={current ?? ''}
      disabled={disabled || q.isPending}
      error={error}
      hint={hint}
      onChange={(e) => onChange(e.target.value === '' ? '' : number ? Number(e.target.value) : e.target.value)}
    >
      <option value="">{q.isPending ? t('common.loading') : placeholder ?? t('alumni.common.select')}</option>
      {current !== null && !known && !q.isPending && <option value={current}>{String(current)}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Field>
  )
}

/** The 27 company locations (never 88 = born abroad). `value` = the numeric code or ''. */
export function GovernoratePicker({ label, value, onChange, error, hint, disabled, className, required }) {
  return <LookupSelect kind="governorate" number label={label} value={value} onChange={onChange} error={error} hint={hint} disabled={disabled} className={className} required={required} />
}

/** Sector, then the sub sector of THAT sector; changing the sector clears the sub sector. `onChange({ sector, subsector })`. */
export function SectorPicker({ sector, subsector, onChange, errors = {}, disabled, className, labels }) {
  const { t, lang } = useLanguage()
  const q = useAlumniLookups()
  const sectors = lookupOptions(q.data, 'sector', lang, { current: sector || null })
  const subs = subsectorOptions(q.data, sector, lang, { current: subsector || null })
  return (
    <div className={cn('grid gap-field-gap sm:grid-cols-2', className)}>
      <Field
        as="select"
        label={labels?.sector ?? t('alumni.common.sector')}
        value={sector ?? ''}
        disabled={disabled || q.isPending}
        error={errors.sector}
        onChange={(e) => onChange({ sector: e.target.value, subsector: '' })}
      >
        <option value="">{q.isPending ? t('common.loading') : t('alumni.common.select')}</option>
        {sector && !sectors.some((o) => o.value === sector) && !q.isPending && <option value={sector}>{sector}</option>}
        {sectors.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Field>
      <Field
        as="select"
        label={labels?.subsector ?? t('alumni.common.subsector')}
        value={subsector ?? ''}
        disabled={disabled || q.isPending || !sector}
        error={errors.subsector}
        hint={!sector ? t('alumni.common.subsectorNeedsSector') : undefined}
        onChange={(e) => onChange({ sector, subsector: e.target.value })}
      >
        <option value="">{t('alumni.common.select')}</option>
        {subsector && !subs.some((o) => o.value === subsector) && <option value={subsector}>{subsector}</option>}
        {subs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Field>
    </div>
  )
}
