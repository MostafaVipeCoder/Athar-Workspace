import { Field, SELECT_CLASS, LABEL_CLASS } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { cn } from '../../lib/cn.js'

/**
 * The editor of ONE card (design 01 section 3.9, decision 01-13): cover image (uploaded immediately, WebP + thumb), chip label, title,
 * text (shown clamped with "See more"), the button (label, target, notification dot) and the share target. A target is either a typed web
 * address or a page of this project reached through the `links` input (a Form, Booking, Agenda... the DB resolves its public link, nothing
 * is copied); the share target defaults to the button's target.
 * Props: card, onChange(patch), errors, linkOptions [{ nodeId, label }], onCover(file) -> path, onClearCover().
 */
export default function CardEditor({ card, onChange, errors = {}, linkOptions, onCover, onClearCover }) {
  const { t } = useLanguage()
  const err = (k) => (errors[`${card.id}.${k}`] ? t(`landing.edit.err.${errors[`${card.id}.${k}`]}`) : undefined)
  const ctaMode = card.ctaNodeId ? 'node' : 'url'
  const shareMode = card.shareNodeId ? 'node' : card.shareUrl ? 'url' : 'same'

  return (
    <div className="space-y-5" data-testid="card-editor">
      <ImageField
        label={t('landing.card.cover')}
        src={card.cover ? publicImageUrl(card.cover) : ''}
        thumb={card.cover ? publicThumbUrl(card.cover) : ''}
        aspect="16 / 10"
        onFile={async (file) => { const path = await onCover(file); onChange({ cover: path }) }}
        onClear={onClearCover}
        labels={{ choose: t('landing.card.coverChoose'), replace: t('landing.card.coverReplace'), remove: t('landing.card.coverRemove'), hint: t('landing.card.coverHint') }}
        errorText={(code) => t(code === 'upload' ? 'landing.edit.err.upload' : `errors.${code}`)}
      />

      <BilingualField label={t('landing.card.chip')} value={card.chip} onChange={(chip) => onChange({ chip })} />
      <BilingualField label={t('landing.card.title')} value={card.title} onChange={(title) => onChange({ title })} error={err('title')} />
      <BilingualField label={t('landing.card.body')} value={card.body} onChange={(body) => onChange({ body })} as="textarea" rows={4} error={err('body')} />
      <div className="max-w-xs space-y-1.5">
        <label htmlFor={`${card.id}-lines`} className={LABEL_CLASS}>{t('landing.card.lines')}</label>
        <select id={`${card.id}-lines`} className={SELECT_CLASS} value={card.seeMoreLines ?? ''} onChange={(e) => onChange({ seeMoreLines: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('landing.card.linesAuto')}</option>
          {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('landing.card.linesN', { n })}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{t('landing.card.linesHint')}</p>
      </div>

      <fieldset className="space-y-3 rounded-card border p-4">
        <legend className="px-1 text-sm font-semibold">{t('landing.card.button')}</legend>
        <BilingualField label={t('landing.card.buttonLabel')} value={card.ctaLabel} onChange={(ctaLabel) => onChange({ ctaLabel })} />
        <TargetPicker
          idPrefix={`${card.id}-cta`}
          label={t('landing.card.buttonTarget')}
          mode={ctaMode}
          modes={['url', 'node']}
          url={card.ctaUrl}
          nodeId={card.ctaNodeId}
          linkOptions={linkOptions}
          error={err('ctaUrl')}
          onMode={(m) => onChange(m === 'node' ? { ctaNodeId: linkOptions[0]?.nodeId ?? null, ctaUrl: '', ctaLink: null } : { ctaNodeId: null, ctaLink: null })}
          onUrl={(ctaUrl) => onChange({ ctaUrl })}
          onNode={(ctaNodeId) => onChange({ ctaNodeId: ctaNodeId || null, ctaUrl: '', ctaLink: null })}
        />
        <label className="flex min-h-9 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={card.ctaDot} onChange={(e) => onChange({ ctaDot: e.target.checked })} />
          <span>{t('landing.card.dot')}<span className="block text-xs text-muted-foreground">{t('landing.card.dotHint')}</span></span>
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-card border p-4">
        <legend className="px-1 text-sm font-semibold">{t('landing.card.share')}</legend>
        <label className="flex min-h-9 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={card.shareEnabled} onChange={(e) => onChange({ shareEnabled: e.target.checked })} data-testid="share-enabled" />
          <span>{t('landing.card.shareEnabled')}<span className="block text-xs text-muted-foreground">{t('landing.card.shareEnabledHint')}</span></span>
        </label>
        {card.shareEnabled && (
          <TargetPicker
            idPrefix={`${card.id}-share`}
            label={t('landing.card.shareTarget')}
            mode={shareMode}
            modes={['same', 'url', 'node']}
            url={card.shareUrl}
            nodeId={card.shareNodeId}
            linkOptions={linkOptions}
            error={err('shareUrl')}
            onMode={(m) => onChange(m === 'same' ? { shareUrl: '', shareNodeId: null, shareLink: null } : m === 'node' ? { shareNodeId: linkOptions[0]?.nodeId ?? null, shareUrl: '', shareLink: null } : { shareNodeId: null, shareLink: null })}
            onUrl={(shareUrl) => onChange({ shareUrl })}
            onNode={(shareNodeId) => onChange({ shareNodeId: shareNodeId || null, shareUrl: '', shareLink: null })}
          />
        )}
        <p className="text-xs text-muted-foreground">{t('landing.card.shareTextsIn')}</p>
      </fieldset>
    </div>
  )
}

/** Radio group (typed address | a page of this project | same as the button) + the matching control. */
function TargetPicker({ idPrefix, label, mode, modes, url, nodeId, linkOptions, error, onMode, onUrl, onNode }) {
  const { t } = useLanguage()
  const known = linkOptions.some((o) => o.nodeId === nodeId)
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-athar-ink" id={`${idPrefix}-label`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`${idPrefix}-label`} className="flex flex-wrap gap-x-5 gap-y-1">
        {modes.map((m) => (
          <label key={m} className="flex min-h-9 items-center gap-2 text-sm">
            <input type="radio" name={`${idPrefix}-mode`} checked={mode === m} onChange={() => onMode(m)} data-testid={`${idPrefix}-${m}`} />
            {t(`landing.target.${m}`)}
          </label>
        ))}
      </div>
      {mode === 'url' && <Field label={t('landing.target.urlLabel')} dir="ltr" inputMode="url" placeholder="https://" value={url} onChange={(e) => onUrl(e.target.value)} error={error} data-testid={`${idPrefix}-input`} />}
      {mode === 'node' && (
        linkOptions.length || nodeId ? (
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-node`} className={LABEL_CLASS}>{t('landing.target.nodeLabel')}</label>
            <select id={`${idPrefix}-node`} className={cn(SELECT_CLASS)} value={nodeId ?? ''} onChange={(e) => onNode(e.target.value)} data-testid={`${idPrefix}-select`}>
              {!nodeId && <option value="">{t('landing.target.choose')}</option>}
              {!known && nodeId && <option value={nodeId}>{t('landing.target.unlinked')}</option>}
              {linkOptions.map((o) => <option key={o.nodeId} value={o.nodeId}>{o.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{t('landing.target.nodeHint')}</p>
          </div>
        ) : (
          <p className="rounded-md bg-surface p-3 text-sm text-muted-foreground" data-testid={`${idPrefix}-none`}>{t('landing.target.noLinks')}</p>
        )
      )}
      {mode === 'same' && <p className="text-xs text-muted-foreground">{t('landing.target.sameHint')}</p>}
    </div>
  )
}
