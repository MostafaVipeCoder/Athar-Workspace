import { defineNode, inPort, outPort } from '../_kit/defineNode.js'
import { defaultSelectionConfig } from './selectionConfig.js'

/**
 * Selection Process node (design 01 section 3.4, 02 section 7, 04 section 3.5; decisions 01-4 two stages = two nodes
 * chained by an edge, 01-12 three v1 e-mails, 01-15 tokenised interview link, 01-16 displayed -> accepted).
 * A stage is a list with a pipeline overlay: applicants are REFERENCES (form responses or an upstream stage's accepted
 * items, always pointing at the ORIGINAL response) read through `resolve_list`; the stage's own facts are
 * `list_items.status` (stage key), `selection_reviews` (reason / origin / reviewer) and `selection_scores` (per reviewer).
 * Output ports resolve to ListItemView[] filtered by the configured stages (`data.js`); `results-tab` is the optional
 * view (accepted applicants) a host page can show. Ports mirror the `node_types.selection` row (m02).
 */
const company = { kind: 'company' }
const resolver = (name) => ({ ...company, resolve: () => import('./data.js').then((m) => m[name]) })

export default defineNode({
  key: 'selection',
  version: 1,
  name: { en: 'Selection process', ar: 'عملية الاختيار' },
  icon: 'selection',
  category: 'data',
  defaultConfig: defaultSelectionConfig,
  configSchema: { type: 'object', properties: { stages: { type: 'array' }, passing: { type: 'array' }, participantRule: { type: 'object' }, emails: { type: 'object' }, interviewBooking: { type: 'object' }, card: { type: 'object' } } },
  ports: {
    in: [inPort('applicants', ['rows:form-response', 'rows:list-item'], { en: 'Applicants', ar: 'المتقدمون' }, { required: true })],
    out: [
      outPort('approved', ['rows:list-item'], { en: 'Approved', ar: 'المقبولون' }, resolver('resolveApproved')),
      outPort('rejected', ['rows:list-item'], { en: 'Rejected', ar: 'المرفوضون' }, resolver('resolveRejected')),
      outPort('holding', ['rows:list-item'], { en: 'On hold', ar: 'قيد الانتظار' }, resolver('resolveHolding')),
      outPort('interview', ['rows:list-item'], { en: 'Interview', ar: 'المقابلة' }, resolver('resolveInterview')),
      outPort('all', ['rows:list-item'], { en: 'All', ar: 'الجميع' }, resolver('resolveAll')),
      outPort('results-tab', ['view'], { en: 'Results tab', ar: 'تبويب النتائج' }),
    ],
  },
  contributesViews: [{ key: 'results-tab', title: { en: 'Accepted', ar: 'المقبولون' }, component: () => import('./ResultsTab.jsx') }],
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  emails: [
    { key: 'acceptance', trigger: 'manual', templateFields: ['founder_name', 'first_name', 'company_name', 'program_name', 'project_name', 'project_manager_name'] },
    { key: 'rejection', trigger: 'manual', templateFields: ['founder_name', 'first_name', 'company_name', 'program_name', 'project_name', 'project_manager_name'] },
    { key: 'interview', trigger: 'manual', templateFields: ['founder_name', 'first_name', 'company_name', 'program_name', 'project_name', 'project_manager_name', 'booking_link'] },
  ],
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['selection_reviews', 'selection_scores'],
})
