import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layers, LogOut, ShieldOff } from 'lucide-react'
import { useFounderProgramPage } from '../../../data/founder.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { setPageMeta } from '../../../lib/meta.js'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import BlockFrame from './blocks/BlockFrame.jsx'
import { BLOCKS, isKnownBlock } from './blocks/index.js'
import ProgramHeader from './ProgramHeader.jsx'
import SectionNav from './SectionNav.jsx'
import { visibleBlocks } from './programLogic.js'
import './i18n.js'

function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="program-skeleton">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="aspect-video w-full rounded-card" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/** Where a failed load ends: not a participant (or the project is gone) is `not available`, never an error that hints at existence. */
function Unavailable() {
  const { t } = useLanguage()
  return (
    <EmptyState
      icon={ShieldOff}
      title={t('founder.page.notAvailable')}
      body={t('founder.page.notAvailableBody')}
      action={<Link to="/alumni/founder/programs" className={buttonClass({ variant: 'outline', size: 'md', className: 'mt-2' })}>{t('founder.page.back')}</Link>}
    />
  )
}

/**
 * /alumni/founder/programs/:projectId - the Program page. ONE request (`get_founder_program_page`) returns the header and the
 * ORDERED list of blocks the PM added AND enabled; nothing else is ever rendered (docs/13 section 11). Every block is its own
 * lazy chunk with its own loading / error state, so one failing block never hides the page. A `withdrawn` participant sees the
 * header and a status card only (03-6), PLUS the one block the DB still sends him: his own certificate when he holds a valid one
 * (owner decision 08 section 18.2: an issued certificate stays valid and available after a withdrawal, which can only be a PM
 * mistake). The client never decides that: a restricted page renders exactly the blocks the server sent, as any other page.
 */
export default function FounderProgramPage() {
  const { projectId } = useParams()
  const { t, pick } = useLanguage()
  const q = useFounderProgramPage(projectId)
  const page = q.data
  const blocks = useMemo(() => visibleBlocks(page?.blocks, isKnownBlock), [page])

  const projectName = page?.project ? pick(page.project, 'name') : ''
  useEffect(() => {
    if (projectName) setPageMeta({ title: projectName })
  }, [projectName])

  // a section title: the fixed word, or the node's own name when the page carries several blocks of one kind
  const countOf = useMemo(() => blocks.reduce((m, b) => ({ ...m, [b.type]: (m[b.type] ?? 0) + 1 }), {}), [blocks])
  const titleOf = (b, prefix) => (countOf[b.type] > 1 && b.data ? pick(b.data, 'name') : '') || t(`founder.${prefix}.${b.type}`)
  const sections = useMemo(() => blocks.map((b) => ({ id: `section-${b.key}`, label: (countOf[b.type] > 1 && b.data ? pick(b.data, 'name') : '') || t(`founder.nav.${b.type}`) })), [blocks, countOf, pick, t])

  if (q.isPending) return <PageSkeleton />
  if (q.error) {
    if (q.error.code === 'forbidden' || q.error.code === 'not_found') return <Unavailable />
    return <ErrorState error={q.error} title={t('founder.page.loadFailed')} onRetry={q.refetch} />
  }
  if (!page?.project) return <Unavailable />

  return (
    <div className="space-y-6" data-testid="founder-program-page" data-status={page.participant?.status}>
      <ProgramHeader project={page.project} participant={page.participant} restricted={page.restricted} />

      {page.restricted && (
        <EmptyState icon={LogOut} title={t('founder.page.withdrawn')} body={t(blocks.length > 0 ? 'founder.page.withdrawnBodyCertificate' : 'founder.page.withdrawnBody')} />
      )}
      {blocks.length > 0 ? (
        <>
          {blocks.length >= 3 && <SectionNav sections={sections} />}
          <div className="space-y-8">
            {blocks.map((b) => {
              const { icon, Component } = BLOCKS[b.type]
              return (
                <BlockFrame key={b.key} id={`section-${b.key}`} type={b.type} title={titleOf(b, 'block')} icon={icon}>
                  <Component block={b} projectId={projectId} project={page.project} />
                </BlockFrame>
              )
            })}
          </div>
        </>
      ) : (
        !page.restricted && <EmptyState icon={Layers} title={t('founder.page.empty')} body={t('founder.page.emptyBody')} />
      )}
    </div>
  )
}
