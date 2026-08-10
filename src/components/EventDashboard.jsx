import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Calendar, Users, Rocket, ArrowLeft, ExternalLink, Settings, LayoutGrid, Inbox, RefreshCw, FileSpreadsheet, Palette, ClipboardList, BarChart3, Edit2, Check, X, Briefcase, ChevronDown, ChevronUp, Save, BookOpen, Copy, Loader2, Users2 } from 'lucide-react';
import { getEvent, updateEvent, duplicateEvent } from '../lib/api';
import { prefetch } from '../App';
import SyncButton from './SyncButton';
import { usePresence } from '../hooks/usePresence';
import ActiveUsers from './ActiveUsers';
import { supabase } from '../lib/supabase';

export default function EventDashboard() {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const { activeUsers } = usePresence(`event_dashboard_${eventId}`);

    // Theme State
    const [expertsColor, setExpertsColor] = useState('#9333ea'); // Default Purple
    const [startupsColor, setStartupsColor] = useState('#059669'); // Default Emerald
    const [_themeSaved, setThemeSaved] = useState(false);
    const [isSyncOpen, setIsSyncOpen] = useState(false);

    // Edit Name State
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null);

    // Sync Metadata State
    const [gsheetsUrl, setGsheetsUrl] = useState('');
    const [isSavingUrl, setIsSavingUrl] = useState(false);
    const [selectionProcessGsheetsUrl, setSelectionProcessGsheetsUrl] = useState('');
    const [isSavingSelectionProcessUrl, setIsSavingSelectionProcessUrl] = useState(false);
    // Google Settings
    const [googleServiceAccountKey, setGoogleServiceAccountKey] = useState('');
    const [googleCalendarId, setGoogleCalendarId] = useState('primary');
    const [isSavingGoogleSettings, setIsSavingGoogleSettings] = useState(false);
    const [googleSettings, setGoogleSettings] = useState(null);

    // Duplicate Event State
    const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [newDuplicateName, setNewDuplicateName] = useState('');


    const loadGoogleSettings = async () => {
        try {
            const { data, error } = await supabase
                .from('google_settings')
                .select('*')
                .eq('event_id', eventId)
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('Error loading Google Settings:', error);
                return;
            }
            if (data) {
                setGoogleSettings(data);
                setGoogleServiceAccountKey(data.service_account_key || '');
                setGoogleCalendarId(data.calendar_id || 'primary');
            }
        } catch (error) {
            console.error('Error loading Google Settings:', error);
        }
    };

    const handleSaveGoogleSettings = async () => {
        try {
            setIsSavingGoogleSettings(true);

            // Try to upsert
            const { data, error } = await supabase
                .from('google_settings')
                .upsert({
                    event_id: eventId,
                    service_account_key: googleServiceAccountKey,
                    calendar_id: googleCalendarId,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'event_id' })
                .select()
                .single();

            if (error) {
                console.error('Error saving Google Settings:', error);
                alert('Failed to save Google Settings');
                return;
            }

            setGoogleSettings(data);
            alert('Google Settings saved successfully!');
        } catch (error) {
            console.error('Error saving Google Settings:', error);
            alert('Failed to save Google Settings');
        } finally {
            setIsSavingGoogleSettings(false);
        }
    };

    useEffect(() => {
        loadEventDetails();
        loadGoogleSettings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId]);

    const _saveTheme = async () => {
        try {
            const updates = {
                experts_color: expertsColor,
                startups_color: startupsColor
            };
            await updateEvent(eventId, updates);
            setThemeSaved(true);
            setTimeout(() => setThemeSaved(false), 2000);
        } catch (error) {
            console.error('Error saving theme:', error);
            alert('Failed to save theme settings.');
        }
    };

    const handleSaveGsheetsUrl = async () => {
        try {
            setIsSavingUrl(true);
            await updateEvent(eventId, { gsheets_url: gsheetsUrl });
            setEvent(prev => ({ ...prev, gsheets_url: gsheetsUrl }));
        } catch (error) {
            console.error('Error saving Google Sheets URL:', error);
            alert('Failed to save sync configuration.');
        } finally {
            setIsSavingUrl(false);
        }
    };

    const handleSaveSelectionProcessGsheetsUrl = async () => {
        try {
            setIsSavingSelectionProcessUrl(true);
            await updateEvent(eventId, { selection_process_gsheets_url: selectionProcessGsheetsUrl });
            setEvent(prev => ({ ...prev, selection_process_gsheets_url: selectionProcessGsheetsUrl }));
            alert('Successfully saved sync configuration!');
        } catch (error) {
            console.error('Error saving Selection Process Google Sheets URL:', error);
            alert(`Failed to save sync configuration. Error: ${error.message}`);
        } finally {
            setIsSavingSelectionProcessUrl(false);
        }
    };

    const handleSaveName = async () => {
        if (!editedName.trim() || editedName === event.event_name) {
            setIsEditingName(false);
            return;
        }
        try {
            setIsSavingName(true);
            await updateEvent(eventId, { event_name: editedName });
            setEvent(prev => ({ ...prev, event_name: editedName }));
            setIsEditingName(false);
        } catch (error) {
            console.error('Error saving event name:', error);
            alert('Failed to save event name.');
        } finally {
            setIsSavingName(false);
        }
    };

    const handleDuplicate = async () => {
        if (!newDuplicateName.trim()) return;
        try {
            setIsDuplicating(true);
            const newEvent = await duplicateEvent(eventId, newDuplicateName.trim());
            setIsDuplicateModalOpen(false);
            setNewDuplicateName('');
            navigate(`/event/${newEvent.event_id}`);
        } catch (error) {
            console.error('Error duplicating event:', error);
            alert('Failed to duplicate the event. Please try again.');
        } finally {
            setIsDuplicating(false);
        }
    };

    const loadEventDetails = async () => {
        try {
            setLoading(true);
            const data = await getEvent(eventId);
            setEvent(data);
            setEditedName(data.event_name || '');
            // Load theme from DB
            if (data.experts_color) setExpertsColor(data.experts_color);
            if (data.startups_color) setStartupsColor(data.startups_color);
            if (data.gsheets_url) setGsheetsUrl(data.gsheets_url);
            if (data.selection_process_gsheets_url) setSelectionProcessGsheetsUrl(data.selection_process_gsheets_url);
        } catch (error) {
            console.error('Error loading event:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground font-manrope relative overflow-hidden animate-in fade-in">
                <div
                    className="absolute inset-0 opacity-20 mix-blend-soft-light pointer-events-none z-0 dark:opacity-10"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                ></div>
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-athar-blue z-10"></div>
                <p className="mt-4 text-muted-foreground font-bold tracking-tight z-10">Loading Pulse Dashboard...</p>
            </div>
        );
    }

    if (!event || event.error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-background font-manrope relative overflow-hidden animate-in fade-in">
                <div
                    className="absolute inset-0 opacity-20 mix-blend-soft-light pointer-events-none z-0 dark:opacity-10"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                ></div>
                <div className="absolute top-0 right-0 w-full h-[500px] bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/20 via-background to-background pointer-events-none z-0"></div>
                <div className="bg-card p-10 rounded-lg shadow-xl border border-border text-center max-w-sm relative z-10 animate-in zoom-in-95">
                    <h2 className="text-3xl font-extrabold text-foreground mb-2 tracking-tight">Event Offline</h2>
                    <p className="text-muted-foreground font-medium mb-8">We couldn't find the event pulse you're looking for.</p>
                    <Link to="/" className="inline-block px-8 py-3.5 bg-primary text-primary-foreground rounded-lg font-semibold transition-all duration-300 hover:scale-105 active:scale-95">
                        Return to Hub
                    </Link>
                </div>
            </div>
        );
    }

    const modules = [
        {
            title: "Agenda Builder",
            icon: <Calendar size={32} className="text-primary" />,
            manageLink: `/event/${eventId}/agenda`,
            previewLink: `/agenda/${eventId}`,
            prefetchKey: 'agenda',
            accent: "hsl(var(--primary))",
        },
        {
            title: "Lists",
            icon: <LayoutGrid size={32} className="text-emerald-600" />,
            manageLink: `/event/${eventId}/lists`,
            prefetchKey: 'lists',
            accent: "#059669",
        },
        {
            title: "Form Builder",
            icon: <Inbox size={32} className="text-primary" />,
            manageLink: `/event/${eventId}/forms`,
            prefetchKey: 'forms',
            accent: "hsl(var(--primary))",
        },
        {
            title: "Mentor Booking",
            icon: <Users size={32} className="text-purple-600" />,
            manageLink: `/event/${eventId}/mentor-booking`,
            prefetchKey: 'mentor-booking',
            accent: "#9333ea",
        },
        {
            title: "Selection Process",
            icon: <ClipboardList size={32} className="text-primary" />,
            manageLink: `/event/${eventId}/selection`,
            prefetchKey: 'selection',
            accent: "hsl(var(--primary))",
        },
        {
            title: "Library",
            icon: <BookOpen size={32} className="text-blue-600" />,
            manageLink: `/event/${eventId}/library`,
            prefetchKey: 'library',
            accent: "#2563eb",
        },
        {
            title: "Mentoring Distribution",
            icon: <Users2 size={32} className="text-orange-500" />,
            manageLink: `/event/${eventId}/mentoring-distribution`,
            prefetchKey: 'mentoringDistribution',
            accent: "#f97316",
        },
    ];

    return (
        <div className="min-h-screen bg-background font-manrope text-foreground pb-24 relative overflow-hidden">
            {/* Background Grain & Glow */}
            <div
                className="absolute inset-0 z-0 pointer-events-none mix-blend-soft-light opacity-20 dark:opacity-10"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            ></div>
            <div className="absolute top-0 right-0 w-full h-[500px] bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/10 via-background to-background pointer-events-none -z-10"></div>

            <div className="bg-background/80 backdrop-blur-xl border-b border-border sticky top-0 z-50 animate-in fade-in slide-in-from-top-4">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between gap-4 min-h-[64px] sm:h-20 py-3 sm:py-0">
                        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
                            <Link to="/" className="shrink-0 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all duration-300 group tap-target">
                                <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                            </Link>
                            <div className="min-w-0">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editedName}
                                            onChange={(e) => setEditedName(e.target.value)}
                                            className="text-lg sm:text-2xl font-extrabold text-foreground tracking-tight bg-background border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all w-40 sm:w-auto"
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveName();
                                                if (e.key === 'Escape') {
                                                    setEditedName(event.event_name);
                                                    setIsEditingName(false);
                                                }
                                            }}
                                            disabled={isSavingName}
                                        />
                                        <button onClick={handleSaveName} disabled={isSavingName} className="p-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors tap-target">
                                            <Check size={18} />
                                        </button>
                                        <button onClick={() => { setEditedName(event.event_name); setIsEditingName(false); }} disabled={isSavingName} className="p-1.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-500/20 transition-colors tap-target">
                                            <X size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-lg sm:text-2xl font-extrabold text-foreground tracking-tight truncate max-w-[140px] sm:max-w-xs hover:text-transparent hover:bg-clip-text hover:bg-gradient-to-r hover:from-athar-blue hover:to-athar-yellow transition-all duration-300 leading-none">{event.event_name}</h1>
                                        <button onClick={() => setIsEditingName(true)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors tap-target" title="Edit Event Name">
                                            <Edit2 size={16} />
                                        </button>
                                    </div>
                                )}
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.1em] leading-none -mt-1 hidden sm:block">Program Master Control</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-6 shrink-0">
                            {/* Active Users — hidden on tiny screens */}
                            <div className="hidden sm:block">
                                <ActiveUsers users={activeUsers} />
                            </div>

                            <div className="flex items-center gap-2 sm:gap-4 sm:border-l border-border sm:pl-6">
                                <SyncButton eventId={eventId} onSyncComplete={() => window.location.reload()} />
                                <button
                                    onClick={() => {
                                        setNewDuplicateName(`${event.event_name} (Copy)`);
                                        setIsDuplicateModalOpen(true);
                                    }}
                                    className="hidden sm:flex px-4 py-1.5 bg-background border border-border hover:bg-secondary text-foreground rounded-full text-[10px] font-bold uppercase tracking-widest transition-all duration-300 items-center gap-2 tap-target"
                                >
                                    <Copy size={14} /> Duplicate
                                </button>
                                <div className={`hidden sm:block px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-sm border ${event.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border'
                                    }`}>
                                    • {event.status || 'Active'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Public Access Hub - NEW SECTION (Solid Branding) */}
            <div className="bg-gradient-to-br from-athar-blue to-athar-black text-white py-10 relative z-30 animate-in fade-in slide-in-from-top-2">
                <div
                    className="absolute inset-0 opacity-20 mix-blend-soft-light pointer-events-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                />
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 relative">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                        <div>
                            <h2 className="text-2xl font-bold text-white tracking-tight mb-1">Public Access Hub</h2>
                            <p className="text-white/60 text-xs font-medium uppercase tracking-[0.1em] mb-4">Share these links with your guests</p>
                        </div>
                        <div className="flex flex-wrap gap-4 items-center">
                            {/* English Links Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'en' ? null : 'en')}
                                    className="px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg text-xs font-semibold uppercase tracking-wider backdrop-blur-md transition-all duration-300 flex items-center justify-center gap-2"
                                >
                                    English Links <ChevronDown size={16} className={`transition-transform duration-300 ${openDropdown === 'en' ? 'rotate-180' : ''}`} />
                                </button>

                                {openDropdown === 'en' && (
                                    <div className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 w-56 bg-card border border-border rounded-xl shadow-2xl p-2 flex flex-col gap-1 z-[100]">
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=en`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">Copied!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-left transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> Full Link
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=en&mode=agenda_experts`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">Copied!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-left transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> Agenda & Experts
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=en&mode=agenda_only`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">Copied!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-left transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> Agenda Only
                                        </button>
                                        <div className="h-px bg-border my-1" />
                                        <a
                                            href={`${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=en`}
                                            target="_blank"
                                            className="px-3 py-2 text-sm font-bold text-athar-yellow hover:bg-secondary rounded-lg flex items-center gap-2 text-left transition-colors"
                                            onClick={() => setOpenDropdown(null)}
                                        >
                                            <ExternalLink size={16} /> Open English
                                        </a>
                                    </div>
                                )}
                            </div>
                            <div className="w-px h-10 bg-white/20 hidden md:block" />

                            {/* Arabic Links Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'ar' ? null : 'ar')}
                                    className="px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg text-xs font-semibold uppercase tracking-wider backdrop-blur-md transition-all duration-300 flex items-center justify-center gap-2 font-arabic"
                                >
                                    الروابط العربية <ChevronDown size={16} className={`transition-transform duration-300 ${openDropdown === 'ar' ? 'rotate-180' : ''}`} />
                                </button>

                                {openDropdown === 'ar' && (
                                    <div className="absolute top-full mt-2 right-0 sm:right-0 sm:left-auto w-56 bg-card border border-border rounded-xl shadow-2xl p-2 flex flex-col gap-1 z-[100] font-arabic" dir="rtl">
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=ar`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">تم النسخ!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-right transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> المنصة كاملة
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=ar&mode=agenda_experts`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">تم النسخ!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-right transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> الأجندة والخبراء
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                const link = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=ar&mode=agenda_only`;
                                                navigator.clipboard.writeText(link);
                                                const btn = e.currentTarget;
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = '<span class="flex items-center gap-2 justify-center w-full">تم النسخ!</span>';
                                                setTimeout(() => { btn.innerHTML = originalHtml; setOpenDropdown(null); }, 1500);
                                            }}
                                            className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg flex items-center gap-2 text-right transition-colors"
                                        >
                                            <ClipboardList size={16} className="text-muted-foreground" /> الأجندة فقط
                                        </button>
                                        <div className="h-px bg-border my-1" />
                                        <a
                                            href={`${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=ar`}
                                            target="_blank"
                                            className="px-3 py-2 text-sm font-bold text-athar-yellow hover:bg-secondary rounded-lg flex items-center gap-2 text-right transition-colors"
                                            onClick={() => setOpenDropdown(null)}
                                        >
                                            <ExternalLink size={16} /> فتح باللغة العربية
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
                {/* Cloud Sync Configuration */}
                <div className="mb-12 bg-card rounded-xl border border-border overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-8">
                    {/* Header - Clickable for mobile accordion */}
                    <div
                        className="p-6 md:p-8 relative group cursor-pointer md:cursor-default"
                        onClick={() => setIsSyncOpen(!isSyncOpen)}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-athar-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                        <div className="flex items-start md:items-center justify-between gap-4 relative z-10">
                            <div>
                                <div className="flex items-center gap-3 mb-1.5 md:mb-2">
                                    <div className="bg-primary/10 p-2 rounded-lg text-primary">
                                        <RefreshCw size={18} />
                                    </div>
                                    <h3 className="text-xl font-bold text-foreground tracking-tight">Sync With Sheet</h3>
                                </div>
                                <p className="text-muted-foreground text-sm font-medium">Provide a Google Sheets URL to synchronize all modules at once.</p>
                            </div>
                            <div className="md:hidden mt-2 p-2 bg-secondary/50 rounded-lg text-muted-foreground">
                                {isSyncOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                        </div>
                    </div>

                    {/* Content - Collapsible on mobile */}
                    <div className={`${isSyncOpen ? 'block' : 'hidden'} md:block px-6 pb-6 md:px-8 md:pb-8 pt-0`}>
                        <div className="flex flex-col gap-3 w-full mt-2 md:mt-0 pt-4 md:pt-0 border-t border-border/50 md:border-none">
                            <input
                                type="text"
                                placeholder="Paste Google Sheets URL here..."
                                value={gsheetsUrl}
                                onChange={(e) => setGsheetsUrl(e.target.value)}
                                className="w-full px-4 sm:px-6 py-3.5 bg-background border border-border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                            />
                            <div className="flex items-center gap-3 w-full">
                                <button
                                    onClick={handleSaveGsheetsUrl}
                                    disabled={isSavingUrl || gsheetsUrl === event?.gsheets_url}
                                    className="px-4 py-3.5 md:px-6 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold uppercase tracking-[0.1em] hover:opacity-90 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm tap-target aspect-square md:aspect-auto"
                                >
                                    {isSavingUrl ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                                    <span className="hidden md:inline">{isSavingUrl ? 'Saving...' : 'Save Source'}</span>
                                </button>
                                <a
                                    href="https://docs.google.com/spreadsheets/d/15uqLAXYvVwIFGbIp8FjG5IA1oCwjdU72Hs4ONO06WCc/copy"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 md:flex-none px-4 py-3.5 md:px-6 bg-secondary text-secondary-foreground border border-border rounded-lg text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-secondary/80 transition-all duration-300 flex items-center justify-center gap-2 tap-target"
                                >
                                    <FileSpreadsheet size={16} />
                                    <span>Template</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Selection Process Sync Configuration */}
                <div className="mb-12 bg-card rounded-xl border border-border overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-8">
                    {/* Header */}
                    <div className="p-6 md:p-8 relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                        <div className="flex items-start md:items-center justify-between gap-4 relative z-10">
                            <div>
                                <div className="flex items-center gap-3 mb-1.5 md:mb-2">
                                    <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-600">
                                        <ClipboardList size={18} />
                                    </div>
                                    <h3 className="text-xl font-bold text-foreground tracking-tight">Selection Process Sync</h3>
                                </div>
                                <p className="text-muted-foreground text-sm font-medium">Provide a Google Sheets URL to synchronize your selection process submissions.</p>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="px-6 pb-6 md:px-8 md:pb-8 pt-0">
                        <div className="flex flex-col gap-3 w-full mt-2 md:mt-0 pt-4 md:pt-0 border-t border-border/50 md:border-none">
                            <input
                                type="text"
                                placeholder="Paste Selection Process Google Sheets URL here..."
                                value={selectionProcessGsheetsUrl}
                                onChange={(e) => setSelectionProcessGsheetsUrl(e.target.value)}
                                className="w-full px-4 sm:px-6 py-3.5 bg-background border border-border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                            />
                            <div className="flex items-center gap-3 w-full">
                                <button
                                    onClick={handleSaveSelectionProcessGsheetsUrl}
                                    disabled={isSavingSelectionProcessUrl || selectionProcessGsheetsUrl === event?.selection_process_gsheets_url}
                                    className="px-4 py-3.5 md:px-6 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.1em] hover:opacity-90 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm tap-target aspect-square md:aspect-auto"
                                >
                                    {isSavingSelectionProcessUrl ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                                    <span className="hidden md:inline">{isSavingSelectionProcessUrl ? 'Saving...' : 'Save Source'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>


                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 mb-16">
                    {modules.map((module, index) => (
                        <React.Fragment key={index}>
                            {/* Mobile View (Icon Only) */}
                            <button
                                onClick={() => navigate(module.manageLink)}
                                onMouseEnter={() => module.prefetchKey && prefetch[module.prefetchKey]?.()}
                                className="md:hidden flex flex-col items-center justify-start gap-2 pt-2 active:scale-95 transition-transform animate-in fade-in zoom-in-95 fill-mode-both"
                                style={{ animationDelay: `${index * 50}ms` }}
                            >
                                <div className="p-4 rounded-2xl shadow-sm border border-border bg-card flex items-center justify-center" style={{ color: module.accent, borderColor: `${module.accent}30` }}>
                                    {module.icon}
                                </div>
                                <span className="text-[11px] font-bold text-center text-foreground leading-tight px-1">{module.title}</span>
                            </button>

                            {/* Desktop View */}
                            <div
                                className="hidden md:flex relative rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-xl flex-col items-center text-center group bg-card backdrop-blur-sm overflow-hidden animate-in fade-in zoom-in-95 fill-mode-both cursor-pointer"
                                onClick={() => navigate(module.manageLink)}
                                style={{ animationDelay: `${index * 50}ms` }}
                                onMouseEnter={() => module.prefetchKey && prefetch[module.prefetchKey]?.()}
                            >
                                {/* Hover Gradient line */}
                                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-athar-blue via-athar-blue/80 to-athar-yellow opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                                <div className="flex items-center justify-center mb-5 relative z-10">
                                    <div className="p-4 rounded-xl shadow-sm border border-border group-hover:scale-110 transition-transform duration-300 bg-background" style={{ color: module.accent, borderColor: `${module.accent}30` }}>
                                        {module.icon}
                                    </div>
                                </div>

                                <h3 className="text-xl font-bold text-foreground mb-6 tracking-tight relative z-10 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-athar-blue group-hover:to-athar-yellow transition-all duration-300">{module.title}</h3>

                                <div className="flex flex-col gap-3 w-full mt-auto relative z-10">
                                    <button
                                        onClick={() => navigate(module.manageLink)}
                                        onMouseEnter={() => module.prefetchKey && prefetch[module.prefetchKey]?.()}
                                        className="w-full py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg transition-all duration-300 hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 bg-primary text-primary-foreground hover:opacity-90 tap-target"
                                    >
                                        <span>Enter Module</span>
                                    </button>

                                    {module.editFormsLink && (
                                        <button
                                            onClick={() => navigate(module.editFormsLink)}
                                            className="w-full py-2.5 rounded-xl font-semibold text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 flex items-center justify-center gap-2 tap-target"
                                        >
                                            <Settings size={16} />
                                            <span>Customize Forms</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </React.Fragment>
                    ))}
                </div>









            </div>

            {/* Duplicate Event Modal */}
            {isDuplicateModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-border">
                            <h3 className="text-xl font-bold text-foreground">Duplicate Event</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                This will clone the event configuration, days, agenda, experts, companies, forms, and library.
                            </p>
                        </div>
                        <div className="p-6">
                            <label className="block text-sm font-semibold text-foreground mb-2">New Event Name</label>
                            <input
                                type="text"
                                value={newDuplicateName}
                                onChange={(e) => setNewDuplicateName(e.target.value)}
                                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder="Enter a name for the duplicated event"
                                autoFocus
                                disabled={isDuplicating}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleDuplicate();
                                    if (e.key === 'Escape' && !isDuplicating) setIsDuplicateModalOpen(false);
                                }}
                            />
                        </div>
                        <div className="p-6 border-t border-border bg-secondary/50 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setIsDuplicateModalOpen(false)}
                                disabled={isDuplicating}
                                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDuplicate}
                                disabled={isDuplicating || !newDuplicateName.trim()}
                                className="px-5 py-2.5 rounded-lg text-sm font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
                            >
                                {isDuplicating ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Duplicating...
                                    </>
                                ) : (
                                    <>
                                        <Copy size={16} />
                                        Duplicate
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
