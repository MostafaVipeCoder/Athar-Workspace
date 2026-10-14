import { registerMessages } from '../../../i18n/core.js'

registerMessages('alumni.admin.picker', {
  en: {
    label: 'Find a company', placeholder: 'Type a company name', none: 'No company found.', candidate: 'not an alumni yet',
    count: { one: '{count} company found', other: '{count} companies found' },
  },
  ar: {
    label: 'ابحث عن شركة', placeholder: 'اكتب اسم الشركة', none: 'لم يتم العثور على شركة.', candidate: 'ليست من الخريجين بعد',
    count: { zero: 'لا توجد شركات', one: 'تم العثور على شركة', two: 'تم العثور على شركتين', few: 'تم العثور على {count} شركات', many: 'تم العثور على {count} شركة', other: 'تم العثور على {count} شركة' },
  },
})
