import { forwardRef, useId } from 'react'
import { cn } from '../lib/cn.js'

/**
 * The site's form control (Fluent Forms on /contact/): 7px radius, #fafafa background, 1px #dadbdd border, 11px/15px
 * padding (46px tall), #606266 text, #868e96 placeholder; focus turns the border Athar blue on a white background;
 * invalid = #f56c6c border. Shared by every input/select/textarea in the app (`INPUT_CLASS`) and by `Field`.
 */
export const INPUT_CLASS =
  'min-h-11 w-full rounded-input border border-input bg-input-bg px-[15px] py-2 text-base text-athar-grey-700 placeholder:text-athar-grey-500 ' +
  'transition-colors duration-fast focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive'
/** Native select with the site input look and one inline chevron (`.select-chevron` in styles/index.css, RTL aware). */
export const SELECT_CLASS = INPUT_CLASS + ' select-chevron appearance-none pe-9'
export const LABEL_CLASS = 'block text-sm font-medium text-athar-ink'

/**
 * Labelled input with error text wired through aria-invalid/aria-describedby. The error is an ALERT (announced when it appears). `invalid` + `describedBy` let a parent that shows ONE message
 * for several inputs (BilingualField) mark and describe each of them.
 */
export const Field = forwardRef(function Field({ label, error, hint, invalid, describedBy, className, inputClassName, as: Tag = 'input', children, ...rest }, ref) {
  const id = useId()
  const errId = `${id}-err`
  const hintId = `${id}-hint`
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <Tag
        ref={ref}
        id={id}
        aria-invalid={error || invalid ? true : undefined}
        aria-describedby={[error ? errId : null, hint ? hintId : null, describedBy].filter(Boolean).join(' ') || undefined}
        className={cn(Tag === 'select' ? SELECT_CLASS : INPUT_CLASS, Tag === 'textarea' && 'min-h-[90px] leading-relaxed', (error || invalid) && 'border-destructive', inputClassName)}
        {...rest}
      >
        {children}
      </Tag>
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  )
})
