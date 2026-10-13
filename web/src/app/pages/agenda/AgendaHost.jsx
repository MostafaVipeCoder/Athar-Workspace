import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Printer } from 'lucide-react'
import { useAgendaView, getPublicTab } from '../../../data/agenda.js'
import { usePublicTab } from '../../../data/lists.js'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { EmptyState, ErrorState, Loading } from '../../../ui/States.jsx'
import { Img } from '../../../ui/Img.jsx'
import { Button } from '../../../ui/Button.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useAuth } from '../../AuthContext.js'
import { cn } from '../../../lib/cn.js'
import { setPageMeta } from '../../../lib/meta.js'
import { parseRef } from '../../../lib/links.js'
import { findTab, normalizeAgendaConfig, tabsWithSlugs } from '../../../nodes/agenda/agendaLogic.js'
import { PUBLIC_PAGE_SIZE, isPaginated, tabViewComponent } from './tabViews.js'
import '../../../nodes/agenda/i18n.js'

const HEIGHT = { sm: 'min-h-[140px] sm:min-h-[180px]', md: 'min-h-[200px] sm:min-h-[260px]', lg: 'min-h-[280px] sm:min-h-[360px]' }

/**
 * THE view page of a project (design 01 section 3.1, 02 section 4, 08 decision 01-3): the cover header, the tab bar of
 * the contributed views and one tab panel. The host is either the implicit `view_host` (project page: every view
 * connected to it, the agenda included) or an Agenda node (its own page: the agenda first, then the views connected to
 * it). Data: `get_agenda_view(ref)` once (audience decided by the DB), then `get_public_tab(ref, edge)` lazily per tab.
 * Mobile first: the tab bar scrolls horizontally; the day pills (inside the agenda tab) stick under the site header.
 * Used by /agenda/:ref/:tab? (PublicShell) and by the founder shell route; `basePath` builds the per-tab deep links.
 */
