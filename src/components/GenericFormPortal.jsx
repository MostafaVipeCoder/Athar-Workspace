import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { getEvent, getEventFormById, getFormConfigById, submitToForm } from '../lib/api';
import { uploadImage } from '../lib/api';
import { getGoogleDriveDirectLink } from '../lib/utils';
import DynamicFormBuilder from './DynamicFormBuilder';
import { translations } from '../lib/translations';

export default function GenericFormPortal() {
    const { eventId, formId } = useParams();
    const [searchParams] = useSearchParams();
    const isArabic = searchParams.get('lang') === 'ar';

    // Tracking params captured from URL (e.g. ?source=facebook&utm_campaign=spring)
    const TRACKING_KEYS = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'channel', 'ref', 'from'];
    const trackingData = Object.fromEntries(
        TRACKING_KEYS.map(k => [k, searchParams.get(k)]).filter(([, v]) => v)
    );
    const [formMeta, setFormMeta] = useState(null);
    const [event, setEvent] = useState(null);
    const [fields, setFields] = useState([]);
    const [formValues, setFormValues] = useState({});
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);

    

    const t = isArabic ? translations.GenericFormPortal.ar : translations.GenericFormPortal.en;

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                const [meta, fieldData] = await Promise.all([
                    getEventFormById(formId),
                    getFormConfigById(formId)
                ]);
                setFormMeta(meta);

                // Fetch event details for the cover image
                try {
                    const eventData = await getEvent(eventId);
                    setEvent(eventData);
                    
                    // Update Page Title
                    const eventName = (isArabic && eventData?.event_name_ar) ? eventData.event_name_ar : eventData?.event_name;
                    const formName = (isArabic && meta?.form_name_ar) ? meta.form_name_ar : meta?.form_name;
                    if (eventName && formName) {
                        document.title = `Athar Programs | ${formName} - ${eventName}`;
                    }
                } catch (e) {
                    console.error('Failed to load event metadata');
                }

                setFields(fieldData.filter(f => f.field_type !== 'hidden' || true)); // include hidden
                const initial = {};

                fieldData.forEach(f => {
                    let defaultVal = '';
                    
                    // 1. Direct URL mapping (e.g. ?custom_123=instgram)
                    const exactParam = searchParams.get(f.field_name);
                    if (exactParam) {
                        defaultVal = exactParam;
                    } 
                    // 2. Fallbacks for hidden tracking/source fields using common names
                    else if (f.field_type === 'hidden') {
                        const label = (f.field_label || '').toLowerCase();
                        if (label.includes('track') || label.includes('trak') || label.includes('source') || label.includes('منصة') || label.includes('utm')) {
                            const TRACKING_KEYS = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'channel', 'ref', 'from'];
                            for (const tk of TRACKING_KEYS) {
                                const val = searchParams.get(tk);
                                if (val) {
                                    defaultVal = val;
                                    break;
                                }
                            }
                        }
                    }
                    
                    initial[f.field_name] = defaultVal; 
                });

                setFormValues(initial);
            } catch (err) {
                setError(t.notFoundError);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [formId]);

    const validate = () => {
        const errs = {};
        fields.forEach(field => {
            if (field.is_required && !formValues[field.field_name]) {
                const fieldLabel = (isArabic && field.field_label_ar) ? field.field_label_ar : field.field_label;
                errs[field.field_name] = isArabic ? `${fieldLabel} ${t.isRequired}` : `${fieldLabel} ${t.isRequired}`;
            }
        });
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setSubmitting(true);
            setError(null);
            
            // 1. Static URL tracking data
            const finalTracking = { ...trackingData };
            
            // 2. Discover if any stored formValue represents a tracking source
            fields.forEach(f => {
                const label = (f.field_label || '').toLowerCase();
                if (label.includes('track') || label.includes('trak') || label.includes('source') || label.includes('منصة') || label.includes('utm')) {
                    if (formValues[f.field_name]) {
                        finalTracking.source = formValues[f.field_name];
                    }
                }
            });

            // Merge everything
            const enrichedFormValues = { ...formValues, ...finalTracking };
            await submitToForm(formId, eventId, formMeta.target_module, enrichedFormValues);
            setSubmitted(true);
        } catch (err) {
            setError(t.submitError);
        } finally {
            setSubmitting(false);
        }
    };

    const handleFileUpload = async (file) => {
        return await uploadImage(file, 'portal-uploads');
    };

    if (loading) {
        return (
            <div className={`min-h-screen bg-gray-50 flex items-center justify-center ${isArabic ? 'font-arabic' : 'font-manrope'}`}>
                <div className="text-center">
                    <Loader className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">{t.loading}</p>
                </div>
            </div>
        );
    }

    if (error && !formMeta) {
        return (
            <div className={`min-h-screen bg-gray-50 flex items-center justify-center p-4 ${isArabic ? 'font-arabic' : 'font-manrope'}`} dir={isArabic ? 'rtl' : 'ltr'}>
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-red-500" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 mb-2">{t.unavailableTitle}</h2>
                    <p className="text-slate-500">{error}</p>
                </div>
            </div>
        );
    }

    if (!formMeta?.is_active) {
        return (
            <div className={`min-h-screen bg-gray-50 flex items-center justify-center p-4 ${isArabic ? 'font-arabic' : 'font-manrope'}`} dir={isArabic ? 'rtl' : 'ltr'}>
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-amber-500" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 mb-2">{t.closedTitle}</h2>
                    <p className="text-slate-500">{t.closedDesc}</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className={`min-h-screen bg-gray-50 flex items-center justify-center p-4 ${isArabic ? 'font-arabic' : 'font-manrope'}`} dir={isArabic ? 'rtl' : 'ltr'}>
                <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="text-green-500" size={36} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 mb-3">{t.submittedTitle}</h2>
                    <p className="text-slate-500 text-lg">{t.submittedDesc}</p>
                </div>
            </div>
        );
    }

    const displayFormName = (isArabic && formMeta?.form_name_ar) ? formMeta.form_name_ar : formMeta?.form_name;

    return (
        <div className={`min-h-screen bg-gray-50 py-12 px-4 ${isArabic ? 'font-arabic' : 'font-manrope'}`} dir={isArabic ? 'rtl' : 'ltr'}>
            <div className="max-w-2xl mx-auto">
                {/* Header Section */}
                {event?.form_cover_image_url && (
                    <div className="mb-8 rounded-[2.5rem] overflow-hidden border border-slate-200 shadow-sm aspect-[3/1]">
                        <img
                            src={getGoogleDriveDirectLink(event.form_cover_image_url)}
                            alt="Form Cover"
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}

                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-black text-slate-900">{displayFormName}</h1>
                    <p className="text-slate-500 mt-2">{t.fillFields}</p>
                </div>

                {error && (
                    <div className={`mb-6 p-4 bg-red-100 text-red-700 rounded-2xl flex items-center gap-3 border border-red-200 ${isArabic ? 'text-right' : 'text-left'}`}>
                        <AlertCircle size={18} /><span className="font-bold">{error}</span>
                    </div>
                )}

                {/* Form */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                    <form onSubmit={handleSubmit}>
                        <DynamicFormBuilder
                            fields={fields}
                            values={formValues}
                            onChange={setFormValues}
                            errors={errors}
                            onFileUpload={handleFileUpload}
                        />
                        <button
                            type="submit"
                            disabled={submitting}
                            className={`mt-8 w-full py-4 bg-[#0d0e0e] text-white rounded-2xl font-black text-lg hover:bg-[#1a27c9] transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 ${isArabic ? 'flex-row-reverse' : ''}`}
                        >
                            {submitting ? (
                                <><Loader size={20} className="animate-spin" /> {t.submitting}</>
                            ) : (
                                t.submitBtn
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
