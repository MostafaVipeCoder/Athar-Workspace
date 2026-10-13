import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useInputPort } from '../_kit/useInputPort.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLandingDefinition, useLandingLink } from '../../data/landing.js'
import { uploadImage } from '../../data/storage.js'
import { buildPublicUrl } from '../../lib/links.js'
import { cn } from '../../lib/cn.js'
import PageSections from './PageSections.jsx'
import CardList from './CardList.jsx'
import ShareEditor from './ShareEditor.jsx'
import PhotoEditor from './PhotoEditor.jsx'
import AnalyticsTab from './AnalyticsTab.jsx'
import LandingPreview from './LandingPreview.jsx'
import { deleteOrphans, orphanPaths, pathsOf } from './assets.js'
import { fromCardRow, fromFrameRow, isBlankLanding, normalizeLandingConfig, starterTemplate, toChildren, validateLanding, withResolvedLinks } from './landingLogic.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TABS = ['page', 'share', 'photo', 'analytics']

/**
 * Edit mode (design 01 section 3.9, decisions 01-13 / 01-14): hero, navigation, the cards section intro, N cards (cover image, texts ar/en,
 * button label + target, share target), per-card per-platform share texts with a live `{link}` preview, the "Personalize the Moment" section
 * with its PM-uploaded transparent PNG frames, and the analytics. ONE client draft (config + cards + frames) saved with ONE save_node call
 * (config + children) under the revision token: nothing is half-written, a card keeps its id across saves (analytics survive). Images are
 * uploaded when chosen; files a saved page no longer references are removed after Save. A live preview (the public renderer fed with the
 * draft) sits beside the form on wide screens and in its own tab on phones.
 */
