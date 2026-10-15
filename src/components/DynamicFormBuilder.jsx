import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, AlertCircle, PenLine } from 'lucide-react';

const isArabicText = (text) => /[\u0600-\u06FF]/.test(text || '');

/**
 * DynamicFormBuilder Component
 * Language-agnostic respondent form renderer with native bidirectional RTL/LTR support (dir="auto").
 */
const DynamicFormBuilder = ({ fields = [], values = {}, onChange, errors = {}, onFileUpload }) => {
    const [uploadingFields, setUploadingFields] = useState({});
    const [otherTextValues, setOtherTextValues] = useState({});
    const [searchParams] = useSearchParams();

    // Pre-fill any fields whose field_name matches a URL search param
    useEffect(() => {
        if (!fields.length) return;
        if (!searchParams.toString()) return;

        const prefilled = {};
        fields.forEach(field => {
            const paramValue = searchParams.get(field.field_name);
            if (paramValue !== null) {
                prefilled[field.field_name] = paramValue;
            }
        });

        if (Object.keys(prefilled).length > 0) {
            onChange({ ...values, ...prefilled });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fields]);

    const handleFieldChange = (fieldName, value) => {
        onChange({ ...values, [fieldName]: value });
    };

    // When respondent picks "Other" and types custom text,
    // we store the custom text directly as the field value.
    const handleOtherTextChange = (fieldName, text, isMulti = false) => {
        setOtherTextValues(prev => ({ ...prev, [fieldName]: text }));
        if (isMulti) {
            // In multiselect, keep non-other values and append the custom text
            const current = Array.isArray(values[fieldName]) ? values[fieldName] : [];
            const withoutOther = current.filter(v => !String(v).startsWith('__other_text__:'));
            const next = text.trim()
                ? [...withoutOther, `__other_text__:${text}`]
                : withoutOther;
            onChange({ ...values, [fieldName]: next });
        } else {
            onChange({ ...values, [fieldName]: text ? `__other_text__:${text}` : '' });
        }
    };

    const handleFileChange = async (fieldName, file) => {
        if (!file || !onFileUpload) return;

        setUploadingFields(prev => ({ ...prev, [fieldName]: true }));
        try {
            const url = await onFileUpload(file);
            handleFieldChange(fieldName, url);
        } catch (error) {
            console.error('File upload error:', error);
        } finally {
            setUploadingFields(prev => ({ ...prev, [fieldName]: false }));
        }
    };

    const renderField = (field) => {
        const {
            field_name,
            field_label,
            field_label_ar,
            field_type,
            field_options = [],
            is_required,
            placeholder,
            placeholder_ar,
            help_text,
            help_text_ar,
            validation_rules: raw_validation_rules = {}
        } = field;

        const validation_rules = raw_validation_rules || {};
        const value = values[field_name] || '';
        const error = errors[field_name];
        const isUploading = uploadingFields[field_name];

        const displayLabel = field.field_label || field.field_label_ar || field.field_name;
        const displayPlaceholder = placeholder || placeholder_ar || '';
        const displayDescription = field.description || help_text || help_text_ar || validation_rules?.description || '';
        const isFieldRtl = isArabicText(displayLabel);

        const inputBaseClasses = 'w-full px-4 py-3.5 rounded-2xl border-2 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-100 text-slate-800 text-sm';
        const inputClasses = error
            ? `${inputBaseClasses} border-red-300 focus:border-red-500 bg-red-50/20`
            : `${inputBaseClasses} border-slate-200 focus:border-blue-500 bg-white`;

        const renderLabel = () => (
            <div className="mb-2" dir="auto">
                <label
                    htmlFor={field_name}
                    className="block text-sm sm:text-base font-bold text-slate-900 leading-snug cursor-pointer"
                >
                    <span>{displayLabel}</span>
                    {is_required && <span className="text-red-500 ms-1 font-black">*</span>}
                </label>
                {displayDescription && (
                    <p className="text-[11px] text-slate-500 font-normal mt-1 leading-relaxed whitespace-pre-line">
                        {displayDescription}
                    </p>
                )}
            </div>
        );

        const renderError = () => error && (
            <div dir="auto" className="flex items-center gap-1.5 text-xs font-semibold text-red-600 mt-2">
                <AlertCircle size={13} className="shrink-0" />
                <span>{error}</span>
            </div>
        );

        const renderHelp = () => null;

        switch (field_type) {
            case 'hidden':
                return (
                    <input
                        key={field_name}
                        type="hidden"
                        name={field_name}
                        value={value}
                        readOnly
                    />
                );

            case 'text':
            case 'email':
            case 'url':
            case 'tel':
            case 'number':
                return (
                    <div key={field_name}>
                        {renderLabel()}
                        <input
                            id={field_name}
                            type={field_type}
                            value={value}
                            dir="auto"
                            onChange={(e) => handleFieldChange(field_name, e.target.value)}
                            placeholder={displayPlaceholder}
                            className={inputClasses}
                            required={is_required}
                            {...(validation_rules.minLength && { minLength: validation_rules.minLength })}
                            {...(validation_rules.maxLength && { maxLength: validation_rules.maxLength })}
                            {...(validation_rules.pattern && { pattern: validation_rules.pattern })}
                        />
                        {renderHelp()}
                        {renderError()}
                    </div>
                );

            case 'textarea':
                return (
                    <div key={field_name}>
                        {renderLabel()}
                        <textarea
                            id={field_name}
                            value={value}
                            dir="auto"
                            onChange={(e) => handleFieldChange(field_name, e.target.value)}
                            placeholder={displayPlaceholder}
                            className={`${inputClasses} min-h-[120px] resize-y`}
                            required={is_required}
                            {...(validation_rules.minLength && { minLength: validation_rules.minLength })}
                            {...(validation_rules.maxLength && { maxLength: validation_rules.maxLength })}
                        />
                        {renderHelp()}
                        {renderError()}
                    </div>
                );

            case 'select': {
                const otherOption = field_options.find(o => o?.is_other);
                const isOtherSelected = value === '__other__' || String(value).startsWith('__other_text__:');
                const otherTextCurrent = otherTextValues[field_name] || (isOtherSelected ? String(value).replace('__other_text__:', '') : '');

                return (
                    <div key={field_name}>
                        {renderLabel()}
                        <select
                            id={field_name}
                            value={isOtherSelected ? '__other__' : value}
                            dir="auto"
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__other__') {
                                    setOtherTextValues(prev => ({ ...prev, [field_name]: '' }));
                                    handleFieldChange(field_name, '__other__');
                                } else {
                                    setOtherTextValues(prev => ({ ...prev, [field_name]: '' }));
                                    handleFieldChange(field_name, v);
                                }
                            }}
                            className={inputClasses}
                            required={is_required}
                        >
                            <option value="" dir="auto">
                                {displayPlaceholder || (isFieldRtl ? 'اختر خياراً...' : 'Select an option...')}
                            </option>
                            {field_options.map((option) => {
                                const optVal = option?.value !== undefined ? option.value : option;
                                const optLabel = option?.label || option?.label_ar || option || '';
                                return (
                                    <option key={String(optVal)} value={optVal} dir="auto">
                                        {optLabel}
                                    </option>
                                );
                            })}
                        </select>

                        {/* Free-text input when "Other" is selected */}
                        {otherOption && isOtherSelected && (
                            <div className="mt-2.5 flex items-center gap-2" dir="auto">
                                <PenLine size={15} className="text-amber-500 shrink-0" />
                                <input
                                    type="text"
                                    value={otherTextCurrent}
                                    autoFocus
                                    dir="auto"
                                    onChange={(e) => handleOtherTextChange(field_name, e.target.value)}
                                    placeholder={isFieldRtl ? 'اكتب إجابتك هنا...' : 'Please specify...'}
                                    className={`${inputClasses} border-amber-300 focus:border-amber-500 bg-amber-50/30 focus:ring-amber-100`}
                                    required={is_required}
                                />
                            </div>
                        )}

                        {renderHelp()}
                        {renderError()}
                    </div>
                );
            }

            case 'multiselect': {
                const selectedValues = Array.isArray(value) ? value : [];
                const otherOption = field_options.find(o => o?.is_other);
                const isOtherChecked = selectedValues.includes('__other__') ||
                    selectedValues.some(v => String(v).startsWith('__other_text__:'));
                const otherTextCurrent = otherTextValues[field_name] ||
                    (selectedValues.find(v => String(v).startsWith('__other_text__:')) || '').replace('__other_text__:', '');

                return (
                    <div key={field_name}>
                        {renderLabel()}
                        <div className="space-y-2.5 pt-1">
                            {field_options.map((option) => {
                                const optionValue = option?.value !== undefined ? option.value : option;
                                const optionLabel = option?.label || option?.label_ar || option;
                                const isOther = !!option?.is_other;
                                const isChecked = isOther
                                    ? isOtherChecked
                                    : selectedValues.includes(optionValue);

                                return (
                                    <div key={String(optionValue)}>
                                        <label
                                            dir="auto"
                                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer group ${
                                                isOther
                                                    ? 'border-amber-200 hover:border-amber-400 hover:bg-amber-50/40 bg-amber-50/20'
                                                    : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50/70'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                    if (isOther) {
                                                        const withoutOther = selectedValues.filter(
                                                            v => v !== '__other__' && !String(v).startsWith('__other_text__:')
                                                        );
                                                        if (e.target.checked) {
                                                            setOtherTextValues(prev => ({ ...prev, [field_name]: '' }));
                                                            handleFieldChange(field_name, [...withoutOther, '__other__']);
                                                        } else {
                                                            setOtherTextValues(prev => ({ ...prev, [field_name]: '' }));
                                                            handleFieldChange(field_name, withoutOther);
                                                        }
                                                    } else {
                                                        const newValues = e.target.checked
                                                            ? [...selectedValues, optionValue]
                                                            : selectedValues.filter(v => v !== optionValue);
                                                        handleFieldChange(field_name, newValues);
                                                    }
                                                }}
                                                className={`w-4 h-4 rounded border-slate-300 focus:ring-blue-500 ${
                                                    isOther ? 'text-amber-500' : 'text-blue-600'
                                                }`}
                                            />
                                            <span className={`text-xs sm:text-sm font-medium transition-colors ${
                                                isOther
                                                    ? 'text-amber-700 group-hover:text-amber-900'
                                                    : 'text-slate-700 group-hover:text-slate-900'
                                            }`}>
                                                {optionLabel}
                                            </span>
                                        </label>

                                        {/* Free-text input appears right under the Other option when checked */}
                                        {isOther && isChecked && (
                                            <div className="mt-1.5 flex items-center gap-2 ps-3" dir="auto">
                                                <PenLine size={14} className="text-amber-500 shrink-0" />
                                                <input
                                                    type="text"
                                                    value={otherTextCurrent}
                                                    autoFocus
                                                    dir="auto"
                                                    onChange={(e) => handleOtherTextChange(field_name, e.target.value, true)}
                                                    placeholder={isFieldRtl ? 'اكتب إجابتك هنا...' : 'Please specify...'}
                                                    className={`${inputClasses} border-amber-300 focus:border-amber-500 bg-amber-50/30 focus:ring-amber-100 py-2.5 text-sm`}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {renderHelp()}
                        {renderError()}
                    </div>
                );
            }

            case 'file':
                return (
                    <div key={field_name}>
                        {renderLabel()}
                        <div className="relative">
                            <input
                                id={field_name}
                                type="file"
                                onChange={(e) => handleFileChange(field_name, e.target.files[0])}
                                className="hidden"
                                accept="image/*,.pdf,.doc,.docx"
                                disabled={isUploading}
                            />
                            <label
                                htmlFor={field_name}
                                dir="auto"
                                className={`${inputClasses} flex items-center justify-center gap-3 cursor-pointer hover:bg-slate-50 border-dashed ${
                                    isUploading ? 'opacity-50 cursor-not-allowed' : ''
                                }`}
                            >
                                <Upload size={18} className="text-slate-400" />
                                <span className="text-slate-600 font-medium text-xs sm:text-sm">
                                    {isUploading
                                        ? (isFieldRtl ? 'جاري الرفع...' : 'Uploading...')
                                        : value
                                            ? (isFieldRtl ? 'تغيير الملف المحدد' : 'Change Selected File')
                                            : (isFieldRtl ? 'اختر ملفاً للرفع' : 'Choose File to Upload')}
                                </span>
                            </label>
                            {value && !isUploading && (
                                <div className="mt-2.5 flex items-center gap-2">
                                    <span className="text-xs text-emerald-600 font-bold">✓ Attached</span>
                                    <a
                                        href={value}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-600 underline font-medium truncate max-w-xs"
                                    >
                                        View Upload
                                    </a>
                                </div>
                            )}
                        </div>
                        {renderHelp()}
                        {renderError()}
                    </div>
                );

            default:
                return null;
        }
    };

    const sortedFields = [...fields].sort((a, b) =>
        (a.display_order || 0) - (b.display_order || 0)
    );

    return (
        <div>
            {sortedFields.map((field, idx) => {
                const isLast = idx === sortedFields.length - 1;
                return (
                    <div
                        key={field.field_name || idx}
                        className={isLast ? 'mb-2' : 'mb-6 pb-6 border-b border-slate-200/80'}
                    >
                        {renderField(field)}
                    </div>
                );
            })}
        </div>
    );
};

export default DynamicFormBuilder;
