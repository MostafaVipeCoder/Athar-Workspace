import { useId, useMemo, useState } from 'react'
import { cn } from '../lib/cn.js'
import { SUPPORTED_COUNTRIES, cleanPhoneInput } from '../lib/contact.js'
import { INPUT_CLASS, LABEL_CLASS, SELECT_CLASS } from './Field.jsx'

/**
 * Phone input with a country (dial code) picker. Generic: `countries` = ISO codes offered (subset of
 * lib/contact SUPPORTED_COUNTRIES); `value` is the raw string handed to validatePhone ("+20 1012345678" or an
 * international number typed by the user); `onChange(raw)`. Validation itself stays in lib/contact (E.164).
 */
export function PhoneField({ label, value = '', onChange, countries, error, hint, required, lang = 'en', disabled, className, inputProps = {} }) {
  const id = useId()
  const errId = `${id}-err`
  const list = useMemo(() => {
    const allowed = Array.isArray(countries) && countries.length ? SUPPORTED_COUNTRIES.filter((c) => countries.includes(c.code)) : SUPPORTED_COUNTRIES
    return allowed.length ? allowed : SUPPORTED_COUNTRIES
  }, [countries])
  const initial = useMemo(() => {
    const s = cleanPhoneInput(value)
    const found = list.find((c) => s.startsWith(c.dialCode))
    if (found) return { code: found.code, number: s.slice(found.dialCode.length) }
    return { code: list[0].code, number: String(value ?? '') }
  }, [list, value])
  const [code, setCode] = useState(initial.code)
  const [number, setNumber] = useState(initial.number)

  const emit = (nextCode, nextNumber) => {
    const dial = list.find((c) => c.code === nextCode)?.dialCode ?? list[0].dialCode
    const n = String(nextNumber ?? '').trim()
    if (!n) onChange('')
    else if (/^(\+|00)/.test(n)) onChange(n)
    else onChange(`${dial} ${n}`)
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required && <span aria-hidden="true" className="text-destructive-text"> *</span>}
      </label>
      <div className="flex gap-2" dir="ltr">
        <select
          aria-label={lang === 'ar' ? 'الدولة' : 'Country'}
          value={code}
          disabled={disabled}
          onChange={(e) => { setCode(e.target.value); emit(e.target.value, number) }}
          className={cn(SELECT_CLASS, 'w-auto shrink-0 ps-3 text-sm [background-position:right_8px_center]')}
        >
          {list.map((c) => <option key={c.code} value={c.code}>{c.name[lang] ?? c.name.en} ({c.dialCode})</option>)}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          dir="ltr"
          value={number}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => { setNumber(e.target.value); emit(code, e.target.value) }}
          className={cn(INPUT_CLASS, 'min-w-0', error && 'border-destructive')}
          {...inputProps}
        />
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={errId} className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}
