import { useEffect, useState } from 'react'

/** A `Date` refreshed every `intervalMs` while mounted (30 s for "now/next" marks, 250 ms for the live countdown). No socket, no writes. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
