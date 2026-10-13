const KEY = 'athar.area'

/** Remembered area for multi-role users (a per-viewer convenience only; never an authority). */
export function readLastArea() {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeLastArea(area) {
  try {
    window.localStorage.setItem(KEY, area)
  } catch {
    /* ignore */
  }
}
