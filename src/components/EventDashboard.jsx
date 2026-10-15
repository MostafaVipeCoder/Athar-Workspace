import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Calendar, Users, Rocket, ArrowLeft, ExternalLink, Settings, LayoutGrid, Inbox, RefreshCw, FileSpreadsheet, Palette, ClipboardList, BarChart3, Edit2, Check, X, Briefcase, ChevronDown, ChevronUp, ChevronRight, Save, BookOpen, Copy, Loader2, Users2, AlertCircle, Heart } from 'lucide-react';
import { getEvent, updateEvent, duplicateEvent, getEventSlug, getAgendaTabs } from '../lib/api';
import { prefetch } from '../App';
import SyncButton from './SyncButton';
import { usePresence } from '../hooks/usePresence';
import ActiveUsers from './ActiveUsers';
import { supabase } from '../lib/supabase';
import ProjectManagersManager from './ProjectManagersManager';
import UserNavDropdown from './UserNavDropdown';

function cn(...classes) { return classes.filter(Boolean).join(' '); }


export default function EventDashboard() {
    const params = useParams();
    const eventId = params.eventId || params.id;
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
    const [copiedDropdown, setCopiedDropdown] = useState(null);
    const dropdownRef = useRef(null);

    // Dynamic Tabs for Public Links
    const [availableTabs, setAvailableTabs] = useState([]);
    const [selectedTabs, setSelectedTabs] = useState([]);

    // Sync Metadata State & Modal
    const [isSheetsSyncModalOpen, setIsSheetsSyncModalOpen] = useState(false);
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

            let keyToSave = googleServiceAccountKey;
            if (keyToSave && typeof keyToSave === 'string') {
                const trimmed = keyToSave.trim();
                if (trimmed.startsWith('{')) {
                    try {
                        keyToSave = JSON.stringify(JSON.parse(trimmed));
                    } catch {
                        try {
                            const sanitized = trimmed.replace(/\\([^"\\\/bfnrtu])/g, '$1');
                            keyToSave = JSON.stringify(JSON.parse(sanitized));
                        } catch {
                            keyToSave = trimmed;
                        }
                    }
                }
            }

            // Try to upsert
            const { data, error } = await supabase
                .from('google_settings')
                .upsert({
                    event_id: eventId,
                    service_account_key: keyToSave,
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

            const tabs = await getAgendaTabs(eventId);
            setAvailableTabs(tabs);
            setSelectedTabs(tabs.map(t => t.id));
        } catch (error) {
            console.error('Error loading event:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setOpenDropdown(null);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setOpenDropdown(null);
                setIsSheetsSyncModalOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const eventSlug = event ? (getEventSlug(event) || eventId) : eventId;
    const eventSlugAr = event ? (getEventSlug(event?.event_name_ar) || eventSlug) : eventSlug;

    const toggleTab = (tabId) => {
        setSelectedTabs(prev =>
            prev.includes(tabId) ? prev.filter(id => id !== tabId) : [...prev, tabId]
        );
    };

    const generateAgendaLink = (lang = 'en') => {
        const slug = lang === 'ar' ? eventSlugAr : eventSlug;
        const tabsParam = selectedTabs.length > 0 ? selectedTabs.join(',') : 'agenda';
        return `${window.location.origin}${window.location.pathname}?agenda=${slug}&lang=${lang}&tabs=${tabsParam}`;
    };

    const handleCopyAgendaLink = (lang = 'en') => {
        const link = generateAgendaLink(lang);
        navigator.clipboard.writeText(link);
        setCopiedDropdown(lang);
        setTimeout(() => setCopiedDropdown(null), 2000);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background font-manrope relative overflow-x-hidden text-foreground flex items-center justify-center">
                <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
                <div
                    className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                />
                <div className="flex flex-col items-center justify-center p-8 bg-card/50 backdrop-blur-sm text-card-foreground rounded-2xl border border-border/60 shadow-lg animate-in fade-in zoom-in-95 duration-500 relative z-10">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-athar-blue mb-4" />
                    <p className="text-muted-foreground font-semibold">Syncing with workspace...</p>
                </div>
            </div>
        );
    }

    if (!event || event.error) {
        return (
            <div className="min-h-screen bg-background font-manrope relative overflow-x-hidden text-foreground flex items-center justify-center">
                <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
                <div
                    className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                />
                <div className="bg-card/50 backdrop-blur-md rounded-3xl border border-border/60 p-12 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-500 relative z-10 max-w-md">
                    <div className="mx-auto h-16 w-16 bg-destructive/10 text-destructive rounded-2xl flex items-center justify-center mb-6 border border-destructive/20 shadow-inner">
                        <AlertCircle size={32} />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-2">Event Offline</h3>
                    <p className="text-muted-foreground mb-8 text-sm font-medium">We couldn't find the event workspace you're looking for.</p>
                    <Link to="/" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white bg-gradient-to-r from-athar-blue to-athar-black font-bold shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 transition-all">
                        Return to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const modules = [
        {
            title: "Agenda Builder",
            description: "Schedule days, track sessions, speakers, and timing blocks.",
            icon: <Calendar size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/agenda`,
            previewLink: `/agenda/${eventSlug}`,
            prefetchKey: 'agenda',
            accent: "#0052cc",
            tag: "Core",
        },
        {
            title: "Lists",
            description: "Manage and organize speakers, companies, and attendee directories.",
            icon: <LayoutGrid size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/lists`,
            prefetchKey: 'lists',
            accent: "#059669",
            tag: "Directory",
        },
        {
            title: "Form Builder",
            description: "Build custom application forms and collect participant submissions.",
            icon: <Inbox size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/forms`,
            prefetchKey: 'forms',
            accent: "#0052cc",
            tag: "Forms",
        },
        {
            title: "Mentor Booking",
            description: "Configure mentor availability, office hours, and 1:1 sessions.",
            icon: <Users size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/mentor-booking`,
            prefetchKey: 'mentor-booking',
            accent: "#9333ea",
            tag: "Mentorship",
        },
        {
            title: "Selection Process",
            description: "Review, evaluate, and vote on participant submissions and criteria.",
            icon: <ClipboardList size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/selection`,
            prefetchKey: 'selection',
            accent: "#2563eb",
            tag: "Review",
        },
        {
            title: "Library",
            description: "Upload resources, files, guides, and shared attachments.",
            icon: <BookOpen size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/library`,
            prefetchKey: 'library',
            accent: "#0284c7",
            tag: "Resources",
        },
        {
            title: "Mentoring Distribution",
            description: "Distribute mentoring sessions across rooms, tracks, and time slots.",
            icon: <Users2 size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/mentoring-distribution`,
            prefetchKey: 'mentoringDistribution',
            accent: "#ea580c",
            tag: "Operations",
        },
        {
            title: "Join Athar",
            description: "Build a public landing page showcasing ways to join your community.",
            icon: <Heart size={22} className="transition-transform group-hover:scale-110" />,
            manageLink: `/event/${eventId}/join-athar`,
            prefetchKey: 'joinAthar',
            accent: "#7c3aed",
            tag: "Community",
        },
    ];

    return (
        <div className="min-h-screen bg-background font-manrope relative overflow-x-hidden text-foreground pb-24">
            {/* Ambient Background (Matching Home Page Theme) */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />

            {/* Premium Header (Matching Home Page Theme) */}
            <div className="relative z-20 bg-background/70 backdrop-blur-xl border-b border-border/50 ; top-0 shadow-sm animate-in fade-in duration-500">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                            <Link
                                to="/"
                                className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-athar-blue/10 text-athar-blue hover:bg-athar-blue hover:text-white transition-all duration-200 border border-athar-blue/20 shadow-sm group tap-target shrink-0"
                                title="Back to Dashboard"
                            >
                                <ArrowLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                            </Link>
                            <div className="min-w-0">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editedName}
                                            onChange={(e) => setEditedName(e.target.value)}
                                            className="text-base sm:text-xl font-extrabold text-foreground tracking-tight bg-background border border-border rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all w-44 sm:w-auto"
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
                                        <button onClick={handleSaveName} disabled={isSavingName} className="p-1.5 bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-500/20 transition-colors">
                                            <Check size={16} />
                                        </button>
                                        <button onClick={() => { setEditedName(event.event_name); setIsEditingName(false); }} disabled={isSavingName} className="p-1.5 bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-colors">
                                            <X size={16} />
                                        </button>
                                    </div>
                                    
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-base sm:text-xl font-extrabold text-foreground tracking-tight truncate max-w-[150px] sm:max-w-xs md:max-w-md hover:text-athar-blue transition-colors">
                                            {event.event_name}
                                        </h1>
                                        <button
                                            onClick={() => setIsEditingName(true)}
                                            className="shrink-0 text-muted-foreground hover:text-athar-blue transition-colors p-1 rounded-md hover:bg-muted"
                                            title="Edit Event Name"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            {/* Active Users */}
                            <div className="hidden xl:block">
                                <ActiveUsers users={activeUsers} />
                            </div>

                            {/* Public Access Hub Dropdowns Group */}
                            <div className="relative flex items-center gap-1.5" ref={dropdownRef}>
                                {/* English Links Dropdown */}
                                <div className="relative">
                                    <button
                                        onClick={() => setOpenDropdown(openDropdown === 'en' ? null : 'en')}
                                        className={cn(
                                            'px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-200 flex items-center gap-1.5 border shadow-sm tap-target',
                                            openDropdown === 'en'
                                                ? 'bg-athar-blue text-white border-athar-blue shadow-md shadow-athar-blue/20'
                                                : 'bg-background border-border/60 text-foreground hover:border-athar-blue/40 hover:bg-athar-blue/5 hover:text-athar-blue'
                                        )}
                                    >
                                        <span>English Links</span>
                                        <ChevronDown size={14} className={`transition-transform duration-200 ${openDropdown === 'en' ? 'rotate-180' : ''}`} />
                                    </button>

                                    {openDropdown === 'en' && (
                                        <div className="absolute top-full mt-2 right-0 sm:right-auto sm:left-0 w-64 bg-card border border-border/60 rounded-xl shadow-xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1 mb-2">
                                                Select Tabs To Include
                                            </div>

                                            <div className="space-y-1 mb-3">
                                                {availableTabs.length > 0 ? (
                                                    availableTabs.map((tab) => (
                                                        <label
                                                            key={tab.id}
                                                            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-muted cursor-pointer text-xs font-semibold text-foreground transition-colors select-none"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedTabs.includes(tab.id)}
                                                                onChange={() => toggleTab(tab.id)}
                                                                className="rounded border-border text-athar-blue focus:ring-athar-blue w-4 h-4 cursor-pointer"
                                                            />
                                                            <span>{tab.labelEn}</span>
                                                        </label>
                                                    ))
                                                ) : (
                                                    <div className="text-xs text-muted-foreground px-2 py-1">Loading tabs...</div>
                                                )}
                                            </div>

                                            <div className="h-px bg-border/40 my-2" />

                                            <button
                                                onClick={() => handleCopyAgendaLink('en')}
                                                className="w-full py-2 px-3 bg-gradient-to-r from-athar-blue to-athar-black text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95"
                                            >
                                                {copiedDropdown === 'en' ? (
                                                    <>
                                                        <Check size={14} />
                                                        <span>Copied!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={14} />
                                                        <span>Copy Link</span>
                                                    </>
                                                )}
                                            </button>

                                            <a
                                                href={generateAgendaLink('en')}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 w-full py-1 text-[11px] font-semibold text-muted-foreground hover:text-athar-blue rounded flex items-center justify-center gap-1.5 transition-colors"
                                                onClick={() => setOpenDropdown(null)}
                                            >
                                                <ExternalLink size={12} />
                                                <span>Open Preview</span>
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Arabic Links Dropdown */}
                                <div className="relative">
                                    <button
                                        onClick={() => setOpenDropdown(openDropdown === 'ar' ? null : 'ar')}
                                        className={cn(
                                            'px-3 py-2 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1.5 border font-arabic shadow-sm tap-target',
                                            openDropdown === 'ar'
                                                ? 'bg-athar-blue text-white border-athar-blue shadow-md shadow-athar-blue/20'
                                                : 'bg-background border-border/60 text-foreground hover:border-athar-blue/40 hover:bg-athar-blue/5 hover:text-athar-blue'
                                        )}
                                        dir="rtl"
                                    >
                                        <span>الروابط العربية</span>
                                        <ChevronDown size={14} className={`transition-transform duration-200 ${openDropdown === 'ar' ? 'rotate-180' : ''}`} />
                                    </button>

                                    {openDropdown === 'ar' && (
                                        <div className="absolute top-full mt-2 right-0 w-64 bg-card border border-border/60 rounded-xl shadow-xl p-3 z-50 font-arabic animate-in fade-in zoom-in-95 duration-150" dir="rtl">
                                            <div className="text-[10px] font-black tracking-widest text-muted-foreground px-1 mb-2 text-right">
                                                اختر التبويبات المضمنة
                                            </div>

                                            <div className="space-y-1 mb-3">
                                                {availableTabs.length > 0 ? (
                                                    availableTabs.map((tab) => (
                                                        <label
                                                            key={tab.id}
                                                            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-muted cursor-pointer text-xs font-semibold text-foreground transition-colors select-none text-right"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedTabs.includes(tab.id)}
                                                                onChange={() => toggleTab(tab.id)}
                                                                className="rounded border-border text-athar-blue focus:ring-athar-blue w-4 h-4 cursor-pointer"
                                                            />
                                                            <span>{tab.labelAr}</span>
                                                        </label>
                                                    ))
                                                ) : (
                                                    <div className="text-xs text-muted-foreground px-2 py-1 text-right">جاري التحميل...</div>
                                                )}
                                            </div>

                                            <div className="h-px bg-border/40 my-2" />

                                            <button
                                                onClick={() => handleCopyAgendaLink('ar')}
                                                className="w-full py-2 px-3 bg-gradient-to-r from-athar-blue to-athar-black text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95"
                                            >
                                                {copiedDropdown === 'ar' ? (
                                                    <>
                                                        <Check size={14} />
                                                        <span>تم النسخ!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={14} />
                                                        <span>نسخ الرابط</span>
                                                    </>
                                                )}
                                            </button>

                                            <a
                                                href={generateAgendaLink('ar')}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 w-full py-1 text-[11px] font-semibold text-muted-foreground hover:text-athar-blue rounded flex items-center justify-center gap-1.5 transition-colors"
                                                onClick={() => setOpenDropdown(null)}
                                            >
                                                <ExternalLink size={12} />
                                                <span>فتح المعاينة</span>
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 sm:gap-2.5 sm:border-l sm:border-border/50 sm:pl-3">
                                {/* Google Sheets Sync Modal Trigger Button */}
                                <button
                                    onClick={() => setIsSheetsSyncModalOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-background border border-border/60 hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-600 text-foreground rounded-lg text-xs font-bold transition-all shadow-sm tap-target"
                                    title="Google Sheets Synchronization"
                                >
                                    <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
                                    <span className="hidden md:inline">Sheets Sync</span>
                                </button>

                                <SyncButton eventId={eventId} onSyncComplete={() => window.location.reload()} />

                                <button
                                    onClick={() => {
                                        setNewDuplicateName(`${event.event_name} (Copy)`);
                                        setIsDuplicateModalOpen(true);
                                    }}
                                    className="hidden sm:flex px-3 py-2 bg-background border border-border/60 hover:border-athar-blue/40 hover:bg-athar-blue/5 hover:text-athar-blue text-foreground rounded-lg text-xs font-bold transition-all shadow-sm items-center gap-1.5 tap-target"
                                >
                                    <Copy size={14} />
                                    <span>Duplicate</span>
                                </button>

                                <div className={cn(
                                    'hidden sm:block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border',
                                    event.status === 'active'
                                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                        : 'bg-muted/50 text-muted-foreground border-border/50'
                                )}>
                                    • {event.status || 'Active'}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <a
                                        href={`#/agenda/${eventSlug}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group relative overflow-hidden flex items-center gap-2 bg-gradient-to-r from-athar-blue to-athar-black text-white px-4 sm:px-5 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95 text-xs sm:text-sm"
                                    >
                                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <ExternalLink size={15} className="relative z-10" />
                                        <span className="relative z-10">View Public Agenda</span>
                                    </a>
                                    <UserNavDropdown compact={true} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">

                {/* Project Overview Banner — matches Dashboard 'Welcome Back' section */}
                <div className="mb-8 sm:mb-10 animate-in slide-in-from-bottom-4 duration-700">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                            <div className="shrink-0 bg-athar-blue p-3 sm:p-3.5 rounded-2xl shadow-lg shadow-athar-blue/20">
                                <Briefcase className="text-white" size={24} />
                            </div>
                            <div>

                                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground leading-tight">
                                    {event.event_name}
                                </h2>
                                <p className="text-muted-foreground font-medium text-sm sm:text-base mt-1.5">
                                    You have{' '}
                                    <strong className="text-primary">{modules.length} operational modules</strong>{' '}
                                    available to configure and manage.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Super Admin Only: Project Managers Management Section */}
                <ProjectManagersManager eventId={eventId} eventName={event.event_name} />

                {/* Module Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-16">

                    {modules.map((module, index) => (
                        <div
                            key={index}
                            className="group bg-card text-card-foreground rounded-2xl border border-border/60 p-5 sm:p-6 shadow-md hover:shadow-xl hover:border-athar-blue/40 hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500"
                            onClick={() => navigate(module.manageLink)}
                            onMouseEnter={() => module.prefetchKey && prefetch[module.prefetchKey]?.()}
                            style={{ animationDelay: `${index * 60}ms` }}
                        >
                            {/* Ambient top-right corner radial glow */}
                            <div className="absolute top-0 right-0 w-28 h-28 rounded-bl-full -mr-6 -mt-6 pointer-events-none transition-all duration-500 group-hover:scale-110 opacity-60"
                                style={{ background: `radial-gradient(circle, ${module.accent}18 0%, transparent 70%)` }}
                            />

                            {/* Bottom brand accent bar */}
                            <div
                                className="absolute inset-x-0 bottom-0 h-[3px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                style={{ background: `linear-gradient(to right, ${module.accent}, ${module.accent}80)` }}
                            />

                            <div className="flex justify-between items-start mb-4 relative z-10">
                                <div
                                    className="p-3 sm:p-3.5 rounded-xl shadow-sm bg-background transition-all duration-300 group-hover:scale-110"
                                    style={{
                                        color: module.accent,
                                        border: `1px solid ${module.accent}30`,
                                        boxShadow: `0 0 0 0 ${module.accent}00`,
                                    }}
                                >
                                    {module.icon}
                                </div>
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border bg-muted/40 text-muted-foreground border-border/50">
                                    {module.tag}
                                </span>
                            </div>

                            <h3 className="text-base sm:text-lg font-bold text-foreground group-hover:text-primary transition-colors tracking-tight leading-snug mb-1.5 relative z-10">
                                {module.title}
                            </h3>

                            <p className="text-xs text-muted-foreground font-medium line-clamp-2 mb-4 leading-relaxed flex-1 relative z-10">
                                {module.description}
                            </p>

                            <div className="h-px w-full bg-border/40 mb-3 relative z-10" />

                            <div className="flex items-center gap-2 mt-auto relative z-10" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => navigate(module.manageLink)}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border"
                                    style={{
                                        backgroundColor: `${module.accent}10`,
                                        color: module.accent,
                                        borderColor: `${module.accent}20`,
                                    }}
                                >
                                    <span>Manage</span>
                                    <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                                </button>
                                {module.previewLink && (
                                    <a
                                        href={`#${module.previewLink}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 bg-background text-muted-foreground hover:text-athar-blue hover:border-athar-blue/30 hover:bg-athar-blue/5 transition-all shadow-sm"
                                        title="Preview Public Page"
                                    >
                                        <ExternalLink size={13} />
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Google Sheets Synchronization Modal */}
            {isSheetsSyncModalOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setIsSheetsSyncModalOpen(false);
                    }}
                >
                    <div className="bg-card border border-border/60 shadow-2xl rounded-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-border/40 flex items-center justify-between shrink-0">
                            <div>
                                <h3 className="text-xl font-extrabold text-foreground tracking-tight flex items-center gap-2.5">
                                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                                        <FileSpreadsheet size={18} />
                                    </div>
                                    Google Sheets Synchronization
                                </h3>
                                <p className="text-xs text-muted-foreground font-semibold mt-1">
                                    Provide Google Sheets data sources to synchronize project modules.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsSheetsSyncModalOpen(false)}
                                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                                title="Close"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            {/* Section 1: Sync With Sheet */}
                            <div className="bg-muted/30 rounded-xl p-5 border border-border/60 space-y-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="bg-athar-blue/10 p-2 rounded-lg text-athar-blue">
                                        <RefreshCw size={16} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-foreground tracking-tight">Sync With Sheet</h4>
                                        <p className="text-xs text-muted-foreground">Provide a Google Sheets URL to synchronize all modules at once.</p>
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Paste Google Sheets URL here..."
                                    value={gsheetsUrl}
                                    onChange={(e) => setGsheetsUrl(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                />
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleSaveGsheetsUrl}
                                        disabled={isSavingUrl || gsheetsUrl === event?.gsheets_url}
                                        className="px-4 py-2 bg-gradient-to-r from-athar-blue to-athar-black text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isSavingUrl ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                                        <span>{isSavingUrl ? 'Saving...' : 'Save Source'}</span>
                                    </button>
                                    <a
                                        href="https://docs.google.com/spreadsheets/d/15uqLAXYvVwIFGbIp8FjG5IA1oCwjdU72Hs4ONO06WCc/copy"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-background text-foreground border border-border/60 rounded-lg text-xs font-bold hover:bg-muted hover:border-athar-blue/40 transition-all shadow-sm flex items-center justify-center gap-2"
                                    >
                                        <FileSpreadsheet size={14} />
                                        <span>Template</span>
                                    </a>
                                </div>
                            </div>

                            {/* Section 2: Selection Process Sync */}
                            <div className="bg-muted/30 rounded-xl p-5 border border-border/60 space-y-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-600">
                                        <ClipboardList size={16} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-foreground tracking-tight">Selection Process Sync</h4>
                                        <p className="text-xs text-muted-foreground">Provide a Google Sheets URL to synchronize your selection process submissions.</p>
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Paste Selection Process Google Sheets URL here..."
                                    value={selectionProcessGsheetsUrl}
                                    onChange={(e) => setSelectionProcessGsheetsUrl(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                />
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleSaveSelectionProcessGsheetsUrl}
                                        disabled={isSavingSelectionProcessUrl || selectionProcessGsheetsUrl === event?.selection_process_gsheets_url}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-600/20 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isSavingSelectionProcessUrl ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                                        <span>{isSavingSelectionProcessUrl ? 'Saving...' : 'Save Source'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-border/40 bg-muted/20 flex items-center justify-end">
                            <button
                                onClick={() => setIsSheetsSyncModalOpen(false)}
                                className="px-5 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Duplicate Event Modal */}
            {isDuplicateModalOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isDuplicating) setIsDuplicateModalOpen(false);
                    }}
                >
                    <div className="bg-card border border-border/60 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-border/40">
                            <h3 className="text-xl font-extrabold text-foreground tracking-tight">Duplicate Event</h3>
                            <p className="text-xs text-muted-foreground font-semibold mt-1">
                                This will clone the event configuration, days, agenda, experts, companies, forms, and library.
                            </p>
                        </div>
                        <div className="p-6">
                            <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">New Event Name</label>
                            <input
                                type="text"
                                value={newDuplicateName}
                                onChange={(e) => setNewDuplicateName(e.target.value)}
                                className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                placeholder="Enter a name for the duplicated event"
                                autoFocus
                                disabled={isDuplicating}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleDuplicate();
                                    if (e.key === 'Escape' && !isDuplicating) setIsDuplicateModalOpen(false);
                                }}
                            />
                        </div>
                        <div className="p-6 border-t border-border/40 bg-muted/20 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setIsDuplicateModalOpen(false)}
                                disabled={isDuplicating}
                                className="px-5 py-2.5 rounded-lg text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDuplicate}
                                disabled={isDuplicating || !newDuplicateName.trim()}
                                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-athar-blue to-athar-black text-white hover:opacity-95 shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isDuplicating ? (
                                    <>
                                        <Loader2 size={15} className="animate-spin" />
                                        <span>Duplicating...</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy size={15} />
                                        <span>Duplicate</span>
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
