import { lazy } from 'react'
import { MODE_COMPONENT, validateManifest } from './manifest.contract.js'
import agenda from './agenda/manifest.js'
import booking from './booking/manifest.js'
import certificates from './certificates/manifest.js'
import distribution from './distribution/manifest.js'
import formBuilder from './form-builder/manifest.js'
import landingPage from './landing-page/manifest.js'
import library from './library/manifest.js'
import list from './list/manifest.js'
import selection from './selection/manifest.js'
import viewHost from './view-host/manifest.js'
import devManifests from './devManifests.js'

/**
 * Registry of manifests (eager, tiny) + memoised React.lazy wrappers (stable component identity per type+mode,
 * design 06 section 4.3). `createRegistry` is a factory so tests can build isolated registries.
 */
export function createRegistry(manifests, { validate = import.meta.env?.DEV } = {}) {
  const byKey = new Map()
  for (const m of manifests) {
    if (validate) {
      const errors = validateManifest(m)
      if (errors.length) throw new Error(`Invalid node manifest:\n${errors.join('\n')}`)
    }
    if (byKey.has(m.key)) throw new Error(`Duplicate node type "${m.key}"`)
    byKey.set(m.key, m)
  }
  const lazyCache = new Map()

  return {
    get: (key) => byKey.get(key) ?? null,
    has: (key) => byKey.has(key),
    keys: () => [...byKey.keys()],
    /** Types a PM can add from the sidebar: no system nodes; dev types only in dev builds. */
    list: ({ includeSystem = false, includeDev = import.meta.env?.DEV } = {}) =>
      [...byKey.values()].filter((m) => (includeSystem || m.category !== 'system') && (includeDev || m.category !== 'dev')),
    /** Sidebar groups by category, in a stable order. */
    groups(options) {
      const order = ['data', 'content', 'operations', 'system', 'dev']
      const buckets = new Map()
      for (const m of this.list(options)) buckets.set(m.category, [...(buckets.get(m.category) ?? []), m])
      return order.filter((c) => buckets.has(c)).map((category) => ({ category, items: buckets.get(category) }))
    },
    /** The lazy component for (type, mode). Same function object on every call. */
    getComponent(type, mode) {
      const manifest = byKey.get(type)
      const slot = MODE_COMPONENT[mode]
      if (!manifest || !slot) return null
      const id = `${type}:${mode}`
      if (!lazyCache.has(id)) lazyCache.set(id, lazy(manifest.components[slot]))
      return lazyCache.get(id)
    },
  }
}


export const registry = createRegistry([agenda, booking, certificates, distribution, formBuilder, landingPage, library, list, selection, viewHost, ...devManifests])
