import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '../lib/cn.js'

/**
 * Image with lazy loading, reserved aspect ratio (no layout shift) and an optional thumbnail variant.
 * - `thumb`: small URL shown immediately (blurred) while the full `src` loads; also used alone when `variant="thumb"`.
 * - `variant`: 'full' (default) | 'thumb' (loads only the thumbnail, for lists/cards).
 * - `eager`: skip lazy loading (above-the-fold hero images).
 * - `rounded`: 15px card radius (site content images); `shadow`: the site's image shadow for standalone photos;
 * - `overlay`: 'card' (black 0.7) | 'hero' (black 0.8) for text-over-image blocks; put the text in `children`.
 * Storage URL building (which suffix is a thumbnail) belongs to a data/storage helper, not here.
 */
export function Img({ src, thumb, alt = '', aspect = '16 / 9', variant = 'full', eager = false, fit = 'cover', rounded = false, shadow = false, overlay = null, className, imgClassName, children, onError, ...rest }) {
  const target = variant === 'thumb' ? thumb || src : src
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // reset state when the URL changes (derive-during-render pattern)
  const [seen, setSeen] = useState(target)
  if (seen !== target) {
    setSeen(target)
    setFailed(false)
    setLoaded(false)
  }

  const showThumbFirst = variant === 'full' && thumb && thumb !== src && !loaded

  return (
    <div
      className={cn('relative overflow-hidden bg-surface', rounded && 'rounded-card', shadow && 'shadow-image', overlay === 'card' && 'overlay-card', overlay === 'hero' && 'overlay-hero', className)}
      style={{ aspectRatio: aspect }}
    >
      {!target || failed ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" role={alt ? 'img' : undefined} aria-label={alt || undefined}>
          <ImageOff className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : (
        <>
          {showThumbFirst && (
            <img src={thumb} alt="" aria-hidden="true" decoding="async" className={cn('absolute inset-0 h-full w-full scale-105 blur-sm', fit === 'cover' ? 'object-cover' : 'object-contain')} />
          )}
          <img
            src={target}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={(e) => {
              setFailed(true)
              onError?.(e)
            }}
            className={cn(
              'absolute inset-0 h-full w-full transition-opacity duration-300',
              fit === 'cover' ? 'object-cover' : 'object-contain',
              loaded || variant === 'thumb' ? 'opacity-100' : 'opacity-0',
              imgClassName,
            )}
            {...rest}
          />
        </>
      )}
      {children && <div className="absolute inset-0 z-10 flex flex-col justify-end">{children}</div>}
    </div>
  )
}
