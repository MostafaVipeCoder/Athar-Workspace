import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Class-name helper: conditional classes + Tailwind conflict resolution. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
