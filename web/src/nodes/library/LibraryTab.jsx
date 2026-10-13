import { memo, useCallback, useMemo, useState } from 'react'
import { Download, ExternalLink, EyeOff, FileText, Headphones, Image as ImageIcon, LayoutGrid, Library, List, Lock, PlayCircle, Link2 } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Img } from '../../ui/Img.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { publicThumbUrl } from '../../data/storage.js'
import { useSignedUrls } from '../../data/library.js'
import { cn } from '../../lib/cn.js'
import { downloadFile, openFile } from './openResource.js'
import {
  RESOURCE_TYPES, categoryName, filterResources, formatBytes, fromCategoryRow, fromRow, groupResources, hostOf, isHttpUrl, isImageMime,
  normalizeLibraryConfig, resourceDescription, resourceTitle, thumbOf, typeCounts,
} from './libraryLogic.js'

const TYPE_ICON = { readable: FileText, audible: Headphones, visual: PlayCircle, link: Link2 }
const LAYOUT_KEY = 'athar.library.layout'
const readLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) } catch { return null } }
const writeLayout = (v) => { try { localStorage.setItem(LAYOUT_KEY, v) } catch { /* private mode: the choice just is not remembered */ } }

/** The thumbnail of a resource: its cover (public image) or, for an uploaded image, the signed derived thumbnail. */
function Thumb({ resource, signed, list }) {
  const Icon = isImageMime(resource.mime) ? ImageIcon : TYPE_ICON[resource.type] ?? FileText
  const src = resource.coverPath ? publicThumbUrl(resource.coverPath) : resource.filePath && isImageMime(resource.mime) ? signed?.[thumbOf(resource.filePath)] : null
  const aspect = list ? '1 / 1' : src ? '16 / 10' : '16 / 6'
  return (
    <div className={cn('shrink-0 overflow-hidden bg-surface', list ? 'w-16 rounded-md sm:w-20' : 'rounded-t-card')}>
      {src ? (
        <Img src={src} alt="" aspect={aspect} />
      ) : (
        <div className="flex items-center justify-center text-primary" style={{ aspectRatio: aspect }} aria-hidden="true">
          <Icon className={list ? 'h-7 w-7' : 'h-10 w-10'} />
        </div>
      )}
    </div>
  )
}

/** One resource as a card or a row. Files open/download through signed URLs minted on click; links open in a new tab. */
const ResourceItem = memo(function ResourceItem({ resource, list, signed, audience, busy, onOpen, onDownload }) {
  const { t, lang } = useLanguage()
  const title = resourceTitle(resource, lang)
  const description = resourceDescription(resource, lang)
  const size = formatBytes(resource.bytes, lang)
  const isFile = Boolean(resource.hasFile)
  const link = !isFile && isHttpUrl(resource.url) ? resource.url : null
  const meta = [t(`library.type.${resource.type}`), isFile ? size : hostOf(resource.url)].filter(Boolean)
  return (
    <article className={cn('flex overflow-hidden rounded-card border border-border bg-card text-card-foreground', list ? 'items-stretch gap-3 p-3' : 'h-full flex-col')} data-testid="resource" data-type={resource.type} data-visibility={resource.visibility}>
      <Thumb resource={resource} signed={signed} list={list} />
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', list ? 'sm:flex-row sm:items-center sm:justify-between sm:gap-4' : 'p-4')}>
        <div className="min-w-0 space-y-1">
          {audience === 'pm' && resource.visibility !== 'public' && (
            <Badge tone={resource.visibility === 'hidden' ? 'neutral' : 'blue'}>
              {resource.visibility === 'hidden' ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <Lock className="h-3 w-3" aria-hidden="true" />}
              {t(`library.visibility.${resource.visibility}.short`)}
            </Badge>
          )}
          <h4 dir="auto" className="text-base font-bold leading-snug">{title || '-'}</h4>
          {description && <p dir="auto" className={cn('text-sm text-muted-foreground', list ? 'line-clamp-2' : 'line-clamp-3')}>{description}</p>}
          <p className="text-xs text-muted-foreground" dir="auto">{meta.join(' · ')}</p>
        </div>
        <div className={cn('flex shrink-0 flex-wrap items-center gap-2', !list && 'mt-auto pt-1')}>
          {isFile ? (
            <>
              <Button className="px-4" onClick={() => onOpen(resource)} loading={busy === `open:${resource.id}`} aria-label={`${t('library.view.open')}: ${title}`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('library.view.open')}
              </Button>
              <Button className="px-4" variant="outline" onClick={() => onDownload(resource)} loading={busy === `dl:${resource.id}`} aria-label={`${t('library.view.download')}: ${title}`}>
                <Download className="h-4 w-4" aria-hidden="true" />{t('library.view.download')}
              </Button>
            </>
          ) : link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'primary', size: 'md', className: 'px-4' })} aria-label={`${t('library.view.openLink')}: ${title}`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('library.view.openLink')}
            </a>
          ) : null}
        </div>
      </div>
    </article>
  )
})

