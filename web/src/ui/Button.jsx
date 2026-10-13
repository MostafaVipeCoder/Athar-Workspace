import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { buttonClass } from './buttonStyles.js'

/**
 * Primary action control (variants/sizes in buttonStyles.js). `loading` disables double submits and announces busy
 * state; the spinner inherits the text colour (black on the yellow CTA, white on blue).
 */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClass({ variant, size }), 'disabled:pointer-events-none disabled:opacity-50', className)}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
})
