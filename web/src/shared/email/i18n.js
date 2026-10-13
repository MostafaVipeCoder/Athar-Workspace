import { registerMessages } from '../../i18n/core.js'

registerMessages('email', {
  en: {
    'enabled': 'Enabled', 'subject': 'Subject', 'body': 'Body (plain text or HTML)', 'cc': 'CC addresses (comma separated)', 'admin': 'Admin copies (comma separated)',
    'lang.en': 'English', 'lang.ar': 'Arabic', 'placeholders': 'Placeholders', 'insert': 'Insert {key}', 'preview': 'Preview', 'previewHint': 'Rendered with sample values; what is queued uses the real booking.',
    'unknownPlaceholder': 'A template uses a placeholder that does not exist. Allowed: {list}.', 'badAddress': 'Check the CC / admin addresses.',
  },
  ar: {
    'enabled': 'مفعّل', 'subject': 'الموضوع', 'body': 'النص (نص عادي أو HTML)', 'cc': 'عناوين النسخة (مفصولة بفواصل)', 'admin': 'نسخ الإدارة (مفصولة بفواصل)',
    'lang.en': 'الإنجليزية', 'lang.ar': 'العربية', 'placeholders': 'المتغيرات', 'insert': 'إدراج {key}', 'preview': 'معاينة', 'previewHint': 'تُعرض بقيم تجريبية؛ ما يُرسل فعلياً يستخدم بيانات الحجز الحقيقية.',
    'unknownPlaceholder': 'يستخدم القالب متغيراً غير موجود. المسموح: {list}.', 'badAddress': 'راجع عناوين النسخ / الإدارة.',
  },
})
