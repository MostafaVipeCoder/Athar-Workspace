import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Img } from './Img.jsx'
import { Button } from './Button.jsx'
import { cn } from '../lib/cn.js'
import { IMAGE } from '../lib/constants.js'
import { validateImageFile } from '../lib/image.js'

/**
 * Image picker with preview (design 06 section 6.1 ImageField, P18). Generic: it does NOT upload. The page passes
 * `onFile(file)` (returns a promise that resolves to the stored path) and the current `src`/`thumb` URLs.
 * States: idle -> uploading -> done/error. The file is validated here (type/size) before the callback.
 */
export function ImageField({ label, src, thumb, onFile, onClear, disabled, aspect = '16 / 9', className, labels = {}, errorText }) {
  const id = useId()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const previewUrl = useRef(null)

  // the object URL stays alive while it is displayed; it is revoked when replaced or on unmount
  const swapPreview = useCallback((url) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = url
    setPreview(url)
  }, [])
  useEffect(() => () => swapPreview(null), [swapPreview])

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) {
      setError(errorText?.(problem) ?? problem)
      return
    }
    setError(null)
    swapPreview(URL.createObjectURL(file))
    setBusy(true)
    try {
      await onFile(file)
    } catch (err) {
      swapPreview(null)
      setError(errorText?.('upload', err) ?? err?.message ?? 'upload')
    } finally {
      setBusy(false)
    }
  }

  const shown = preview ?? src
  return (
    <div className={cn('space-y-2', className)}>
      <span className="block text-sm font-medium text-athar-ink" id={`${id}-label`}>{label}</span>
      <div className="overflow-hidden rounded-card border">
        <Img src={shown} thumb={preview ? undefined : thumb} alt="" aspect={aspect} eager />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} id={id} type="file" accept={IMAGE.accept.join(',')} className="sr-only" onChange={pick} disabled={disabled || busy} aria-labelledby={`${id}-label`} />
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {shown ? labels.replace ?? 'Replace' : labels.choose ?? 'Choose image'}
        </Button>
        {shown && onClear && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => { swapPreview(null); onClear() }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {labels.remove ?? 'Remove'}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{labels.hint}</span>
      </div>
      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}
