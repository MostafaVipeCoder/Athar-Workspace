import { removeImage } from '../../data/storage.js'
import { removeFiles } from '../../data/landing.js'
import { normalizeLandingConfig } from './landingLogic.js'

/**
 * Storage housekeeping of the builder. Images are uploaded the moment they are chosen (so a preview exists), but the page only references
 * them after Save: files a saved page no longer references - replaced / removed covers, removed frames, uploads that were never kept -
 * are deleted after a successful Save (best effort; a missing file is not an error). Pure path maths + one delete call.
 */
export function pathsOf(config, { cards = [], frames = [] } = {}) {
  const c = normalizeLandingConfig(config)
  const set = new Set()
  if (c.hero.coverPath) set.add(c.hero.coverPath)
  if (c.seo.imagePath) set.add(c.seo.imagePath)
  for (const card of cards) if (card.cover) set.add(card.cover)
  for (const f of frames) if (f.path) set.add(f.path)
  return set
}

/** Paths that were referenced before (or uploaded in this session) and are not referenced by the state just saved. */
export function orphanPaths(before, uploaded, after) {
  return [...new Set([...before, ...uploaded])].filter((p) => !after.has(p))
}

/**
 * Frames saved before m41 are single `.png` files (removed one by one); everything else is WebP: covers have a `_t` thumbnail and frames
 * do not, and `data/storage.removeImage` removes the file and its thumbnail, tolerating a missing one.
 */
export async function deleteOrphans(paths) {
  const frames = paths.filter((p) => /\.png$/i.test(p))
  const images = paths.filter((p) => !/\.png$/i.test(p))
  await Promise.all([
    frames.length ? removeFiles(frames).catch(() => {}) : null,
    ...images.map((p) => removeImage(p).catch(() => {})),
  ])
}
