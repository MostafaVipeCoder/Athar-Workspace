import { CalendarClock } from 'lucide-react'
import { useFounderBlock } from '../../../../data/founder.js'
import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import MyScheduleTab from '../../../../nodes/distribution/MyScheduleTab.jsx'
import { EmptyState } from '../../../../ui/States.jsx'
import { QueryBlock } from './BlockFrame.jsx'
import '../i18n.js'

function Schedule({ projectId, node }) {
  const { t, pick } = useLanguage()
  const q = useFounderBlock(projectId, 'schedule', node.node_id)
  return (
    <QueryBlock query={q} skeletonLines={3}>
      {q.data?.data ? (
        <MyScheduleTab data={q.data.data} title={pick(node, 'name')} hideTitle audience="participant" />
      ) : (
        <EmptyState icon={CalendarClock} title={t('founder.block.unavailable')} />
      )}
    </QueryBlock>
  )
}

/** "My schedule / Who do I meet next": the published Mentoring Distribution (MyScheduleTab reused; the founder's own company is preselected). */
export default function MyScheduleBlock({ block, projectId }) {
  return (
    <div className="space-y-4" data-testid="schedule-block">
      {(block.data?.items ?? []).map((n) => <Schedule key={n.node_id} projectId={projectId} node={n} />)}
    </div>
  )
}
