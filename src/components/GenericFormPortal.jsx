import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
    Loader, CheckCircle, AlertCircle, Share2, Copy,
    Facebook, MessageCircle, Linkedin, Send, Instagram,
    ExternalLink, Check, ChevronRight, ChevronLeft
} from 'lucide-react';
import {
    getEvent, getEventFormById, getFormConfigById, getFormSections,
    submitToForm, trackFormShareEvent, uploadImage
} from '../lib/api';
import { validatePhoneNumber } from '../lib/phoneValidation';
import { getGoogleDriveDirectLink, getAppBaseUrl } from '../lib/utils';
import DynamicFormBuilder from './DynamicFormBuilder';

const isArabicText = (text) => /[\u0600-\u06FF]/.test(text || '');

export default function GenericFormPortal() {
    const params = useParams();
    const eventId = params.eventId || params.id;
    const formId = params.formId;
    const [searchParams] = useSearchParams();

    const TRACKING_KEYS = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'channel', 'ref', 'from'];
    const trackingData = Object.fromEntries(
        TRACKING_KEYS.map(k => [k, searchParams.get(k)]).filter(([, v]) => v)
    );
    const sourceParam = searchParams.get('source') || searchParams.get('utm_source') || 'direct';

    const [formMeta, setFormMeta] = useState(null);
    const [event, setEvent] = useState(null);
    const [fields, setFields] = useState([]);
    const [sections, setSections] = useState([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [formValues, setFormValues] = useState({});
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);
    const [copiedShareLink, setCopiedShareLink] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                const [meta, fieldData, sectionData] = await Promise.all([
                    getEventFormById(formId),
                    getFormConfigById(formId),
                    getFormSections(formId).catch(() => [])
                ]);
                setFormMeta(meta);
                setSections(sectionData || []);

                try {
                    const eventData = await getEvent(eventId);
                    setEvent(eventData);

                    const eventName = eventData?.event_name || eventData?.event_name_ar;
                    const formName = meta?.form_name || meta?.form_name_ar;
                    if (eventName && formName) {
                        document.title = `${formName} | ${eventName}`;
                    } else if (formName) {
                        document.title = formName;
                    }
                } catch (e) {
                    console.error('Failed to load event metadata');
                }

                const visibleFields = (fieldData || []).filter(f => f.field_type !== 'hidden');
                setFields(visibleFields);

                const initial = {};
                (fieldData || []).forEach(f => {
                    const paramVal = searchParams.get(f.field_name);
                    initial[f.field_name] = paramVal || '';
                });
                setFormValues(initial);
            } catch (err) {
                console.error('Failed to load form portal:', err);
                setError('Form not found or unavailable.');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [formId, eventId]);

    // Build form steps based on sections and assigned questions
    const steps = useMemo(() => {
        if (!sections || sections.length === 0) {
            return [{
                id: 'all',
                title: '',
                description: '',
                fields: fields
            }];
        }

        const validSections = [...sections].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        const unassignedFields = fields.filter(f => !f.section_id || !validSections.some(s => s.id === f.section_id));

        const sectionSteps = validSections.map((sec, idx) => ({
            id: sec.id,
            title: sec.title || (isArabicText(formMeta?.form_name) ? `القسم ${idx + 1}` : `Section ${idx + 1}`),
            description: sec.description || '',
            fields: fields.filter(f => f.section_id === sec.id)
        }));

        if (unassignedFields.length > 0) {
            return [
                {
                    id: 'general',
                    title: isArabicText(formMeta?.form_name) ? 'البيانات الأساسية' : 'General Information',
                    description: '',
                    fields: unassignedFields
                },
                ...sectionSteps
            ];
        }

        return sectionSteps;
    }, [sections, fields, formMeta]);

    const isMultiStep = steps.length > 1;
    const currentStepData = steps[currentStep] || steps[0] || { fields: [] };
    const totalSteps = steps.length;
    const progressPercent = totalSteps > 0 ? Math.round(((currentStep + 1) / totalSteps) * 100) : 100;

    const validateFieldList = (fieldsToValidate) => {
        const errs = {};
        fieldsToValidate.forEach(field => {
            const val = formValues[field.field_name];
            const rules = field.validation_rules || {};
            const fieldLabel = field.field_label || field.field_label_ar || field.field_name;
            const isRtl = isArabicText(fieldLabel);
            const customErrMsg = rules.customError;

            // Required Check
            if (field.is_required && (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0))) {
                errs[field.field_name] = customErrMsg || (isRtl ? `حقل "${fieldLabel}" مطلوب` : `"${fieldLabel}" is required`);
                return;
            }

            if (val !== undefined && val !== null && val !== '') {
                // Phone Number Validation (E.164 and Country precision)
                if (field.field_type === 'tel' || field.field_name?.includes('phone') || field.field_name?.includes('mobile') || field.field_name === 'whatsapp') {
                    const phoneRes = validatePhoneNumber(val, rules.allowed_countries);
                    if (!phoneRes.isValid) {
                        errs[field.field_name] = customErrMsg || phoneRes.error;
                        return;
                    }
                }

                // Email validation
                if (field.field_type === 'email') {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(String(val).trim())) {
                        errs[field.field_name] = customErrMsg || (isRtl ? 'يرجى إدخال بريد إلكتروني صالح' : 'Please enter a valid email address');
                        return;
                    }
                }

                // Min/Max Length
                if (rules.minLength && String(val).length < Number(rules.minLength)) {
                    errs[field.field_name] = customErrMsg || (isRtl
                        ? `يجب ألا يقل عدد الحروف عن ${rules.minLength}`
                        : `Minimum length is ${rules.minLength} characters`);
                    return;
                }

                if (rules.maxLength && String(val).length > Number(rules.maxLength)) {
                    errs[field.field_name] = customErrMsg || (isRtl
                        ? `يجب ألا يتجاوز عدد الحروف ${rules.maxLength}`
                        : `Maximum length is ${rules.maxLength} characters`);
                    return;
                }

                // Number Min/Max Value
                if (field.field_type === 'number') {
                    const numVal = Number(val);
                    if (rules.minValue !== '' && rules.minValue !== undefined && numVal < Number(rules.minValue)) {
                        errs[field.field_name] = customErrMsg || (isRtl ? `أدنى قيمة مسموحة هي ${rules.minValue}` : `Minimum value is ${rules.minValue}`);
                        return;
                    }
                    if (rules.maxValue !== '' && rules.maxValue !== undefined && numVal > Number(rules.maxValue)) {
                        errs[field.field_name] = customErrMsg || (isRtl ? `أقصى قيمة مسموحة هي ${rules.maxValue}` : `Maximum value is ${rules.maxValue}`);
                        return;
                    }
                }
            }
        });

        return errs;
    };

    const handleNextStep = (e) => {
        if (e) e.preventDefault();
        const currentFields = currentStepData.fields || [];
        const stepErrs = validateFieldList(currentFields);

        if (Object.keys(stepErrs).length > 0) {
            setErrors(prev => ({ ...prev, ...stepErrs }));
            return;
        }

        // Clear current step errors
        setErrors(prev => {
            const next = { ...prev };
            currentFields.forEach(f => delete next[f.field_name]);
            return next;
        });

        if (currentStep < totalSteps - 1) {
            setCurrentStep(prev => prev + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handlePrevStep = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // If multi-step and not on the last step, clicking enter in an input should advance step
        if (isMultiStep && currentStep < totalSteps - 1) {
            handleNextStep(e);
            return;
        }

        const allErrors = validateFieldList(fields);
        if (Object.keys(allErrors).length > 0) {
            setErrors(allErrors);
            if (isMultiStep) {
                const firstErrorFieldName = Object.keys(allErrors)[0];
                const errorStepIndex = steps.findIndex(st => st.fields.some(f => f.field_name === firstErrorFieldName));
                if (errorStepIndex !== -1 && errorStepIndex !== currentStep) {
                    setCurrentStep(errorStepIndex);
                }
            }
            return;
        }

        try {
            setSubmitting(true);
            setError(null);

            const trackingMeta = {
                source: sourceParam,
                ...trackingData
            };

            await submitToForm(formId, eventId, formMeta.target_module, formValues, trackingMeta);
            setSubmitted(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            console.error('Submission error:', err);
            const isRtl = isArabicText(formMeta?.form_name);
            setError(isRtl ? 'حدث خطأ أثناء إرسال النموذج. يرجى المحاولة مرة أخرى.' : 'Error submitting form. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleFileUpload = async (file) => {
        return await uploadImage(file, 'portal-uploads');
    };

    const renderThankYouMessage = () => {
        const defaultMsg = isArabicText(formMeta?.form_name)
            ? 'شكراً لك! تم استلام طلبك بنجاح.'
            : 'Thank you! Your submission has been received successfully.';

        let rawMessage = formMeta?.thank_you_message || defaultMsg;

        let participantName = formValues.startup_name || formValues.expert_name || formValues.name || '';
        let companyName = formValues.company_name || formValues.startup_name || formValues.company || '';
        let email = formValues.email || formValues.founder_email || '';
        let phone = formValues.phone || formValues.mobile || '';

        if (!participantName) {
            const firstKey = Object.keys(formValues)[0];
            participantName = formValues[firstKey] || '';
        }

        rawMessage = rawMessage
            .replace(/\{اسم_المشارك\}/g, participantName)
            .replace(/\{اسم_الشركة\}/g, companyName || participantName)
            .replace(/\{البريد_الإلكتروني\}/g, email)
            .replace(/\{رقم_الهاتف\}/g, phone)
            .replace(/\{name\}/gi, participantName)
            .replace(/\{company\}/gi, companyName || participantName);

        fields.forEach(f => {
            const labelToken = `{${f.field_label}}`;
            if (rawMessage.includes(labelToken)) {
                rawMessage = rawMessage.replace(new RegExp(labelToken, 'g'), formValues[f.field_name] || '');
            }
        });

        return rawMessage;
    };

    const handleShareClick = async (platform) => {
        trackFormShareEvent(formId, platform);

        const shareUrl = `${getAppBaseUrl()}/#/forms/${eventId}/${formId}?source=${platform}`;
        const title = encodeURIComponent(formMeta?.share_title || formMeta?.form_name || 'Athar Form');

        let targetUrl = '';
        switch (platform) {
            case 'facebook':
                targetUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
                window.open(targetUrl, '_blank', 'width=600,height=400');
                break;
            case 'whatsapp':
                targetUrl = `https://api.whatsapp.com/send?text=${title}%20${encodeURIComponent(shareUrl)}`;
                window.open(targetUrl, '_blank');
                break;
            case 'linkedin':
                targetUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
                window.open(targetUrl, '_blank', 'width=600,height=500');
                break;
            case 'telegram':
                targetUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${title}`;
                window.open(targetUrl, '_blank');
                break;
            case 'copy':
                navigator.clipboard.writeText(shareUrl);
                setCopiedShareLink(true);
                setTimeout(() => setCopiedShareLink(false), 3000);
                break;
            default:
                break;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-500 font-medium text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    if (error && !formMeta) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="text-center max-w-md bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-red-500" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 mb-2">Form Unavailable</h2>
                    <p className="text-slate-500 text-xs">{error}</p>
                </div>
            </div>
        );
    }

    if (formMeta && !formMeta.is_active) {
        const isRtl = isArabicText(formMeta.form_name);
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="text-center max-w-md bg-white p-8 rounded-3xl border border-slate-200 shadow-sm" dir="auto">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-amber-500" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 mb-2">
                        {isRtl ? 'الاستمارة مغلقة حالياً' : 'Form is Currently Closed'}
                    </h2>
                    <p className="text-slate-500 text-xs">
                        {isRtl
                            ? 'عذراً، استقبال الردود على هذه الاستمارة متوقف مؤقتاً.'
                            : 'Submissions for this form are currently paused.'}
                    </p>
                </div>
            </div>
        );
    }

    if (submitted) {
        const showVisualPoster = formMeta?.show_thank_you_image && formMeta?.thank_you_image_url;
        const isRtl = isArabicText(formMeta?.form_name);

        return (
            <div className="min-h-screen bg-slate-50 py-12 px-4 flex items-center justify-center">
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 sm:p-10 text-center space-y-6 animate-in fade-in zoom-in-95">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
                        <CheckCircle size={44} />
                    </div>

                    <div className="space-y-3" dir="auto">
                        <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
                            {isRtl ? 'تم الإرسال بنجاح!' : 'Submitted Successfully!'}
                        </h2>
                        <div className="text-sm sm:text-base text-slate-600 leading-relaxed whitespace-pre-wrap font-medium">
                            {renderThankYouMessage()}
                        </div>
                    </div>

                    {showVisualPoster && (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm max-h-80 mx-auto">
                            <img
                                src={getGoogleDriveDirectLink(formMeta.thank_you_image_url)}
                                alt="Thank you design"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}

                    <div className="pt-6 border-t border-slate-100 space-y-4">
                        <div className="space-y-1">
                            <h3 className="text-sm font-black text-slate-900 flex items-center justify-center gap-1.5" dir="auto">
                                <Share2 size={16} className="text-blue-600" />
                                {isRtl ? 'شارك الرابط مع زملائك أو شبكتك' : 'Share this form with your network'}
                            </h3>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2">
                            <button
                                type="button"
                                onClick={() => handleShareClick('whatsapp')}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-all font-bold text-xs"
                            >
                                <MessageCircle size={22} />
                                <span>WhatsApp</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleShareClick('facebook')}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-all font-bold text-xs"
                            >
                                <Facebook size={22} />
                                <span>Facebook</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleShareClick('linkedin')}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 transition-all font-bold text-xs"
                            >
                                <Linkedin size={22} />
                                <span>LinkedIn</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleShareClick('telegram')}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 transition-all font-bold text-xs"
                            >
                                <Send size={22} />
                                <span>Telegram</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleShareClick('copy')}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all font-bold text-xs col-span-2 sm:col-span-1"
                            >
                                {copiedShareLink ? <Check size={22} className="text-emerald-600" /> : <Copy size={22} />}
                                <span>{copiedShareLink ? 'Copied!' : 'Copy Link'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const coverUrl = formMeta?.form_covers?.image_url || formMeta?.cover_image_url || event?.form_cover_image_url;
    const displayFormName = formMeta?.form_name || formMeta?.form_name_ar || 'Form';
    const displayEventName = event?.event_name || event?.event_name_ar || '';
    const isRtl = isArabicText(displayFormName);

    const submitBtnText = formMeta?.submit_button_text
        || (isRtl ? 'إرسال النموذج' : 'Submit Form');

    return (
        <div className="min-h-screen bg-slate-50 py-8 sm:py-12 px-4">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    {coverUrl && (
                        <div className="w-full h-48 sm:h-64 relative overflow-hidden bg-slate-900 border-b border-slate-100">
                            <img
                                src={getGoogleDriveDirectLink(coverUrl)}
                                alt="Form Cover"
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        </div>
                    )}

                    <div className="p-6 sm:p-8 border-b border-slate-100 space-y-2.5" dir="auto">
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 leading-tight">
                            {displayFormName}
                        </h1>
                        {displayEventName && (
                            <p className="text-xs font-bold text-blue-600 tracking-wide">
                                {displayEventName}
                            </p>
                        )}
                        {formMeta?.description && (
                            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed pt-1 whitespace-pre-wrap">
                                {formMeta.description}
                            </p>
                        )}
                    </div>

                    {/* Section Header if Multi-Step */}
                    {isMultiStep && currentStepData.title && (
                        <div className="p-6 sm:p-8 pb-3 border-b border-slate-100/80 bg-slate-50/40" dir="auto">
                            <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-black flex items-center justify-center shrink-0">
                                    {currentStep + 1}
                                </span>
                                <span>{currentStepData.title}</span>
                            </h2>
                            {currentStepData.description && (
                                <p className="text-xs text-slate-500 mt-1">
                                    {currentStepData.description}
                                </p>
                            )}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
                        {error && (
                            <div dir="auto" className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-xs text-red-700 font-bold">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <DynamicFormBuilder
                            fields={isMultiStep ? currentStepData.fields : fields}
                            values={formValues}
                            onChange={setFormValues}
                            errors={errors}
                            onFileUpload={handleFileUpload}
                        />

                        {/* Footer Navigation Controls */}
                        {isMultiStep ? (
                            <div className="space-y-4 pt-6 border-t border-slate-100">
                                <div className="flex items-center justify-between gap-3">
                                    {currentStep > 0 ? (
                                        <button
                                            type="button"
                                            onClick={handlePrevStep}
                                            className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 rounded-2xl font-bold text-sm transition-all flex items-center gap-2"
                                        >
                                            {isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                                            <span>{isRtl ? 'السابق' : 'Previous'}</span>
                                        </button>
                                    ) : <div />}

                                    {currentStep < totalSteps - 1 ? (
                                        <button
                                            type="button"
                                            onClick={handleNextStep}
                                            className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2"
                                        >
                                            <span>{isRtl ? 'التالي' : 'Next'}</span>
                                            {isRtl ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                                        </button>
                                    ) : (
                                        <button
                                            type="submit"
                                            disabled={submitting}
                                            className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {submitting ? (
                                                <>
                                                    <Loader size={18} className="animate-spin" />
                                                    <span>{isRtl ? 'جاري إرسال البيانات...' : 'Submitting...'}</span>
                                                </>
                                            ) : (
                                                <span dir="auto">{submitBtnText}</span>
                                            )}
                                        </button>
                                    )}
                                </div>

                                {/* Multi-Step Progress Bar at Bottom */}
                                <div className="pt-3 space-y-1.5">
                                    <div className="flex items-center justify-between text-xs font-bold text-slate-500" dir="auto">
                                        <span>
                                            {isRtl
                                                ? `الخطوة ${currentStep + 1} من ${totalSteps}`
                                                : `Step ${currentStep + 1} of ${totalSteps}`}
                                        </span>
                                        <span className="text-blue-600 font-extrabold">{progressPercent}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300 rounded-full"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="pt-4 border-t border-slate-100">
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {submitting ? (
                                        <>
                                            <Loader size={18} className="animate-spin" />
                                            <span>{isRtl ? 'جاري إرسال البيانات...' : 'Submitting...'}</span>
                                        </>
                                    ) : (
                                        <span dir="auto">{submitBtnText}</span>
                                    )}
                                </button>
                            </div>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
}

