import FounderLandingButtons from '../FounderLandingButtons.jsx'

/** Landing / opportunities pages the PM exposed (FounderLandingButtons reused, rows come with the page). */
export default function LandingBlock({ block, projectId }) {
  return (
    <div className="panel p-4" data-testid="landing-block">
      <FounderLandingButtons projectId={projectId} items={block.data?.items ?? []} className="grid gap-2 [&>a]:w-full" />
    </div>
  )
}