export default function AgendaHost({ refValue, tabParam = null, basePath, signInPath = null }) {
  const { t, lang, pick } = useLanguage()
  const auth = useAuth()
  const ref = parseRef(refValue)
  const view = useAgendaView(ref.kind === 'invalid' ? null : ref.value)
  const payload = view.data
  const tabs = useMemo(() => tabsWithSlugs(payload?.tabs ?? []), [payload])
  const current = useMemo(() => findTab(tabs, tabParam), [tabs, tabParam])
  const agendaTab = useMemo(() => tabs.find((x) => x.type === 'agenda') ?? null, [tabs])
  // the header settings live in the agenda node's config, carried by its tab payload (whitelisted by the DB)
  const agendaPayload = usePublicTab(payload && agendaTab ? ref.value : null, agendaTab?.edge_id ?? null)
  const headerConfig = useMemo(() => normalizeAgendaConfig(agendaPayload.data?.data?.config ?? {}), [agendaPayload.data])
  const project = payload?.project ?? null
  const title = pick(project, 'name') || pick(payload?.host, 'name') || ''
  const cover = project?.cover_path ? publicImageUrl(project.cover_path) : null

  useEffect(() => {
    if (payload) setPageMeta({ title: current && current.type !== 'agenda' ? `${pick(current, 'title')} - ${title}` : title, description: headerConfig.header.title.en || headerConfig.header.brandName || '', image: cover })
  }, [payload, current, title, cover, headerConfig, pick])

  if (ref.kind === 'invalid') return <NotAvailable t={t} auth={auth} signInPath={signInPath} />
  if (view.isPending) return <Loading />
  if (view.error) return <ErrorState error={view.error} onRetry={view.refetch} />
  if (!payload) return <NotAvailable t={t} auth={auth} signInPath={signInPath} />

  const h = headerConfig.header
  const showHeader = h.visible && (cover || h.type === 'color' || h.brandName || h.title.en || h.title.ar || title)
  const overlayTitle = (lang === 'ar' ? h.title.ar || h.title.en : h.title.en || h.title.ar) || title
  const accent = headerConfig.theme.accent

  return (
    <article className="space-y-4 py-2" data-testid="agenda-host" data-audience={payload.viewer} data-host={payload.host?.type} style={accent ? { '--agenda-accent': accent } : undefined}>
      {showHeader && (
        <header className={cn('relative overflow-hidden rounded-card bg-athar-ink text-white print:min-h-0', HEIGHT[h.height] ?? HEIGHT.md)} style={h.type === 'color' || !cover ? { backgroundColor: h.type === 'color' ? h.color : undefined } : undefined} data-testid="agenda-cover">
          {h.type === 'image' && cover && (
            <>
              <Img src={cover} thumb={project?.cover_path ? publicThumbUrl(project.cover_path) : undefined} alt="" aspect="auto" priority className="absolute inset-0 h-full w-full print:hidden" />
              <div className="absolute inset-0 print:hidden" style={{ backgroundColor: `rgba(0,0,0,${h.dim})` }} aria-hidden="true" />
            </>
          )}
          <div className="relative z-10 flex h-full min-h-[inherit] flex-col justify-end gap-1 p-5 sm:p-8" style={{ color: h.titleColor }}>
            {h.brandName && <p className="text-xs font-semibold uppercase tracking-wide opacity-90">{h.brandName}</p>}
            <h1 className="text-page-title drop-shadow" dir="auto">{overlayTitle}</h1>
          </div>
        </header>
      )}
      {!showHeader && <h1 className="text-page-title">{title}</h1>}

      {tabs.length > 1 && (
        <nav aria-label={t('agenda.view.tabs')} className="-mx-4 border-b border-border px-4 print:hidden">
          <ul className="flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((x) => {
              const active = current?.slug === x.slug
              return (
                <li key={x.slug} role="presentation" className="shrink-0">
                  <Link to={`${basePath}/${x.slug}${lang ? `?lang=${lang}` : ''}`} role="tab" aria-selected={active} aria-current={active ? 'page' : undefined} className={cn('nav-link whitespace-nowrap', active && 'active')} data-testid="host-tab">
                    {pick(x, 'title')}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {current ? (
        <TabPanel key={current.slug} refValue={ref.value} tab={current} payload={payload} singleTab={tabs.length === 1} />
      ) : (
        <EmptyState icon={Lock} title={t('agenda.view.tabEmpty')} />
      )}

      <div className="flex justify-end print:hidden">
        <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" />{t('agenda.view.print')}</Button>
      </div>
    </article>
  )
}

function NotAvailable({ t, auth, signInPath }) {
  return (
    <EmptyState
      icon={Lock}
      title={t('agenda.view.notFound')}
      body={t('agenda.view.notFoundBody')}
      action={auth?.status !== 'authed' && signInPath ? <Link to={signInPath} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">{t('agenda.view.signIn')}</Link> : null}
    />
  )
}

/** One tab: its payload (lazy, cached per edge, shared with the header prefetch) rendered by the contributed component. */
function TabPanel({ refValue, tab, payload: host, singleTab }) {
  const { t, pick } = useLanguage()
  const query = usePublicTab(refValue, tab.edge_id ?? null)
  const Comp = tabViewComponent(tab.type, tab.view_key)
  const [extra, setExtra] = useState({ for: null, items: [], next: null, lastCount: null, loading: false, error: null })
  const p = query.data
  const appended = extra.for === p?.revision
  const paginated = isPaginated(p)
  const data = p?.data ? (paginated ? { ...p.data, items: [...p.data.items, ...(appended ? extra.items : [])], next: appended ? extra.next : p.data.next } : p.data) : null
  const lastCount = appended ? extra.lastCount : p?.data?.items?.length ?? 0
  const hasMore = paginated && Boolean(data?.next) && lastCount >= PUBLIC_PAGE_SIZE

  async function loadMore() {
    setExtra((s) => ({ ...s, for: p.revision, loading: true, error: null }))
    try {
      const page = await getPublicTab(refValue, tab.edge_id ?? null, data.next)
      const rows = page?.data?.items ?? []
      setExtra((s) => ({ for: p.revision, items: [...(s.for === p.revision ? s.items : []), ...rows], next: page?.data?.next ?? null, lastCount: rows.length, loading: false, error: null }))
    } catch (e) {
      setExtra((s) => ({ ...s, loading: false, error: e }))
    }
  }

  if (!Comp) return <EmptyState title={t('agenda.view.tabUnavailable')} body={t('agenda.view.tabUnavailableBody')} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!p) return <EmptyState icon={Lock} title={t('agenda.view.tabEmpty')} />

  return (
    <section data-testid="tab-panel" data-view={tab.view_key}>
      <Suspense fallback={<Loading />}>
        <Comp
          data={data}
          title={pick(tab, 'title')}
          hideTitle={singleTab || tab.type === 'agenda'}
          audience={host.viewer}
          timezone={host.project?.timezone}
          project={host.project}
          onLoadMore={paginated ? loadMore : undefined}
          hasMore={hasMore}
          loadingMore={extra.loading}
        />
      </Suspense>
      {extra.error && <ErrorState error={extra.error} onRetry={loadMore} className="mt-3" />}
    </section>
  )
}
