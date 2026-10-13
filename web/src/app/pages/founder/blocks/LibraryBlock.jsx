import FounderLibraryButtons from '../FounderLibraryButtons.jsx'

/** The Resource Library: one button per exposed library (FounderLibraryButtons reused, rows come with the page). */
export default function LibraryBlock({ block, projectId }) {
  return (
    <div className="panel p-4" data-testid="library-block">
      <FounderLibraryButtons projectId={projectId} items={block.data?.items ?? []} className="grid gap-2 [&>a]:w-full" />
    </div>
  )
}
