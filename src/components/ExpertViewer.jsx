import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getEvent, getExperts, getFormConfig } from '../lib/api';
import { getGoogleDriveDirectLink } from '../lib/utils';
import ExpertCard from './ExpertCard';
import { translations } from '../lib/translations';

export default function ExpertViewer() {
    const [event, setEvent] = useState(null);
    const [experts, setExperts] = useState([]);
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [themeColor, setThemeColor] = useState('#1a27c9'); // Default indigo
    const [viewMode] = useState('grid'); // Optimized Grid Layout
    const navigate = useNavigate();
    const { eventId } = useParams();

    // Language Handling
    const [searchParams] = useSearchParams();
    const lang = searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const isRtl = lang === 'ar';

    

    const t = translations.ExpertViewer[lang];

    useEffect(() => {
        const loadData = async () => {
            try {
                const [eventData, expertsData, configData] = await Promise.all([
                    getEvent(eventId),
                    getExperts(eventId),
                    getFormConfig(eventId, 'expert')
                ]);

                setEvent(eventData);
                setExperts(expertsData || []);
                setConfig(configData);

                // Load custom theme from Supabase event data
                if (eventData?.experts_color) {
                    setThemeColor(eventData.experts_color);
                }

                // Update Page Title
                if (eventData?.event_name) {
                    document.title = `Athar Programs | ${eventData.event_name}`;
                }
            } catch (e) {
                console.error('Failed to sync visionary grid:', e);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [eventId]);

    if (loading) return (
        // ... (rest of the component remains similar, but we remove the toggle JSX)
        <div className="min-h-screen bg-white flex flex-col items-center justify-center" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="relative mb-8">
                <div className="w-16 h-16 border-4 border-slate-50 border-t-[#1a27c9] rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 bg-[#1a27c9]/10 rounded-full animate-pulse"></div>
                </div>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">{t.loading}</p>
        </div>
    );

    if (!event || event.error) return (
        <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center p-6 text-center" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center text-rose-500 mb-8 border border-rose-50">
                <ArrowLeft size={32} />
            </div>
            <h2 className="text-2xl font-black text-[#0d0e0e] tracking-tight mb-2">{t.errorTitle}</h2>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest max-w-xs">{t.errorDesc}</p>
            <button onClick={() => navigate('/')} className="mt-8 text-[#1a27c9] font-black text-[10px] uppercase tracking-[0.2em] hover:opacity-70 transition-premium">{t.retry}</button>
        </div>
    );

    const headerSettings = event?.header_settings || { fontFamily: 'font-manrope' };

    return (
        <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className={`min-h-screen selection:bg-white selection:text-[#1a27c9] ${headerSettings.fontFamily || (isRtl ? 'font-arabic' : 'font-manrope')} pb-32`}
            style={{
                backgroundImage: event?.background_image_url
                    ? `url(${getGoogleDriveDirectLink(event.background_image_url)})`
                    : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundAttachment: 'fixed',
                backgroundColor: '#f5f1f1ff'
            }}
        >

            {(() => {
                const hideTitle = event?.header_settings?.hideExpertListTitle || experts.length === 1;
                const customTitle = isRtl 
                    ? event?.header_settings?.customExpertsLabelAr 
                    : event?.header_settings?.customExpertsLabel;
                
                return (
                    <div className="mx-auto px-6 pt-8 relative z-10 max-w-7xl">
                        {!hideTitle && (
                            <div className="mb-2 text-center relative group">
                                <div className="flex flex-col items-center">
                                    {customTitle ? (
                                        <h1 className={`text-3xl md:text-5xl font-black text-[#0d0e0e] tracking-tighter mb-1 leading-none ${!isRtl ? 'uppercase' : ''}`}>
                                            {customTitle}
                                        </h1>
                                    ) : (
                                        <h1 className={`text-3xl md:text-5xl font-black text-[#0d0e0e] tracking-tighter mb-1 leading-none ${!isRtl ? 'uppercase' : ''}`}>
                                            {t.experts} <span className="text-[#1a27c9]">{t.list}</span>
                                        </h1>
                                    )}
                                    <p className="text-slate-400 text-lg md:text-xl font-medium max-w-2xl leading-relaxed">
                                        {isRtl && event?.event_name_ar ? event.event_name_ar : event?.event_name}
                                    </p>
                                </div>
                            </div>
                        )}
                        {hideTitle && <div className="mt-8" />}
                    </div>
                );
            })()}

            <div className="mx-auto px-6 relative z-10 transition-all duration-700 max-w-7xl">
                {/* Grid Layout - Dynamic spacing based on viewMode */}
                <div className={`grid gap-12 transition-all duration-700 ${
                    experts.length === 1
                        ? 'grid-cols-1 max-w-xl mx-auto justify-center'
                        : viewMode === 'list'
                            ? 'grid-cols-1 max-w-6xl mx-auto'
                            : 'grid-cols-1 md:grid-cols-2'
                    }`}>
                    {experts.map((expert, index) => (
                        <ExpertCard
                            key={expert.expert_id || expert.id}
                            expert={expert}
                            config={config}
                            customColor={themeColor}
                            viewMode={viewMode}
                            previewMode={true}
                            priority={index < 2}
                            forceExpanded={experts.length === 1}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
