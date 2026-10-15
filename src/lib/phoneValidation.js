/**
 * Phone Number Validation and E.164 Sanitization Utility
 * Supports precision validation for Egypt (+20), Saudi Arabia (+966), UAE (+971), and global formats.
 */

export const SUPPORTED_COUNTRIES = [
    { code: 'EG', name: 'مصر (Egypt)', flag: '🇪🇬', dialCode: '+20' },
    { code: 'SA', name: 'السعودية (Saudi Arabia)', flag: '🇸🇦', dialCode: '+966' },
    { code: 'AE', name: 'الإمارات (UAE)', flag: '🇦🇪', dialCode: '+971' },
    { code: 'KW', name: 'الكويت (Kuwait)', flag: '🇰🇼', dialCode: '+965' },
    { code: 'QA', name: 'قطر (Qatar)', flag: '🇶🇦', dialCode: '+974' },
    { code: 'BH', name: 'البحرين (Bahrain)', flag: '🇧🇭', dialCode: '+973' },
    { code: 'OM', name: 'عمان (Oman)', flag: '🇴🇲', dialCode: '+968' },
    { code: 'JO', name: 'الأردن (Jordan)', flag: '🇯🇴', dialCode: '+962' }
];

/**
 * Strips all spaces, dashes, dots, and parentheses from a phone input
 */
export const cleanPhoneInput = (input = '') => {
    if (!input) return '';
    return String(input).trim().replace(/[\s\-\(\)\.]/g, '');
};

/**
 * Precision validator & sanitizer for Egyptian phone numbers
 */
export const validateAndSanitizeEgypt = (rawNumber) => {
    let cleaned = cleanPhoneInput(rawNumber);

    // Normalize international prefix: replace 0020 or +20 with standard base
    if (cleaned.startsWith('0020')) {
        cleaned = cleaned.slice(4);
    } else if (cleaned.startsWith('+20')) {
        cleaned = cleaned.slice(3);
    } else if (cleaned.startsWith('20') && cleaned.length >= 11) {
        cleaned = cleaned.slice(2);
    }

    // If starts with domestic '0', strip it to get the national number
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.slice(1);
    }

    // Must be numeric
    if (!/^\d+$/.test(cleaned)) {
        return {
            isValid: false,
            error: 'رقم الهاتف يجب أن يحتوي على أرقام فقط',
            sanitized: rawNumber
        };
    }

    // Mobile Validation (starts with 10, 11, 12, 15 and is exactly 10 digits without leading 0)
    const isMobile = /^(10|11|12|15)\d{8}$/.test(cleaned);
    if (isMobile) {
        return {
            isValid: true,
            error: null,
            sanitized: `+20${cleaned}`,
            type: 'mobile'
        };
    }

    // Landline Validation (e.g. Cairo 2 + 8 digits = 9 digits, Alexandria 3 + 7 digits = 8 digits, etc.)
    const isLandline = /^(2|3|13|40|45|46|47|48|50|55|57|62|64|65|66|68|69|82|84|86|88|92|93|95|96|97)\d{7,8}$/.test(cleaned);
    if (isLandline) {
        return {
            isValid: true,
            error: null,
            sanitized: `+20${cleaned}`,
            type: 'landline'
        };
    }

    // If length or prefix is invalid
    if (cleaned.startsWith('1')) {
        return {
            isValid: false,
            error: 'رقم المحمول المصري غير مكتمل أو يبدأ بكود غير صالح (المقبول: 010, 011, 012, 015)',
            sanitized: rawNumber
        };
    }

    return {
        isValid: false,
        error: 'رقم هاتف مصري غير صحيح. يرجى التأكد من كتابة الرقم بشكل صحيح (مثال: 01012345678)',
        sanitized: rawNumber
    };
};

/**
 * Validator & sanitizer for Saudi phone numbers (+966)
 */
export const validateAndSanitizeSaudi = (rawNumber) => {
    let cleaned = cleanPhoneInput(rawNumber);
    if (cleaned.startsWith('00966')) cleaned = cleaned.slice(5);
    else if (cleaned.startsWith('+966')) cleaned = cleaned.slice(4);
    else if (cleaned.startsWith('966') && cleaned.length >= 11) cleaned = cleaned.slice(3);

    if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);

    if (/^5\d{8}$/.test(cleaned)) {
        return {
            isValid: true,
            error: null,
            sanitized: `+966${cleaned}`,
            type: 'mobile'
        };
    }

    return {
        isValid: false,
        error: 'رقم الهاتف السعودي يجب أن يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0512345678)',
        sanitized: rawNumber
    };
};

/**
 * Validator & sanitizer for UAE phone numbers (+971)
 */
export const validateAndSanitizeUAE = (rawNumber) => {
    let cleaned = cleanPhoneInput(rawNumber);
    if (cleaned.startsWith('00971')) cleaned = cleaned.slice(5);
    else if (cleaned.startsWith('+971')) cleaned = cleaned.slice(4);
    else if (cleaned.startsWith('971') && cleaned.length >= 11) cleaned = cleaned.slice(3);

    if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);

    if (/^5\d{8}$/.test(cleaned)) {
        return {
            isValid: true,
            error: null,
            sanitized: `+971${cleaned}`,
            type: 'mobile'
        };
    }

    return {
        isValid: false,
        error: 'رقم الهاتف الإماراتي يجب أن يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0501234567)',
        sanitized: rawNumber
    };
};

/**
 * General fallback validator & sanitizer for other countries
 */
export const validateAndSanitizeGeneral = (rawNumber) => {
    let cleaned = cleanPhoneInput(rawNumber);
    if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
    else if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        return {
            isValid: true,
            error: null,
            sanitized: `+${digitsOnly}`
        };
    }

    return {
        isValid: false,
        error: 'يرجى إدخال رقم هاتف صالح متضمناً مفتاح الدولة',
        sanitized: rawNumber
    };
};

/**
 * Main phone validator matching configured allowed countries
 * @param {string} rawNumber - User input
 * @param {Array<string>} allowedCountries - Array of country codes e.g. ['EG', 'SA']
 */
export const validatePhoneNumber = (rawNumber, allowedCountries = []) => {
    if (!rawNumber || !String(rawNumber).trim()) {
        return { isValid: true, error: null, sanitized: '' };
    }

    const cleaned = cleanPhoneInput(rawNumber);

    // If no specific country configured or 'all', test against supported or general
    const countries = Array.isArray(allowedCountries) && allowedCountries.length > 0
        ? allowedCountries
        : ['EG', 'SA', 'AE'];

    // Check if it matches any of the allowed countries
    for (const c of countries) {
        if (c === 'EG') {
            const res = validateAndSanitizeEgypt(cleaned);
            if (res.isValid) return res;
        } else if (c === 'SA') {
            const res = validateAndSanitizeSaudi(cleaned);
            if (res.isValid) return res;
        } else if (c === 'AE') {
            const res = validateAndSanitizeUAE(cleaned);
            if (res.isValid) return res;
        }
    }

    // If allowedCountries contains only 1 country, return its specific error message
    if (countries.length === 1) {
        if (countries[0] === 'EG') return validateAndSanitizeEgypt(cleaned);
        if (countries[0] === 'SA') return validateAndSanitizeSaudi(cleaned);
        if (countries[0] === 'AE') return validateAndSanitizeUAE(cleaned);
    }

    // General fallback
    const generalRes = validateAndSanitizeGeneral(cleaned);
    if (generalRes.isValid) return generalRes;

    return {
        isValid: false,
        error: 'رقم الهاتف غير صالح للدول المحددة في النموذج',
        sanitized: rawNumber
    };
};
