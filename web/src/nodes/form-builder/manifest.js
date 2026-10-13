import { defineNode, outPort } from '../_kit/defineNode.js'
import { defaultFormConfig } from './formLogic.js'

/**
 * Form Builder node (design 01 section 3.2, 04 section 3.7): questions/sections live in typed child tables (saved
 * atomically through save_node children), responses in `form_responses`, settings in `forms` + `nodes.config`.
 * Output `responses` is read by Lists/Selection through `resolveResponses` (rows:form-response; the schema with the
 * semantic roles travels with it); `link` resolves to the public URL for the Landing page. No input ports.
 */
export default defineNode({
  key: 'form_builder',
  version: 1,
  name: { en: 'Form', ar: 'نموذج' },
  icon: 'form',
  category: 'data',
  defaultConfig: defaultFormConfig,
  configSchema: { type: 'object', properties: { description: { type: 'object' }, thank_you: { type: 'object' }, social: { type: 'object' }, share: { type: 'object' }, notify_pm: { type: 'boolean' } } },
  ports: {
    in: [],
    out: [
      outPort('responses', ['rows:form-response'], { en: 'Responses', ar: 'الردود' }, { resolve: () => import('./data.js').then((m) => m.resolveResponses) }),
      outPort('link', ['link'], { en: 'Link', ar: 'الرابط' }, { resolve: () => import('./data.js').then((m) => m.resolveLink) }),
    ],
  },
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: false },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['forms', 'form_sections', 'form_questions', 'form_responses', 'form_covers', 'form_templates'],
})
