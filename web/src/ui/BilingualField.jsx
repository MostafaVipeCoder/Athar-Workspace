import { Field, LABEL_CLASS } from './Field.jsx'
import { cn } from '../lib/cn.js'

/**
 * `xxx_en` + `xxx_ar` pair (design 06 section 6.1 BilingualField, P20). `value` = { en, ar }; `onChange(next)`.
 * Each input carries its own `dir`/`lang` so Arabic types RTL inside an LTR form and vice versa.
 */
export function BilingualField({ label, labels, value, onChange, error, as, required, className, inputClassName, rows }) {
  const v = value ?? { en: '', ar: '' }
  const extra = as === 'textarea' ? { rows: rows ?? 3 } : {}
  return (
    <fieldset className={cn('space-y-2', className)}>
      <legend className={cn(LABEL_CLASS, 'mb-1 font-semibold')}>
        {label}
        {required && <span aria-hidden="true" className="text-destructive-text"> *</span>}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={labels?.en ?? 'English'} as={as} dir="ltr" lang="en" value={v.en ?? ''} onChange={(e) => onChange({ ...v, en: e.target.value })} inputClassName={inputClassName} {...extra} />
        <Field label={labels?.ar ?? 'العربية'} as={as} dir="rtl" lang="ar" value={v.ar ?? ''} onChange={(e) => onChange({ ...v, ar: e.target.value })} inputClassName={inputClassName} {...extra} />
      </div>
      {error && <p className="text-xs text-destructive-text">{error}</p>}
    </fieldset>
  )
}
