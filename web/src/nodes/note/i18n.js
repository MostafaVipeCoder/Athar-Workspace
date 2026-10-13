import { registerMessages } from '../../i18n/core.js'

// Per-node dictionary, loaded together with the node's chunk (design 06 section 7.1).
registerMessages('note', {
  en: { label: 'Note text', inputs: 'Text from connected notes', noInputs: 'No connected notes', crash: 'Crash this node (error-isolation test)', crashed: 'Intentional crash for the error-isolation test' },
  ar: { label: 'نص الملاحظة', inputs: 'نصوص من ملاحظات متصلة', noInputs: 'لا توجد ملاحظات متصلة', crash: 'اجعل هذا العنصر ينهار (اختبار العزل)', crashed: 'انهيار مقصود لاختبار عزل الأخطاء' },
})
