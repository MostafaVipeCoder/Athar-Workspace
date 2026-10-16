/** Query-key factory (design 06 section 5.2). Every key starts with a stable domain root so prefixes can be invalidated. */
export const keys = {
  session: () => ['session'],
  roles: (userId) => ['roles', userId],
  profile: (userId) => ['profile', userId],

  programs: () => ['programs'],
  program: (id) => ['programs', id],
  projects: (programId = 'all') => ['projects', programId],
  project: (id) => ['project', id],

  graph: (projectId) => ['graph', projectId],
  graphRevisions: (projectId) => ['graph', projectId, 'revisions'],
  nodeTypes: () => ['nodeTypes'],

  node: (id) => ['node', id],
  nodeRow: (id) => ['node', id, 'row'],
  nodeOut: (id, port) => ['node', id, 'out', port],
  nodeIn: (id, port) => ['node', id, 'in', port],
  // lists (step 7): everything under ['node', id] so a revision change / save invalidates it in one go
  listMeta: (id) => ['node', id, 'listMeta'],
  listItems: (id, filter = {}) => ['node', id, 'items', filter],
  viewLink: (id) => ['node', id, 'viewLink'],
  // form builder (step 7b): definition/responses/link/events under ['node', id]; covers/templates per project
  formDef: (id) => ['node', id, 'form'],
  formResponses: (id) => ['node', id, 'responses'],
  formLink: (id) => ['node', id, 'formLink'],
  formEvents: (id) => ['node', id, 'events'],
  formCovers: (projectId) => ['formCovers', projectId],
  formTemplates: (projectId) => ['formTemplates', projectId],
  // agenda (step 7c): definition/link under ['node', id]; the project page link per project; founder exposure per project
  agendaDef: (id) => ['node', id, 'agenda'],
  agendaLink: (id) => ['node', id, 'agendaLink'],
  projectLink: (projectId) => ['projectLink', projectId],
  founderAgendas: (projectId) => ['founderAgendas', projectId],
  // selection (step 7d): reviews/scores/outbox/participants of a stage under ['node', id]; participants per project
  selectionExtras: (id) => ['node', id, 'selectionExtras'],
  participants: (projectId) => ['participants', projectId],
  // booking (step 7e): settings/providers/slots/bookings in ONE admin payload + the queue/outbox extras + the public link
  bookingAdmin: (id) => ['node', id, 'bookingAdmin'],
  bookingExtras: (id) => ['node', id, 'bookingExtras'],
  bookingLink: (id) => ['node', id, 'bookingLink'],
  publicBooking: (ref, host, invite) => ['public', 'booking', ref, host ?? null, invite ?? null],
  // calendar sync (m63): the per-booking sync state of a booking node (under ['node', id]: a node refresh reloads it) + the platform-wide mode flag
  calendarSync: (id) => ['node', id, 'calendarSync'],
  calendarSyncMode: () => ['calendarSync', 'mode'],
  // distribution (step 7f): PM payload/rules/timer/links under ['node', id]; public matrix/live payloads + the live timer poll per ref
  distPayload: (id) => ['node', id, 'distPayload'],
  distRules: (id) => ['node', id, 'distRules'],
  distTimer: (id) => ['node', id, 'distTimer'],
  distLinks: (id) => ['node', id, 'distLinks'],
  publicDistribution: (ref, viewKey) => ['public', 'distribution', ref, viewKey],
  publicDistTimer: (ref) => ['public', 'distTimer', ref],
  // landing page (step 7g): definition rows / link / analytics under ['node', id]; the public page payload per ref
  landingDef: (id) => ['node', id, 'landing'],
  landingLink: (id) => ['node', id, 'landingLink'],
  landingAnalytics: (id, days) => ['node', id, 'landingAnalytics', days ?? 90],
  publicLanding: (ref) => ['public', 'landing', ref],
  founderLandings: (projectId) => ['founderLandings', projectId],
  // library (step 7g): definition/link under ['node', id]; signed file URLs per path set; public payload per ref; founder exposure per project
  libraryDef: (id) => ['node', id, 'library'],
  libraryLink: (id) => ['node', id, 'libraryLink'],
  librarySigned: (paths) => ['library', 'signed', paths],
  publicLibrary: (ref) => ['public', 'library', ref],
  founderLibraries: (projectId) => ['founderLibraries', projectId],
  // certificates (step 7h): template definition + the Issue panel under ['node', id]; the founder's own certificates per project; the public verifier per code
  certificateDef: (id) => ['node', id, 'certificateDef'],
  certificatesAdmin: (id) => ['node', id, 'certificatesAdmin'],
  certificatePayload: (id) => ['certificate', 'payload', id],
  myCertificates: (projectId) => ['myCertificates', projectId],
  publicCertificate: (code) => ['public', 'certificate', String(code ?? '').toUpperCase()],
  // founder platform (step 8): the Programs list, one Program page and the lazy payload of a block
  myPrograms: () => ['myPrograms'],
  founderProgram: (projectId) => ['founderProgram', projectId],
  founderBlock: (projectId, type, nodeId) => ['founderProgram', projectId, 'block', type, nodeId],
  // public, read-only payloads keyed by the ref the visitor used
  publicList: (ref) => ['public', 'list', ref],
  publicTab: (ref, edgeId) => ['public', 'tab', ref, edgeId ?? 'agenda'],
  publicForm: (ref) => ['public', 'form', ref],
  agendaView: (ref) => ['public', 'agenda', ref],

  // Athar Network / companies registry (data/people.js)
  experts: (filter = {}) => ['experts', filter],
  expert: (id) => ['experts', 'one', id],
  // the experts REGISTRY (m75 - m77): everything under ['experts'] so ONE invalidation after a write refreshes the list, the profile, the tags and the duplicate finder
  expertRegistry: (state, lang) => ['experts', 'registry', lang, state],
  expertProfile: (id) => ['experts', 'profile', id],
  expertTags: (includeArchived = false) => ['experts', 'tags', includeArchived],
  expertSimilar: (args) => ['experts', 'similar', args],
  expertPairs: () => ['experts', 'pairs'],
  expertMerges: (id) => ['experts', 'merges', id ?? 'all'],
  companies: (filter = {}) => ['companies', filter],
  company: (id) => ['companies', 'one', id],

  // Google connection of the acting user (m61): status of mine + the system sender; the super_admin overview
  googleStatus: () => ['google', 'status'],
  googleAdmin: () => ['google', 'admin'],

  // e-mail Outbox (m62): every key starts with ['outbox', projectId] so ONE invalidation refreshes the list, the counts and the node badges of a project
  outbox: (projectId, filter = {}) => ['outbox', projectId, 'list', filter],
  outboxCounts: (projectId) => ['outbox', projectId, 'counts'],
  outboxItem: (id) => ['outbox', 'item', id],
  emailHealth: () => ['emailHealth'],
  staffInvitationDelivery: () => ['staff', 'invitationDelivery'],

  staff: () => ['staff'],
  staffInvitations: () => ['staff', 'invitations'],
  staffInvitation: (token) => ['staffInvitation', token],
}
