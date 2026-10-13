import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '../lib/cn.js'

// dev-only: a storage URL that still points at a PNG/JPEG/GIF means an image was stored before the universal-WebP pipeline (db/scripts/convert-images.mjs)
const warnedRaster = new Set()
function warnRaster(url) {
  if (!import.meta.env?.DEV || !url || warnedRaster.has(url)) return
  if (/\/storage\/v1\/object\/(?:public|sign)\/[^?]+\.(?:png|jpe?g|gif)(?:\?|$)/i.test(url)) {
    warnedRaster.add(url)
    console.warn(`[image] raster file in storage, not WebP: ${url}`)
  }
}

/**
 * Image with lazy loading, reserved aspect ratio (no layout shift) and an optional thumbnail variant.
 * - `thumb`: small URL shown immediately (blurred) while the full `src` loads; also used alone when `variant="thumb"`.
 * - `variant`: 'full' (default) | 'thumb' (loads only the thumbnail, for lists/cards).
 * - `eager`: skip lazy loading; `priority`: eager + `fetchpriority="high"` for THE image above the fold (a cover / hero), never for lists.
 * - Every image, the blurred thumbnail PREVIEW included, is `loading="lazy"` unless `eager` / `priority` (a 141-card list must not request 141 thumbnails at load).
 * - Every image: `decoding="async"`, a reserved `aspect` box (no layout shift), and the WebP thumbnail `_t` in lists / cards (data/storage.publicThumbUrl).
 * - `rounded`: 15px card radius (site content images); `shadow`: the site's image shadow for standalone photos;
 * - `overlay`: 'card' (black 0.7) | 'hero' (black 0.8) for text-over-image blocks; put the text in `children`.
 * Storage URL building (which suffix is a thumbnail) belongs to a data/storage helper, not here.
 */
export function Img({ src, thumb, alt = '', aspect = '16 / 9', variant = 'full', eager = false, priority = false, fit = 'cover', rounded = false, shadow = false, overlay = null, className, imgClassName, children, onError, ...rest }) {
  const target = variant === 'thumb' ? thumb || src : src
  warnRaster(target)
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
            <img src={thumb} alt="" aria-hidden="true" loading={eager || priority ? 'eager' : 'lazy'} decoding="async" className={cn('absolute inset-0 h-full w-full scale-105 blur-sm', fit === 'cover' ? 'object-cover' : 'object-contain')} />
          )}
          <img
            src={target}
            alt={alt}
            loading={eager || priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : undefined}
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
