import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackLandingEvent } from '../../data/landing.js'

/**
 * Analytics sink of a public landing page (design 04 section 3.12, 07 section 5.2): `track(type, { cardId, platform })` -> the anon RPC
 * `track_landing_event` (closed vocabulary, rate limited, no PII, fire-and-forget) and ONE `tab_view` per page view.
 * Nothing is recorded when: the node turned analytics off, the viewer is a project manager (a preview is not a visit; the DB also
 * ignores PM visits), the URL carries `?notrack`, or there is no ref (the founder-shell route of the agenda has none).
 * `track` returns the request's promise (resolves true/false, never rejects) so a click that leaves the page can wait briefly for it.
 * `ready` = the page payload has arrived (the viewer and the analytics switch are known): nothing is sent while it loads.
 * `nodeId` is sent when the page is a TAB of an agenda / project page (the ref is then the host's, the DB checks the edge).
 */
export function useLandingTracker({ refValue, nodeId = null, analyticsEnabled = true, audience = 'public', ready = true }) {
  const { search } = useLocation()
  const enabled = Boolean(refValue) && ready && analyticsEnabled && audience !== 'pm' && !new URLSearchParams(search).has('notrack')
  const viewed = useRef(false)
  const track = useCallback((type, { cardId = null, platform = null } = {}) => {
    if (!enabled) return undefined
    return trackLandingEvent(refValue, type, { cardId, platform, nodeId })
  }, [enabled, refValue, nodeId])
  useEffect(() => {
    if (enabled && !viewed.current) {
      viewed.current = true
      track('tab_view')
    }
  }, [enabled, track])
  return track
}
