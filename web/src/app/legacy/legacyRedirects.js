/**
 * The single legacy-redirect table (design 06 section 2.7). Old shared links already exist in the field, so old shapes
 * redirect (replace-history) instead of 404. Assumption: project id = former event id (db/ preserves ids, decision 04-8).
 *
 * `to(params, search)` returns the new path. `module: true` rules go through LegacyModuleRedirect, which finds the node of
 * the matching type in the project. Most targets are real; entries marked STUB point to the nearest new page until the
 * feature exists (the route in the new table is a placeholder).
 */

/** Old module path segment -> node type key. */
export const MODULE_TO_NODE_TYPE = {
  agenda: 'agenda',
  forms: 'form_builder',
  experts: 'list',
  startups: 'list',
  lists: 'list',
  selection: 'selection',
  library: 'library',
  'join-athar': 'landing_page',
  'mentor-booking': 'booking',
  'ather-team-booking': 'booking',
  'mentoring-distribution': 'distribution',
}

/** Old public view tab -> new agenda tab key. */
const VIEW_TAB = { experts: 'experts', startups: 'companies', library: 'library', 'join-athar': 'landing' }

export const legacyRules = [
  // public agenda / views
  { pattern: '/view/:id/experts', to: ({ id }) => `/agenda/${id}/${VIEW_TAB.experts}` },
  { pattern: '/view/:id/startups', to: ({ id }) => `/agenda/${id}/${VIEW_TAB.startups}` },
  { pattern: '/view/:id/library', to: ({ id }) => `/agenda/${id}/${VIEW_TAB.library}` },
  { pattern: '/view/:id/join-athar', to: ({ id }) => `/agenda/${id}/${VIEW_TAB['join-athar']}` },
  // the old shared links were /view/<event id>/mentoring/matrix|live; the event id is the project id and get_distribution_view resolves it to that project's link
  { pattern: '/view/:id/mentoring/:view', to: ({ id, view }) => (view === 'live' ? `/view/${id}/live` : `/view/${id}/matrix`) },
  // staff event pages
  { pattern: '/event/:id', to: ({ id }) => `/projects/${id}` },
  { pattern: '/events/:id', to: ({ id }) => `/projects/${id}` },
  { pattern: '/event/:id/mentor-booking/:mentorId', module: 'mentor-booking' },
  { pattern: '/events/:id/mentor-booking/:mentorId', module: 'mentor-booking' },
  { pattern: '/event/:id/:module', moduleParam: 'module' },
  { pattern: '/events/:id/:module', moduleParam: 'module' },
  // forms: every old shape collapses to /forms/:ref
  { pattern: '/events/:id/register/company', to: ({ id }) => `/agenda/${id}` }, // STUB: old fixed company portal; the form id is looked up in step 7
  { pattern: '/events/:id/register/expert', to: ({ id }) => `/agenda/${id}` }, // STUB
  { pattern: '/events/:id/register/form/:formId', to: ({ formId }) => `/forms/${formId}` },
  { pattern: '/events/:id/form/:formId', to: ({ formId }) => `/forms/${formId}` },
  { pattern: '/forms/:eventId/:formId', to: ({ formId }) => `/forms/${formId}` },
  // booking: old ids are provider/member ids; resolved by lookup in step 7 (STUB: carried as legacy refs)
  { pattern: '/book/:mentorId', to: ({ mentorId }) => `/book/legacy/${mentorId}` },
  { pattern: '/ather-team-book/:memberId', to: ({ memberId }) => `/book/legacy/${memberId}?kind=team` },
  // auth
  { pattern: '/alumni/login', to: () => '/login' },
  { pattern: '/alumni/signin', to: () => '/login' },
  { pattern: '/alumni/signup', to: (_p, search) => { const t = new URLSearchParams(search).get('token'); return t ? `/invite/${encodeURIComponent(t)}` : '/signup' } },
  // certificates + registries renamed
  { pattern: '/verify-certificate/:code', to: ({ code }) => `/verify/${code}` },
  { pattern: '/verify-certificate', to: () => '/verify' },
  { pattern: '/experts', to: () => '/network/experts' },
  { pattern: '/companies', to: () => '/network/companies' },
  { pattern: '/forms-library', to: () => '/form-library' },
]

/**
 * Boot shim: BEFORE React mounts, rewrite hash-router URLs (`/#/agenda/:id?lang`) and `?agenda=:id&...` share links
 * to path form. Pure: returns the new "path+search+hash" or null when nothing needs rewriting.
 */
export function rewriteLegacyLocation({ pathname = '/', search = '', hash = '' }) {
  if (hash.startsWith('#/')) {
    const rest = hash.slice(1) // '/agenda/x?lang=ar'
    const [p, q = ''] = rest.split('?')
    const merged = new URLSearchParams(search)
    new URLSearchParams(q).forEach((v, k) => merged.set(k, v))
    const qs = merged.toString()
    return `${p}${qs ? `?${qs}` : ''}`
  }
  const params = new URLSearchParams(search)
  const agenda = params.get('agenda')
  if (agenda && (pathname === '/' || pathname === '')) {
    params.delete('agenda')
    const qs = params.toString()
    return `/agenda/${agenda}${qs ? `?${qs}` : ''}`
  }
  return null
}

/** Runs the shim against window.location with history.replaceState (called once from main.jsx). */
export function applyBootShim(win = window, base = '/') {
  const prefix = String(base).replace(/\/+$/, '')
  const pathname = win.location.pathname.startsWith(prefix) ? win.location.pathname.slice(prefix.length) || '/' : win.location.pathname
  const target = rewriteLegacyLocation({ pathname, search: win.location.search, hash: win.location.hash })
  if (target) win.history.replaceState(null, '', `${prefix}${target}`)
  return target
}
