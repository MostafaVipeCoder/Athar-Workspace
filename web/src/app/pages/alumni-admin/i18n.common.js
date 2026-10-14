import { registerMessages } from '../../../i18n/core.js'

/**
 * Words and sentences shared by the manager-side Alumni pages (namespace `alumni.admin.common`). Every page has its own lazy dictionary next to it; the vocabulary
 * LABELS (sector, stage, ...) are never here: they come from the database (list_alumni_lookups).
 */
registerMessages('alumni.admin.common', {
  en: {
    yes: 'Yes', no: 'No', all: 'All', none: 'None', notSet: 'Not set', other: 'Other', notSpecified: 'Not specified', dash: '—',
    loadFailed: 'This could not be loaded.', empty: 'Nothing to show.',
    open: 'Open', copy: 'Copy', copied: 'Copied', copyFailed: 'Could not copy automatically. Select the text and copy it by hand.',
    delete: 'Delete', add: 'Add', remove: 'Remove', edit: 'Edit', apply: 'Apply', reset: 'Reset', export: 'Export', download: 'Download', create: 'Create', send: 'Send', hide: 'Hide', show: 'Show',
    filters: 'Filters', columns: 'Columns', clearFilters: 'Clear filters', search: 'Search',
    selectedCount: { one: '{count} selected', other: '{count} selected' },
    range: '{from}-{to} of {total}', perPage: 'Rows per page', prev: 'Previous page', next: 'Next page', page: 'Page {page} of {pages}',
    egp: 'EGP', asOf: 'As of {date}', year: 'Year', language: 'Language', arabic: 'Arabic', english: 'English',
    'open.status': 'Open', 'closed.status': 'Closed',
    'review.never': 'Not reviewed', 'review.current': 'Reviewed', 'review.changed': 'Changed since review',
    'invStatus.pending': 'Pending', 'invStatus.accepted': 'Accepted', 'invStatus.expired': 'Expired', 'invStatus.revoked': 'Revoked',
    'derived.id': 'from the national ID', 'derived.self': 'self-declared', 'derived.company': 'company location',
    // errors (the shared tokens of data/errors.js are mapped here so the manager pages read the same everywhere)
    'err.field': '{field}: {reason}', 'err.invalid': 'Some of the data was refused.', 'err.stale': 'This company was changed by someone else. Reload it and apply your change again.',
    'err.notFound': 'This item no longer exists.', 'err.forbidden': 'You do not have permission to do this.', 'err.rateLimited': 'Too many attempts. Please wait a while.',
    'err.inUse': 'This value is used by companies. Deactivate it instead.', 'err.nidInvalid': 'The national ID is not valid.', 'err.nidConflict': 'This national ID already belongs to another founder.',
    'err.companyExists': 'A company with this name already exists. Use the merge action for duplicates.', 'err.opportunityClosed': 'This opportunity is not open for applications.',
    'reason.too_long': 'is too long', 'reason.unknown': 'is not a known value', 'reason.unknown_key': 'is not allowed', 'reason.bad_value': 'is not valid', 'reason.bad_url': 'must be a web address starting with http:// or https://',
    'reason.bad_date': 'is not a valid date', 'reason.future': 'cannot be in the future', 'reason.required': 'is required', 'reason.manager_only': 'is for managers only', 'reason.id_wins': 'cannot be typed while a national ID exists',
    'reason.parent_mismatch': 'does not belong to the chosen sector', 'reason.needs_sector': 'needs a sector first', 'reason.requires_closed': 'is only allowed for a closed company', 'reason.exceeds_total': 'cannot be more than the total',
    'reason.out_of_range': 'is out of range', 'reason.not_a_number': 'must be a number', 'reason.already_member': 'is already a member of this company', 'reason.closed_vocabulary': 'is a closed list',
    'reason.system_value': 'is a system value', 'reason.empty': 'has nobody to reach', 'reason.not_an_array': 'must be a list', 'reason.too_many': 'has too many entries', 'reason.not_an_object': 'is malformed',
    'reason.bad_email': 'is not a valid e-mail address', 'reason.negative': 'cannot be negative', 'reason.not_integer': 'must be a whole number', 'reason.not_a_boolean': 'must be yes or no',
  },
  ar: {
    yes: 'نعم', no: 'لا', all: 'الكل', none: 'لا شيء', notSet: 'غير محدد', other: 'أخرى', notSpecified: 'غير محدد', dash: '—',
    loadFailed: 'تعذّر تحميل هذه البيانات.', empty: 'لا يوجد ما يُعرض.',
    open: 'فتح', copy: 'نسخ', copied: 'تم النسخ', copyFailed: 'تعذّر النسخ تلقائياً. حدّد النص وانسخه يدوياً.',
    delete: 'حذف', add: 'إضافة', remove: 'إزالة', edit: 'تعديل', apply: 'تطبيق', reset: 'إعادة ضبط', export: 'تصدير', download: 'تنزيل', create: 'إنشاء', send: 'إرسال', hide: 'إخفاء', show: 'إظهار',
    filters: 'التصفية', columns: 'الأعمدة', clearFilters: 'مسح التصفية', search: 'بحث',
    selectedCount: { zero: 'لا شيء محدد', one: 'محدد واحد', two: 'محددان', few: '{count} محددة', many: '{count} محددة', other: '{count} محددة' },
    range: '{from}-{to} من {total}', perPage: 'عدد الصفوف في الصفحة', prev: 'الصفحة السابقة', next: 'الصفحة التالية', page: 'الصفحة {page} من {pages}',
    egp: 'جنيه', asOf: 'حتى {date}', year: 'السنة', language: 'اللغة', arabic: 'العربية', english: 'الإنجليزية',
    'open.status': 'مفتوحة', 'closed.status': 'مغلقة',
    'review.never': 'لم تُراجَع', 'review.current': 'تمت مراجعتها', 'review.changed': 'تغيّرت بعد المراجعة',
    'invStatus.pending': 'قيد الانتظار', 'invStatus.accepted': 'مقبولة', 'invStatus.expired': 'منتهية', 'invStatus.revoked': 'ملغاة',
    'derived.id': 'من الرقم القومي', 'derived.self': 'مُدخل ذاتياً', 'derived.company': 'موقع الشركة',
    'err.field': '{field}: {reason}', 'err.invalid': 'تم رفض بعض البيانات.', 'err.stale': 'عدّل شخص آخر هذه الشركة. أعد تحميلها ثم طبّق تعديلك مرة أخرى.',
    'err.notFound': 'لم يعد هذا العنصر موجوداً.', 'err.forbidden': 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', 'err.rateLimited': 'محاولات كثيرة. انتظر قليلاً.',
    'err.inUse': 'هذه القيمة مستخدمة في شركات. عطّلها بدلاً من حذفها.', 'err.nidInvalid': 'الرقم القومي غير صحيح.', 'err.nidConflict': 'هذا الرقم القومي مسجّل لمؤسس آخر.',
    'err.companyExists': 'توجد شركة بهذا الاسم بالفعل. استخدم الدمج للمكررات.', 'err.opportunityClosed': 'هذه الفرصة غير متاحة للتقديم.',
    'reason.too_long': 'أطول من المسموح', 'reason.unknown': 'قيمة غير معروفة', 'reason.unknown_key': 'غير مسموح به', 'reason.bad_value': 'قيمة غير صحيحة', 'reason.bad_url': 'يجب أن يكون رابطاً يبدأ بـ http:// أو https://',
    'reason.bad_date': 'تاريخ غير صحيح', 'reason.future': 'لا يمكن أن يكون في المستقبل', 'reason.required': 'مطلوب', 'reason.manager_only': 'للمديرين فقط', 'reason.id_wins': 'لا يمكن كتابته مع وجود رقم قومي',
    'reason.parent_mismatch': 'لا يتبع القطاع المختار', 'reason.needs_sector': 'يحتاج إلى اختيار القطاع أولاً', 'reason.requires_closed': 'مسموح للشركة المغلقة فقط', 'reason.exceeds_total': 'لا يمكن أن يزيد عن الإجمالي',
    'reason.out_of_range': 'خارج النطاق المسموح', 'reason.not_a_number': 'يجب أن يكون رقماً', 'reason.already_member': 'عضو بالفعل في هذه الشركة', 'reason.closed_vocabulary': 'قائمة مغلقة',
    'reason.system_value': 'قيمة نظامية', 'reason.empty': 'لا يوجد من يصله', 'reason.not_an_array': 'يجب أن يكون قائمة', 'reason.too_many': 'عدد العناصر أكبر من المسموح', 'reason.not_an_object': 'صيغة غير صحيحة',
    'reason.bad_email': 'بريد إلكتروني غير صحيح', 'reason.negative': 'لا يمكن أن يكون سالباً', 'reason.not_integer': 'يجب أن يكون عدداً صحيحاً', 'reason.not_a_boolean': 'يجب أن يكون نعم أو لا',
  },
})
