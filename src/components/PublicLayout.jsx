import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { Calendar, Users, Briefcase, BookOpen } from 'lucide-react';
import { translations } from '../lib/translations';
import { getEvent } from '../lib/api';

export default function PublicLayout() {
    const { eventId } = useParams();

    const [searchParams] = useSearchParams();
    const lang = searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const isRtl = lang === 'ar';

    const [event, setEvent] = useState(null);

    useEffect(() => {
        const loadEvent = async () => {
            try {
                const data = await getEvent(eventId);
                setEvent(data);
            } catch (err) {
                console.error('Error loading event in PublicLayout:', err);
            }
        };
        if (eventId) {
            loadEvent();
        }
    }, [eventId]);

    const t = translations.PublicLayout[lang];
    const queryStr = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const isAgendaOnly = searchParams.get('mode') === 'agenda_only';
    const isAgendaExperts = searchParams.get('mode') === 'agenda_experts';

    const customExpertsLabel = lang === 'ar'
        ? event?.header_settings?.customExpertsLabelAr
        : event?.header_settings?.customExpertsLabel;

    const allNavItems = [
        { id: 'agenda', path: `/agenda/${eventId}${queryStr}`, label: t.agenda, icon: <Calendar size={20} /> },
        { id: 'experts', path: `/view/${eventId}/experts${queryStr}`, label: customExpertsLabel || t.experts, icon: <Users size={20} /> },
        { id: 'companies', path: `/view/${eventId}/startups${queryStr}`, label: t.companies, icon: <Briefcase size={20} /> },
        { id: 'library', path: `/view/${eventId}/library${queryStr}`, label: t.library, icon: <BookOpen size={20} /> },
    ];

    const navItems = allNavItems.filter(item => {
        if (isAgendaExperts && item.id === 'companies') return false;
        return true;
    });

    return (
        <div 
            dir={isRtl ? 'rtl' : 'ltr'} 
            className={`min-h-screen bg-slate-50 ${isRtl ? 'font-arabic' : 'font-manrope'}`}
        >
            {/* Desktop Header */}
            {!isAgendaOnly && (
                <header className="hidden md:block sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-6 py-4 print:hidden">
                    <div className="max-w-7xl mx-auto flex items-center justify-center">
                        
                        <nav className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                            {navItems.map((item) => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    className={({ isActive }) =>
                                        `flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isActive
                                            ? 'bg-white text-[#1a27c9] shadow-sm shadow-indigo-100 ring-1 ring-indigo-50'
                                            : 'text-slate-400 hover:text-slate-600'
                                        }`
                                    }
                                >
                                    {item.icon}
                                    {item.label}
                                </NavLink>
                            ))}
                        </nav>
                    </div>
                </header>
            )}

            {/* Main Content */}
            <main className={isAgendaOnly ? "" : "pb-24 md:pb-12"}>
                <Outlet />
            </main>

            {/* Mobile Bottom Nav */}
            {!isAgendaOnly && (
                <nav className="md:hidden fixed bottom-6 inset-x-6 z-50 bg-white/95 backdrop-blur-2xl border border-slate-200 shadow-[0_20px_50px_rgba(26,39,201,0.15)] rounded-[2.5rem] p-2 flex items-center justify-around print:hidden">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                                `flex flex-col items-center gap-1 px-4 py-3 rounded-3xl transition-all ${isActive
                                    ? 'bg-indigo-50 text-[#1a27c9]'
                                    : 'text-slate-400'
                                }`
                            }
                        >
                            {item.icon}
                            <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>
            )}
        </div>
    );
}