/**
 * The Resource Library's contributed tab view (manifest.contributesViews 'library-tab'): a categorised grid or list with
 * search and a type filter, mobile-first and bilingual.
 *
 * CONTRACT for hosts (Agenda tabs, the founder page, /view/:ref/library-tab): `<LibraryTab data={payload.data} title audience
 * hideTitle />` where `payload` is `get_public_tab(ref, edge)` / `get_public_library(ref)` and `data = { resources, categories,
 * config }` (m36: hidden resources never arrive; `visibility` arrives for PMs only). The component never fetches the payload;
 * files are opened/downloaded through short-lived signed URLs minted on click (03). The PM preview passes `resources` +
 * `categories` (raw rows) + `config` instead of `data`.
 */
export default function LibraryTab({ data = null, resources = null, categories = null, config = null, title, audience = 'public', hideTitle = false }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const cfg = useMemo(() => normalizeLibraryConfig(config ?? data?.config), [config, data])
  const rows = useMemo(() => (resources ?? data?.resources ?? []).map(fromRow), [resources, data])
  const cats = useMemo(() => (categories ?? data?.categories ?? []).map(fromCategoryRow), [categories, data])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [layoutChoice, setLayoutChoice] = useState(() => readLayout())
  const [busy, setBusy] = useState(null)
  const layout = layoutChoice === 'grid' || layoutChoice === 'list' ? layoutChoice : cfg.layout

  const imagePaths = useMemo(() => rows.filter((r) => r.filePath && isImageMime(r.mime) && !r.coverPath).map((r) => thumbOf(r.filePath)), [rows])
  const signed = useSignedUrls(imagePaths).data

  const counts = useMemo(() => typeCounts(rows), [rows])
  const filtered = useMemo(() => filterResources(rows, { query, type }), [rows, query, type])
  const groups = useMemo(() => groupResources(filtered, cats, cfg.groupBy), [filtered, cats, cfg.groupBy])
  const typesPresent = RESOURCE_TYPES.filter((x) => counts[x] > 0)

  const chooseLayout = (v) => { setLayoutChoice(v); writeLayout(v) }
  const run = useCallback(async (key, fn) => {
    setBusy(key)
    try { await fn() } catch (e) { toast.error(t(e?.messageKey === 'errors.forbidden' ? 'library.view.denied' : 'library.view.openFailed')) } finally { setBusy(null) }
  }, [toast, t])
  const onOpen = useCallback((r) => run(`open:${r.id}`, () => openFile(r)), [run])
  const onDownload = useCallback((r) => run(`dl:${r.id}`, () => downloadFile(r, lang)), [run, lang])

  const showTitle = title && !hideTitle
  const groupTitle = (g) => (g.kind === 'category' ? categoryName(g.category, lang) : g.kind === 'type' ? t(`library.type.plural.${g.type}`) : g.kind === 'other' ? t('library.view.other') : '')

  return (
    <section className="space-y-5" data-testid="library-tab" data-audience={audience}>
      {showTitle && <h2 className="text-section-title">{title}</h2>}

      {rows.length === 0 ? (
        <EmptyState icon={Library} title={t('library.view.empty')} body={t('library.view.emptyBody')} />
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {cfg.searchEnabled && <SearchBar className="min-w-0 flex-1 basis-56" value={query} onChange={setQuery} label={t('library.view.search')} placeholder={t('library.view.searchPlaceholder')} />}
              <div className="flex gap-1" role="group" aria-label={t('library.view.layout')}>
                <Button size="icon" variant={layout === 'grid' ? 'secondary' : 'outline'} aria-pressed={layout === 'grid'} aria-label={t('library.layout.grid')} onClick={() => chooseLayout('grid')}><LayoutGrid className="h-4 w-4" aria-hidden="true" /></Button>
                <Button size="icon" variant={layout === 'list' ? 'secondary' : 'outline'} aria-pressed={layout === 'list'} aria-label={t('library.layout.list')} onClick={() => chooseLayout('list')}><List className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            </div>
            {typesPresent.length > 1 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={t('library.view.filterType')}>
                {['all', ...typesPresent].map((x) => (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={type === x}
                    onClick={() => setType(x)}
                    className={cn('tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors duration-300', type === x ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:border-foreground')}
                  >
                    {x === 'all' ? t('library.view.all') : t(`library.type.plural.${x}`)}
                    <span className={cn('text-xs', type === x ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{counts[x]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Library} title={t('library.view.noResults')} body={t('library.view.noResultsBody')} action={<Button size="sm" variant="outline" onClick={() => { setQuery(''); setType('all') }}>{t('library.view.clearFilters')}</Button>} />
          ) : (
            <div className="space-y-8">
              {groups.map((g) => (
                <div key={g.key} className="space-y-3" data-testid="resource-group" data-group={g.key}>
                  {g.kind !== 'all' && !(g.kind === 'other' && groups.length === 1) && (
                    <h3 className="text-card-title flex items-baseline gap-2" dir="auto">
                      {groupTitle(g)}<span className="text-sm font-normal text-muted-foreground">{g.items.length}</span>
                    </h3>
                  )}
                  <div className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}>
                    {g.items.map((r) => (
                      <ResourceItem key={r.id} resource={r} list={layout === 'list'} signed={signed} audience={audience} busy={busy} onOpen={onOpen} onDownload={onDownload} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
