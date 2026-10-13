import { useId, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * Long text clamped to `lines` with a "see more / see less" toggle (design 06 section 6.1 ExpandableText; replaces the
 * per-card read-more state of ExpertCard/CompanyCard). Text under ~`threshold` characters is shown in full with no toggle.
 * `forceExpanded` (single-item pages) shows everything. Labels are passed in (ui/ stays dictionary-free).
 */
export function ExpandableText({ text, lines = 4, threshold = 180, forceExpanded = false, labels = {}, className, as: Tag = 'p' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const value = String(text ?? '').trim()
  if (!value) return null
  const needsToggle = !forceExpanded && value.length > threshold
  const expanded = forceExpanded || open || !needsToggle
  return (
    <div className={cn('space-y-1', className)}>
      <Tag id={id} dir="auto" className={cn('whitespace-pre-line font-questrial text-sm leading-relaxed', !expanded && 'overflow-hidden')} style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' }}>
        {value}
      </Tag>
      {needsToggle && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="min-h-9 text-sm font-semibold text-primary underline-offset-4 hover:underline">
          {open ? labels.less ?? 'See less' : labels.more ?? 'See more'}
        </button>
      )}
    </div>
  )
}