export default function LandingEdit() {
  const { node, projectId } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const { config: rawConfig, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeLandingConfig(rawConfig), [rawConfig])
  const def = useLandingDefinition(node.id)
  const linkPort = useInputPort('links')
  const link = useLandingLink(node.id)
  const [tab, setTab] = useState('page')
  const [base, setBase] = useState(null)
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const uploads = useRef(new Set())

  // adopt the loaded rows (and newer saved states from outside) unless the user has unsaved edits
  const loaded = useMemo(() => (def.data ? { cards: def.data.cards.map(fromCardRow), frames: def.data.frames.map(fromFrameRow) } : null), [def.data])
  const childrenDirty = Boolean(draft && base && !same(draft, base))
  if (loaded && (!base || (!same(loaded, base) && !childrenDirty))) {
    setBase(loaded)
    setDraft(loaded)
  }
  const cards = useMemo(() => draft?.cards ?? [], [draft])
  const frames = useMemo(() => draft?.frames ?? [], [draft])
  const dirty = configDirty || childrenDirty
  const setCards = (fn) => setDraft((d) => ({ ...(d ?? { frames: [] }), cards: fn((d ?? { cards: [] }).cards) }))
  const setFrames = (fn) => setDraft((d) => ({ ...(d ?? { cards: [] }), frames: fn((d ?? { frames: [] }).frames) }))
  const patchConfig = (p) => setConfig({ ...config, ...p })
  const patchSection = (key) => (p) => patchConfig({ [key]: { ...config[key], ...p } })

  // the links a card can be bound to: the public URLs of the nodes connected to the `links` input
  const linkOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const i of linkPort.items) {
      if (!i.nodeId || seen.has(i.nodeId)) continue
      seen.add(i.nodeId)
      const name = (lang === 'ar' ? i.label?.ar || i.label?.en : i.label?.en || i.label?.ar) || ''
      out.push({ nodeId: i.nodeId, kind: i.kind, url: i.url, label: `${t(`landing.kind.${i.kind}`)}${name ? ` - ${name}` : ''}` })
    }
    return out
  }, [linkPort.items, lang, t])
  const optionsByNode = useMemo(() => new Map(linkOptions.map((o) => [o.nodeId, o])), [linkOptions])

  const ownUrl = link.data?.slug ? buildPublicUrl('view', link.data.slug, { viewKey: 'landing' }) : ''
  const previewModel = useMemo(() => ({ nodeId: node.id, config, cards: cards.map((c) => withResolvedLinks(c, optionsByNode)), frames }), [node.id, config, cards, frames, optionsByNode])
  const blank = isBlankLanding(rawConfig, cards, frames)

  async function uploadCover(file) {
    const path = await uploadImage(file, { ownerId: projectId, kind: 'landing' })
    uploads.current.add(path)
    return path
  }

  function removeCard(card, index) {
    setCards((cur) => cur.filter((c) => c.id !== card.id))
    toast.info(t('landing.edit.removedCard'), { action: { label: t('canvas.undo'), onClick: () => setCards((cur) => (cur.some((c) => c.id === card.id) ? cur : [...cur.slice(0, index), card, ...cur.slice(index)])) } })
  }
  function removeFrame(frame, index) {
    setFrames((cur) => cur.filter((f) => f.id !== frame.id))
    toast.info(t('landing.edit.removedFrame'), { action: { label: t('canvas.undo'), onClick: () => setFrames((cur) => (cur.some((f) => f.id === frame.id) ? cur : [...cur.slice(0, index), frame, ...cur.slice(index)])) } })
  }

  function applyStarter() {
    const s = starterTemplate()
    setConfig({ ...config, ...s.config })
    setCards(() => s.cards)
    toast.success(t('landing.edit.starterApplied'))
  }

  async function onSave() {
    const errs = validateLanding({ config, cards, frames })
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error(t('landing.edit.invalid'))
      return
    }
    const before = pathsOf(node.config, base ?? { cards: [], frames: [] })
    const r = await save({ config }, { children: toChildren(cards, frames) })
    if (!r.ok) return
    setBase(draft)
    await deleteOrphans(orphanPaths(before, uploads.current, pathsOf(config, draft)))
    uploads.current.clear()
    qc.invalidateQueries({ queryKey: ['node', node.id, 'landing'] })
    toast.success(t('landing.edit.saved'))
  }

  if (def.error) return <NodeFrame><ErrorState error={def.error} onRetry={def.refetch} /></NodeFrame>
  if (def.isPending || !draft) return <NodeFrame><Loading /></NodeFrame>

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave} subtitle={t('landing.edit.subtitle', { cards: cards.length, frames: frames.length })}>
      <div className="space-y-4" data-testid="landing-edit">
        {blank && (
          <EmptyState
            icon={Sparkles}
            title={t('landing.edit.blank')}
            body={t('landing.edit.blankBody')}
            action={<Button onClick={applyStarter} data-testid="use-starter"><Sparkles className="h-4 w-4" aria-hidden="true" />{t('landing.edit.applyStarter')}</Button>}
          />
        )}

        <div role="tablist" aria-label={t('landing.edit.tabs')} className="flex flex-wrap gap-1 border-b">
          {[...TABS, 'preview'].map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`landing-tab-${k}`}
              aria-selected={tab === k}
              aria-controls="landing-tabpanel"
              onClick={() => setTab(k)}
              className={cn('tap-target -mb-px border-b-2 px-4 text-sm font-semibold transition-colors', tab === k ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground', k === 'preview' && 'xl:hidden')}
              data-testid={`tab-${k}`}
            >
              {t(`landing.tab.${k}`)}
            </button>
          ))}
        </div>

        <div className={cn('grid gap-6', tab !== 'analytics' && 'xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]')}>
          <div id="landing-tabpanel" role="tabpanel" aria-labelledby={`landing-tab-${tab}`} className={cn('min-w-0 space-y-5', tab === 'preview' && 'hidden xl:block')}>
            {tab === 'page' && (
              <>
                <PageSections config={config} patch={(key, p) => patchSection(key)(p)} errors={errors} onHeroCover={uploadCover} onClearHeroCover={() => patchSection('hero')({ coverPath: '' })} />
                <CardList cards={cards} setCards={setCards} errors={errors} linkOptions={linkOptions} onCover={uploadCover} onRemove={removeCard} />
              </>
            )}
            {tab === 'share' && <ShareEditor config={config} patchShare={patchSection('share')} cards={cards} setCards={setCards} linkOptions={linkOptions} pageUrl={ownUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/view/your-page/landing`} />}
            {tab === 'photo' && <PhotoEditor config={config.personalize} patch={patchSection('personalize')} frames={frames} setFrames={setFrames} projectId={projectId} onUploaded={(p) => uploads.current.add(p)} onRemoved={removeFrame} />}
            {tab === 'analytics' && <AnalyticsTab nodeId={node.id} cards={cards} analyticsOn={config.analytics.enabled} />}
          </div>
          {tab !== 'analytics' && (
            <aside className={cn('min-w-0 xl:sticky xl:top-4 xl:self-start', tab === 'preview' ? 'block' : 'hidden xl:block')}>
              <LandingPreview model={previewModel} pageUrl={ownUrl} slug={link.data?.slug ?? ''} />
            </aside>
          )}
        </div>
      </div>
    </NodeFrame>
  )
}
