import { defineNode, inPort } from '../_kit/defineNode.js'
import { defaultCertConfig } from './certConfig.js'

/**
 * Certificates node (design 01 section 3.10, 04 section 3.13, 07 section 4, decisions 01-11 / 06-5 / 07-8 / 07-9): the PM uploads a
 * certificate template (PNG / JPEG), places variables on it (fractional coordinates), and issues certificates, with ONE explicit
 * action, to the `attended` participants of the project once the project is marked completed. Certificates are RENDERED on demand in
 * the browser canvas (PDF libraries cannot shape Arabic) and never stored; the issued record (code + snapshot) is server side, the
 * public verifier is `/verify/:code` (a minimal anon RPC). One template per language (the node `language`).
 * Ports: `participants` is optional and unused today (nothing emits `rows:participant`): the node reads the project's participants
 * (data/participants + the Issue panel RPC). No out ports yet; the founder block is `FounderCertificateButton`.
 */
export default defineNode({
  key: 'certificates',
  version: 1,
  name: { en: 'Certificates', ar: 'الشهادات' },
  icon: 'certificate',
  category: 'content',
  singleton: false,
  defaultConfig: defaultCertConfig,
  configSchema: { type: 'object', properties: { language: { type: 'string' }, verifier: { type: 'object' } } },
  ports: {
    in: [inPort('participants', ['rows:participant'], { en: 'Participants', ar: 'المشاركون' }, { cardinality: 'one', required: false })],
    out: [],
  },
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['certificates', 'certificate_templates', 'certificate_template_fields'],
})
