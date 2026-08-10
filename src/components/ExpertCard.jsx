import { MapPin, Briefcase, Linkedin, Twitter, ExternalLink, Pencil, Trash2, GripVertical, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { getGoogleDriveFallbackUrls } from '../lib/utils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import LazyImage from './LazyImage';
import ExpandableText from './ExpandableText';
import { useState } from 'react';
import { translations } from '../lib/translations';

const ExpertCard = ({ expert, config, customColor = '#1a27c9', viewMode = 'grid', onEdit, onDelete, previewMode = false, priority = false, forceExpanded = false }) => {
    const [expanded, setExpanded] = useState(false);
    const isExpanded = forceExpanded || expanded;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: expert.expert_id || expert.id,
        disabled: previewMode
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.5 : 1,
    };

    const getLightColor = (hex, opacity = '1a') => `${hex}${opacity}`;

    // Language Handling
    const [searchParams] = useSearchParams();
    const lang = searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const isRtl = lang === 'ar';

    

    const t = translations.ExpertCard[lang];

    // Data Sanitization
    const sanitizeName = (str) => {
        if (!str) return 'Unknown Expert';
        let cleaned = str.replace(/[\t\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned.startsWith('http') || cleaned.includes('googledrive')) {
            return 'Expert';
        }
        return cleaned;
    };

    const name = sanitizeName(isRtl && expert.name_ar ? expert.name_ar : expert.name);
    
    // Default visibility logic from global config
    const displayConfig = (() => {
        if (config && Array.isArray(config)) {
            return {
                show_photo: config.find(f => f.field_name === 'photo_url')?.show_in_card !== false,
                show_title: config.find(f => f.field_name === 'title')?.show_in_card !== false,
                show_bio: config.find(f => f.field_name === 'bio')?.show_in_card !== false,
                show_company: config.find(f => f.field_name === 'company')?.show_in_card !== false,
                show_linkedin: config.find(f => f.field_name === 'linkedin_url')?.show_in_card !== false
            };
        }
        
        const local = expert.display_config || {};
        return {
            show_photo: local.show_photo !== false,
            show_title: local.show_title !== false,
            show_bio: local.show_bio !== false,
            show_company: local.show_company !== false,
            show_linkedin: local.show_linkedin !== false
        };
    })();

    const { show_photo, show_title, show_bio, show_company, show_linkedin } = displayConfig;

    const photo = expert.photo_url || expert.photoUrl;
    const linkedin = expert.linkedin_url || expert.linkedin;

    if (viewMode === 'list') {
        return (
            <div 
                ref={setNodeRef}
                style={style}
                className={`group relative w-full bg-slate-50 rounded-[4rem] border border-slate-100 p-8 md:p-12 hover:shadow-2xl transition-all duration-700 flex flex-col md:flex-row gap-8 md:gap-16 overflow-hidden ring-1 ring-slate-100/50 items-center md:items-start text-center md:text-start ${isRtl ? 'font-arabic' : 'font-manrope'}`} dir={isRtl ? 'rtl' : 'ltr'}
            >
                {!previewMode && (
                    <div 
                        {...attributes} 
                        {...listeners}
                        className="absolute left-4 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing p-2 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                    >
                        <GripVertical size={24} />
                    </div>
                )}
                <div
                    className="absolute top-0 end-0 w-[500px] h-[500px] rounded-full opacity-[0.04] blur-[100px] -me-32 -mt-32 pointer-events-none transition-transform duration-1000 group-hover:scale-110"
                    style={{ backgroundColor: customColor }}
                />

                <div className="relative shrink-0">
                    <div
                        className="absolute inset-6 rounded-[4rem] blur-3xl opacity-30 transition-opacity group-hover:opacity-50"
                        style={{ backgroundColor: customColor }}
                    />
                    <div className="relative w-48 h-48 md:w-64 md:h-64 rounded-[3.5rem] overflow-hidden border-8 border-white shadow-2xl bg-white transition-transform duration-1000 group-hover:scale-105">
                       
                        {show_photo ? (
                            <LazyImage
                                src={photo ? getGoogleDriveFallbackUrls(photo)[0] : null}
                                urls={photo ? getGoogleDriveFallbackUrls(photo) : []}
                                alt={name}
                                objectFit="cover"
                                priority={priority}
                                className="grayscale-[0.1] contrast-[1.05] group-hover:grayscale-0 transition-all duration-700"
                                fallback={
                                    <div
                                        className={`w-full h-full flex items-center justify-center text-8xl font-black`}
                                        style={{ backgroundColor: getLightColor(customColor, '10'), color: customColor }}
                                    >
                                        {name.charAt(0)}
                                    </div>
                                }
                            />
                        ) : (
                            <div
                                className="w-full h-full flex items-center justify-center text-8xl font-black"
                                style={{ backgroundColor: getLightColor(customColor, '10'), color: customColor }}
                            >
                                {name.charAt(0)}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 z-10 py-2 w-full">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                        <div>
                            <h3 className={`text-4xl md:text-6xl font-black text-[#0d0e0e] tracking-tighter mb-2 leading-[0.85] group-hover:text-[#1a27c9] transition-colors duration-500 ${!isRtl ? 'uppercase' : ''}`}>
                                {name}
                            </h3>
                            {show_title && (
                                <p className={`text-[#1a27c9] text-sm md:text-base font-black opacity-80 drop-shadow-sm ${isRtl ? '' : 'uppercase tracking-[0.3em]'}`}>
                                    {isRtl && expert.title_ar ? expert.title_ar : expert.title}
                                </p>
                            )}
                        </div>
                        {linkedin && show_linkedin && (
                            <a
                                href={linkedin}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-16 h-16 md:w-24 md:h-24 bg-white border border-slate-100 rounded-3xl flex items-center justify-center text-slate-400 hover:text-[#0077b5] hover:border-[#0077b5] hover:shadow-2xl transition-all group/link self-center md:self-start"
                            >
                                <Linkedin size={32} className="group-hover/link:scale-110 transition-transform" />
                            </a>
                        )}
                    </div>

                    <div className="h-px w-20 bg-slate-100 mb-6 mx-auto md:mx-0" />

                    {show_bio && (
                        <ExpandableText 
                            text={isRtl && expert.bio_ar ? expert.bio_ar : expert.bio || t.fallbackBio}
                            lines={4}
                            lang={lang}
                            color={customColor}
                            className="text-slate-500 text-lg md:text-xl font-medium mb-8"
                        />
                    )}

                    {show_company && (
                        <div className="flex flex-wrap justify-center md:justify-start gap-6">
                            <div className="flex items-center gap-4 bg-slate-50/50 px-8 py-5 rounded-[2rem] border border-slate-100/50 group-hover:bg-white group-hover:border-slate-200 transition-all">
                                <Briefcase size={20} className="text-slate-400" />
                                <div className={isRtl ? 'text-right' : 'text-left'}>
                                    <span className="block text-[8px] font-black uppercase tracking-widest text-slate-400 leading-none mb-1">{t.organization}</span>
                                    <span className="text-sm font-black text-[#0d0e0e] uppercase">{isRtl && expert.company_ar ? expert.company_ar : expert.company || 'Not Specified'}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    className="absolute bottom-0 left-0 w-2 h-0 group-hover:h-full transition-all duration-1000 opacity-60"
                    style={{ backgroundColor: customColor }}
                />

                <div className="absolute top-8 right-8 flex gap-2 z-20">
                    {onEdit && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(expert);
                            }}
                            className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:shadow-xl transition-all group/edit"
                        >
                            <Pencil size={18} className="group-hover/edit:rotate-12 transition-transform" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Are you sure you want to remove this expert?')) {
                                    onDelete(expert.expert_id || expert.id);
                                }
                            }}
                            className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:shadow-xl transition-all group/delete"
                        >
                            <Trash2 size={18} className="group-hover/delete:scale-110 transition-transform" />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div 
            ref={setNodeRef}
            style={style}
            className="group relative w-full bg-white rounded-[2rem] md:rounded-[4rem] border border-slate-100 p-4 md:p-10 hover:shadow-2xl transition-all duration-700 flex flex-col overflow-hidden ring-1 ring-slate-100/50 items-center text-center" dir={isRtl ? 'rtl' : 'ltr'}
        >
            {!previewMode && (
                <div 
                    {...attributes} 
                    {...listeners}
                    className="absolute top-2 left-2 md:top-6 md:left-6 cursor-grab active:cursor-grabbing p-2 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                >
                    <GripVertical size={20} />
                </div>
            )}
            <div
                className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full opacity-[0.05] blur-[80px] -mr-32 -mt-32 pointer-events-none transition-transform duration-1000 group-hover:scale-110"
                style={{ backgroundColor: customColor }}
            />
            <div
                className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full opacity-[0.03] blur-[60px] -ml-20 -mb-20 pointer-events-none transition-transform duration-1000 group-hover:scale-110"
                style={{ backgroundColor: customColor }}
            />

            <div className={`absolute top-2 md:top-6 ${isRtl ? 'left-2 md:left-6' : 'right-2 md:right-6'} z-20 flex flex-col gap-2`}>
                {onEdit && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(expert);
                        }}
                        className="w-8 h-8 md:w-10 md:h-10 bg-white/80 backdrop-blur-md border border-slate-200 rounded-xl md:rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:shadow-xl transition-all group/edit"
                    >
                        <Pencil size={14} className="group-hover/edit:rotate-12 transition-transform md:w-[16px] md:h-[16px]" />
                    </button>
                )}
                {onDelete && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Are you sure you want to remove this expert?')) {
                                onDelete(expert.expert_id || expert.id);
                            }
                        }}
                        className="w-8 h-8 md:w-10 md:h-10 bg-white/80 backdrop-blur-md border border-slate-200 rounded-xl md:rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:shadow-xl transition-all group/delete"
                    >
                        <Trash2 size={14} className="group-hover/delete:scale-110 transition-transform md:w-[16px] md:h-[16px]" />
                    </button>
                )}
            </div>

            <div className="flex flex-col items-center mb-2 z-10 w-full relative">
                <div className="relative w-24 h-24 sm:w-32 sm:h-32 md:w-44 md:h-44 mb-3 aspect-square">
                    {linkedin && show_linkedin && (
                        <a
                            href={linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`absolute -top-1 -right-1 md:-top-2 md:-right-2 z-30 w-8 h-8 md:w-12 md:h-12 bg-white border border-slate-200 rounded-xl md:rounded-2xl flex items-center justify-center text-[#0077b5] shadow-xl hover:scale-110 transition-all hover:bg-slate-50`}
                        >
                            <Linkedin size={16} className="md:w-[24px] md:h-[24px]" />
                        </a>
                    )}
                   
                    <div
                        className="absolute inset-2 md:inset-4 rounded-[2rem] md:rounded-[3.5rem] blur-3xl opacity-20 transition-opacity group-hover:opacity-40"
                        style={{ backgroundColor: customColor }}
                    />
                    <div className="relative w-full h-full aspect-square rounded-[2rem] md:rounded-[3.5rem] overflow-hidden border-2 md:border-4 border-white shadow-2xl bg-slate-50 transition-transform duration-1000 group-hover:scale-[1.05]">
                        {show_photo ? (
                            <LazyImage
                                src={photo ? getGoogleDriveFallbackUrls(photo)[0] : null}
                                urls={photo ? getGoogleDriveFallbackUrls(photo) : []}
                                alt={name}
                                objectFit="cover"
                                priority={priority}
                                className="w-full h-full grayscale-[0.2] contrast-[1.1] group-hover:grayscale-0 transition-all duration-1000"
                                fallback={
                                    <div
                                        className="w-full h-full flex items-center justify-center text-4xl md:text-6xl font-black"
                                        style={{ backgroundColor: getLightColor(customColor, '10'), color: customColor }}
                                    >
                                        {name.charAt(0)}
                                    </div>
                                }
                            />
                        ) : (
                            <div
                                className="w-full h-full flex items-center justify-center text-4xl md:text-6xl font-black"
                                style={{ backgroundColor: getLightColor(customColor, '10'), color: customColor }}
                            >
                                {name.charAt(0)}
                            </div>
                        )}
                    </div>
                </div>

                {/* Mobile Read More Toggle */}
                <div className="md:hidden w-full px-1">
                    {!isExpanded ? (
                        <button 
                            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                            className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-[#1a27c9] rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1 border border-slate-100 transition-colors"
                        >
                            {t.readMore} <ChevronDown size={14} />
                        </button>
                    ) : null}
                </div>

                {/* Desktop always visible, Mobile conditionally visible */}
                <div className={`px-2 md:px-4 w-full transition-all duration-300 ${isExpanded ? 'block mt-3' : 'hidden md:block'}`}>
                    <h3 className={`text-lg md:text-2xl font-black text-[#0d0e0e] tracking-tight mb-1 leading-none group-hover:text-[#1a27c9] transition-colors duration-500 ${!isRtl ? 'uppercase' : ''}`}>
                        {name}
                    </h3>
                    {show_title && (
                        <p className={`text-[#1a27c9] text-[9px] md:text-[10px] font-black opacity-80 mb-2 drop-shadow-sm ${isRtl ? '' : 'uppercase tracking-[0.3em]'}`}>
                            {isRtl && expert.title_ar ? expert.title_ar : expert.title}
                        </p>
                    )}
                </div>
            </div>

            <div className={`flex-1 px-2 md:px-4 z-10 w-full flex-col justify-between ${isExpanded ? 'flex' : 'hidden md:flex'}`}>
                {show_bio && (
                    <ExpandableText 
                        text={isRtl && expert.bio_ar ? expert.bio_ar : expert.bio || t.fallbackBio}
                        lines={4}
                        lang={lang}
                        color={customColor}
                        className="text-slate-500 text-[0.75rem] sm:text-[0.85rem] md:text-[0.95rem] font-medium mb-2"
                    />
                )}

                {show_company && (
                    <div className="flex justify-center mt-2 md:mt-0">
                        <div className="bg-slate-50 p-2 md:p-4 px-4 md:px-8 rounded-2xl md:rounded-3xl border border-slate-100 transition-all group-hover:bg-white group-hover:border-slate-200 min-w-[140px] md:min-w-[200px]">
                            <div className="flex items-center justify-center gap-1 md:gap-2 text-slate-400 mb-1">
                                <Briefcase size={12} className="md:w-[14px] md:h-[14px]" />
                                <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-slate-400">{t.organization}</span>
                            </div>
                            <p className="text-[9px] md:text-[10px] font-black text-[#0d0e0e] uppercase truncate">{isRtl && expert.company_ar ? expert.company_ar : expert.company || 'Not Specified'}</p>
                        </div>
                    </div>
                )}

                {expanded && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                        className="md:hidden w-full mt-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1 border border-slate-100 transition-colors"
                    >
                        {t.showLess} <ChevronUp size={14} />
                    </button>
                )}
            </div>

            <div
                className="absolute bottom-0 left-0 h-1.5 transition-all duration-1000 w-0 group-hover:w-full opacity-60"
                style={{ backgroundColor: customColor }}
            />
        </div>
    );
};

export default ExpertCard;
