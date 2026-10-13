import { Navigate, useParams } from 'react-router-dom'

/** `/alumni/founder/programs/:projectId/library` (06 section 2.5) -> the Program page, where the Resource Library is a block. */
export default function FounderProgramRedirect() {
  const { projectId } = useParams()
  return <Navigate to={`/alumni/founder/programs/${projectId}`} replace />
}
