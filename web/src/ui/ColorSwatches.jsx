import { Check } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { isLightColor } from '../lib/avatar.js'

/** Radio group of colour swatches (profile colour). `value` is a lower-case hex; `options` default to the brand palette. */
export function ColorSwatches({ label, name = 'color', value, onChange, options, className }) {
  return (
    <fieldset className={cn('space-y-2', className)}>
      <legend className="text-sm font-medium text-athar-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((hex) => {
          const selected = value === hex
          return (
            <label key={hex} className="relative cursor-pointer">
              <input type="radio" name={name} value={hex} checked={selected} onChange={() => onChange(hex)} className="peer sr-only" aria-label={hex} />
              <span
                aria-hidden="true"
                style={{ backgroundColor: hex }}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2 border-transparent transition-transform duration-300 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                  selected && 'scale-110 border-foreground',
                )}
              >
                {/* the check mark is black on light swatches (yellow) and white on dark ones */}
                {selected && <Check className={cn('h-5 w-5', isLightColor(hex) ? 'text-black' : 'text-white')} />}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
