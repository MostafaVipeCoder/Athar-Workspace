import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    ArrowLeft, Settings, Users, Calendar, Link2, Play, RefreshCw,
    AlertTriangle, Check, Copy, ExternalLink, ChevronDown, ChevronUp,
    Eye, Grid3X3, Zap, Clock, Sun, Coffee, Trash2, Save, Loader2,
    AlertCircle, CheckCircle2, Info, ToggleLeft, ToggleRight,
    UserCheck, UserX, ShieldCheck, ShieldAlert, Sparkles, Plus, Search, X,
    Database, CheckCircle, SlidersHorizontal
} from 'lucide-react';
import {
    getDistributionConfig,
    saveDistributionConfig,
    getDistributionSessions,
    clearDistributionSessions,
    saveDistributionSessions,
    generateDistribution,
    generateDistributionFlexible,
    validateDistribution,
    calcSlotsPerDay,
    calculateSlotTime,
    updateSession,
    publishDistribution,
    buildMatrix,
    isMentorAvailableOnDay,
    getDayConfigs,
    saveDayConfig,
    resolveDayEffectiveConfig,
    calculateDaySlotTimes,
    DEFAULT_PER_DAY_CONFIG,
} from '../lib/mentoringDistribution';
import { supabase } from '../lib/supabase';
import { getGoogleDriveFallbackUrls } from '../lib/utils';


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const copyToClipboard = (text, setCopied) => {
    navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });
};

const TabButton = ({ active, onClick, icon, label, badge }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-extrabold border-b-2 transition-all duration-200 whitespace-nowrap cursor-pointer ${
            active
                ? 'border-athar-blue text-athar-blue bg-athar-blue/5 rounded-t-lg'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
        }`}
    >
        {icon}
        {label}
        {badge > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-rose-500 text-white rounded-full">
                {badge}
            </span>
        )}
    </button>
);

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function MentoringDistributionAdmin() {
    const { eventId } = useParams();
    const [activeTab, setActiveTab] = useState('config');
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);

    // Config state
    const [config, setConfig] = useState({
        event_id: eventId,
        start_time: '09:00',
        num_days: 1,
        total_round_minutes: 300,
        slot_duration_minutes: 15,
        break_slots: [],
        unique_pairing: true,
        mentor_availability: {},
        is_published: false,
    });

    // Data state
    const [mentors, setMentors] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [conflicts, setConflicts] = useState([]);
    const [copiedLink, setCopiedLink] = useState(null);
    const [mentorSearch, setMentorSearch] = useState('');
    const [editingSession, setEditingSession] = useState(null);

    // Break slot editing
    const [newBreak, setNewBreak] = useState({ after_slot: '', duration_minutes: 15 });

    // --- Per-Day Flexible Schedule State (NEW) ---
    const [dayConfigs, setDayConfigs] = useState([]);
    const [eventDays, setEventDays] = useState([]);
    const [dayEdits, setDayEdits] = useState({});
    const [configDirtyByDay, setConfigDirtyByDay] = useState({});
    const [selectedMentorsByDay, setSelectedMentorsByDay] = useState({});
    const [savingDay, setSavingDay] = useState(null);
    const [globalUseCustom, setGlobalUseCustom] = useState(false);
    const [globalCustomMins, setGlobalCustomMins] = useState(25);
    const [globalSlotMins, setGlobalSlotMins] = useState(20);
    const [globalStartTime, setGlobalStartTime] = useState('09:00');
    const [genResultByDay, setGenResultByDay] = useState({});

    const DAY_PRESETS = [
        { label: '1D', value: 1 },
        { label: '2D', value: 2 },
        { label: '3D', value: 3 },
    ];
    const SLOT_PRESETS = [10, 15, 20, 30];

    const slotsPerDay = calcSlotsPerDay(config.total_round_minutes, config.slot_duration_minutes);
    const criticalConflicts = conflicts.filter(c => !c.is_warning);
    const warningNotices = conflicts.filter(c => c.is_warning);

    // ── Load Data ────────────────────────────────────────────
    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            // Load config
            const cfg = await getDistributionConfig(eventId);
            if (cfg) {
                setConfig({
                    event_id: eventId,
                    start_time: cfg.start_time?.slice(0, 5) || '09:00',
                    num_days: cfg.num_days || 1,
                    total_round_minutes: cfg.total_round_minutes || 300,
                    slot_duration_minutes: cfg.slot_duration_minutes || 15,
                    break_slots: cfg.break_slots || [],
                    unique_pairing: cfg.unique_pairing ?? true,
                    mentor_availability: cfg.mentor_availability || {},
                    is_published: cfg.is_published || false,
                });
                setGlobalStartTime(cfg.start_time?.slice(0, 5) || '09:00');
                const sdm = cfg.slot_duration_minutes || 15;
                if ([10, 15, 20, 30].includes(sdm)) {
                    setGlobalSlotMins(sdm);
                    setGlobalUseCustom(false);
                } else {
                    setGlobalCustomMins(sdm);
                    setGlobalUseCustom(true);
                }
            } else {
                setConfig(prev => ({ ...prev, event_id: eventId }));
            }

            // Load per-day flexible configs (NEW)
            try {
                const dcs = await getDayConfigs(eventId);
                setDayConfigs(dcs || []);
                const newEdits = {};
                for (const c of (dcs || [])) {
                    newEdits[c.day_index] = { ...c };
                }
                setDayEdits(newEdits);

                const sel = {};
                for (const c of (dcs || [])) {
                    if (c.mentor_ids && c.mentor_ids.length) {
                        sel[c.day_index] = [...c.mentor_ids];
                    }
                }
                setSelectedMentorsByDay(sel);
            } catch (e) {
                console.warn('Day configs table not ready yet:', e.message);
                setDayConfigs([]);
            }

            // Load event days
            try {
                const { data: edData } = await supabase
                    .from('event_days')
                    .select('*')
                    .eq('event_id', eventId)
                    .order('day_number', { ascending: true });
                setEventDays(edData || []);
            } catch (e) {
                console.warn('event_days load failed:', e.message);
            }

            // Load sessions
            const sess = await getDistributionSessions(eventId);
            setSessions(sess);
            if (sess.length) {
                setConflicts(validateDistribution(sess, cfg?.unique_pairing ?? true));
            }

            // Load mentors from experts table (Lists → Mentors)
            const { data: mentorData } = await supabase
                .from('experts')
                .select('*, master:master_experts(*)')
                .eq('event_id', eventId)
                .order('sort_order', { ascending: true });
            setMentors((mentorData || []).map(exp => {
                const combined = { ...exp.master, ...exp };
                return {
                    id: combined.expert_id,
                    name: combined.name,
                    title: combined.title,
                    photo_url: combined.photo_url
                };
            }));

            // Load companies from companies table (Lists → Startups)
            const { data: companyData } = await supabase
                .from('companies')
                .select('company_id, name')
                .eq('event_id', eventId)
                .order('name', { ascending: true });
            setCompanies((companyData || []).map(c => ({ id: c.company_id, name: c.name })));
        } catch (err) {
            console.error('Error loading distribution data:', err);
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    useEffect(() => { loadAll(); }, [loadAll]);

    // ── Save Config ──────────────────────────────────────────
    const handleSaveConfig = async () => {
        setSaving(true);
        try {
            await saveDistributionConfig(eventId, config);
            alert('✅ Settings saved successfully!');
        } catch (err) {
            alert(`❌ Save failed: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    // ── Mentor Management Helpers ─────────────────────────────
    const handleMentorAvailabilityChange = (mentorId, newAvailability) => {
        setConfig(prev => ({
            ...prev,
            mentor_availability: {
                ...prev.mentor_availability,
                [mentorId]: newAvailability,
            }
        }));
    };

    const handleToggleMentorDay = (mentorId, dayIdx) => {
        const currentAvail = config.mentor_availability[mentorId];
        let currentDays = [];

        if (currentAvail === undefined || currentAvail === null || currentAvail === 'all') {
            currentDays = Array.from({ length: config.num_days }, (_, i) => i);
        } else if (Array.isArray(currentAvail)) {
            currentDays = [...currentAvail];
        } else if (typeof currentAvail === 'string' && currentAvail.startsWith('day_')) {
            currentDays = [parseInt(currentAvail.replace('day_', ''), 10)];
        } else if (currentAvail === 'excluded' || currentAvail === 'none') {
            currentDays = [];
        }

        let updatedDays = [];
        if (currentDays.includes(dayIdx)) {
            updatedDays = currentDays.filter(d => d !== dayIdx);
        } else {
            updatedDays = [...currentDays, dayIdx].sort((a, b) => a - b);
        }

        let finalVal = updatedDays;
        if (updatedDays.length === config.num_days) finalVal = 'all';
        else if (updatedDays.length === 0) finalVal = 'excluded';

        handleMentorAvailabilityChange(mentorId, finalVal);
    };

    const handleRemoveMentor = async (mentorId, mentorName) => {
        const confirm = window.confirm(`Are you sure you want to remove mentor "${mentorName}" from this event?`);
        if (!confirm) return;

        try {
            // Delete from database
            const { error } = await supabase.from('experts').delete().eq('expert_id', mentorId);
            if (error) throw error;

            // Remove from mentors state
            setMentors(prev => prev.filter(m => m.id !== mentorId));

            // Clean availability
            setConfig(prev => {
                const updated = { ...prev.mentor_availability };
                delete updated[mentorId];
                return { ...prev, mentor_availability: updated };
            });

            alert(`✅ Mentor "${mentorName}" removed.`);
        } catch (err) {
            alert(`❌ Error removing mentor: ${err.message}`);
        }
    };

    // ── Generate Distribution ────────────────────────────────
    const handleGenerate = async () => {
        if (!mentors.length) return alert('⚠️ No mentors available! Please add mentors first.');
        if (!companies.length) return alert('⚠️ No startups available! Please add startups first.');

        const activeMentorsCount = mentors.filter(m => {
            const avail = config.mentor_availability[m.id];
            return avail !== 'excluded' && avail !== 'none';
        }).length;

        if (!activeMentorsCount) return alert('⚠️ All mentors are marked as Not Available/Excluded!');

        const confirmed = window.confirm(
            `Generating schedule will overwrite current sessions.\n\n` +
            `Mentors: ${mentors.length} (${activeMentorsCount} active) | Startups: ${companies.length}\n` +
            `Event Days: ${config.num_days} | Slots/Day (Global): ${slotsPerDay}\n` +
            `Unique Pairing: ${config.unique_pairing ? 'Enabled (No Repeat)' : 'Disabled'}\n` +
            `Per-Day Configs: ${dayConfigs.length} saved override(s)\n\n` +
            `Do you want to proceed?`
        );
        if (!confirmed) return;

        setGenerating(true);
        try {
            await saveDistributionConfig(eventId, config);

            const newSessions = generateDistributionFlexible(
                { ...config, event_id: eventId },
                dayConfigs,
                mentors,
                companies
            );

            await clearDistributionSessions(eventId);
            await saveDistributionSessions(newSessions, eventId);

            setSessions(newSessions);
            const newConflicts = validateDistribution(newSessions, config.unique_pairing);
            setConflicts(newConflicts);

            setActiveTab('config');
            if (newConflicts.length) {
                alert(`⚠️ Generated with ${newConflicts.length} conflict(s). Please review the settings tab.`);
            } else {
                alert('✅ Schedule generated successfully with zero conflicts!');
            }
        } catch (err) {
            alert(`❌ Generation failed: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // Per-Day Flexible Schedule Handlers (NEW)
    // ─────────────────────────────────────────────────────────────
    const timeTo12Hour = (t) => {
        if (!t) return '';
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    const getDayConfigOrDefault = (dayIndex) => {
        const saved = dayConfigs.find(c => c.day_index === dayIndex);
        const edited = dayEdits[dayIndex];
        return {
            day_index: dayIndex,
            day_date: eventDays[dayIndex]?.day_date || null,
            session_start_time: globalStartTime,
            session_end_time: null,
            total_round_minutes: config.total_round_minutes,
            slot_duration_minutes: globalUseCustom
                ? (parseInt(globalCustomMins, 10) || 20)
                : (parseInt(globalSlotMins, 10) || 20),
            break_between_slots_minutes: 0,
            mentor_ids: selectedMentorsByDay[dayIndex] || [],
            ...(saved || {}),
            ...(edited || {})
        };
    };

    const handleDayFieldChange = (dayIndex, field, value) => {
        setDayEdits(prev => ({
            ...prev,
            [dayIndex]: {
                ...(prev[dayIndex] || getDayConfigOrDefault(dayIndex)),
                [field]: value
            }
        }));
        setConfigDirtyByDay(prev => ({ ...prev, [dayIndex]: true }));
    };

    const handleApplyGlobalToAllDays = () => {
        const slotDur = globalUseCustom
            ? (parseInt(globalCustomMins, 10) || 20)
            : (parseInt(globalSlotMins, 10) || 20);
        const newDayEdits = { ...dayEdits };
        const dirty = {};
        for (let d = 0; d < config.num_days; d++) {
            const existing = newDayEdits[d] || getDayConfigOrDefault(d);
            newDayEdits[d] = {
                ...existing,
                session_start_time: globalStartTime,
                slot_duration_minutes: slotDur,
                total_round_minutes: config.total_round_minutes,
                break_between_slots_minutes: 0,
            };
            dirty[d] = true;
        }
        setDayEdits(newDayEdits);
        setConfigDirtyByDay(dirty);
    };

    const handleSaveDayConfig = async (dayIndex) => {
        try {
            setSavingDay(dayIndex);
            const cfg = getDayConfigOrDefault(dayIndex);
            const saved = await saveDayConfig(eventId, dayIndex, {
                ...cfg,
                mentor_ids: selectedMentorsByDay[dayIndex] || [],
            });
            setDayConfigs(prev => {
                const others = prev.filter(c => c.day_index !== dayIndex);
                return [...others, saved].sort((a, b) => a.day_index - b.day_index);
            });
            setDayEdits(prev => ({ ...prev, [dayIndex]: saved }));
            setConfigDirtyByDay(prev => ({ ...prev, [dayIndex]: false }));
            setGenResultByDay(prev => ({ ...prev, [dayIndex]: null }));
        } catch (error) {
            console.error('Error saving day config:', error);
            alert('Error saving schedule: ' + (error.message || 'Unknown error'));
        } finally {
            setSavingDay(null);
        }
    };

    const handleToggleMentorForDay = (dayIndex, mentorId) => {
        setSelectedMentorsByDay(prev => {
            const current = new Set(prev[dayIndex] || []);
            if (current.has(mentorId)) current.delete(mentorId);
            else current.add(mentorId);
            return { ...prev, [dayIndex]: [...current] };
        });
        setConfigDirtyByDay(prev => ({ ...prev, [dayIndex]: true }));
    };

    const handleSelectAllMentorsForDay = (dayIndex) => {
        setSelectedMentorsByDay(prev => ({
            ...prev,
            [dayIndex]: mentors.map(m => m.id)
        }));
        setConfigDirtyByDay(prev => ({ ...prev, [dayIndex]: true }));
    };

    const handleClearMentorsForDay = (dayIndex) => {
        setSelectedMentorsByDay(prev => ({
            ...prev,
            [dayIndex]: []
        }));
        setConfigDirtyByDay(prev => ({ ...prev, [dayIndex]: true }));
    };

    // ── Toggle Publish ───────────────────────────────────────
    const handleTogglePublish = async () => {
        const newVal = !config.is_published;
        try {
            await publishDistribution(eventId, newVal);
            setConfig(prev => ({ ...prev, is_published: newVal }));
        } catch (err) {
            alert(`❌ Action failed: ${err.message}`);
        }
    };

    // ── Break Slots ──────────────────────────────────────────
    const addBreakSlot = () => {
        if (newBreak.after_slot === '') return;
        const updated = [...config.break_slots, { ...newBreak, after_slot: parseInt(newBreak.after_slot) }];
        setConfig(prev => ({ ...prev, break_slots: updated }));
        setNewBreak({ after_slot: '', duration_minutes: 15 });
    };

    const removeBreakSlot = (idx) => {
        setConfig(prev => ({ ...prev, break_slots: prev.break_slots.filter((_, i) => i !== idx) }));
    };

    // ── Links ────────────────────────────────────────────────
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const liveLink = `${baseUrl}#/view/${eventId}/mentoring/live`;
    const matrixLink = `${baseUrl}#/view/${eventId}/mentoring/matrix`;

    const matrix = sessions.length
        ? buildMatrix(sessions, mentors, slotsPerDay, config.num_days)
        : null;

    const filteredMentors = mentors.filter(m =>
        m.name.toLowerCase().includes(mentorSearch.toLowerCase()) ||
        (m.title && m.title.toLowerCase().includes(mentorSearch.toLowerCase()))
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background font-manrope">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-athar-blue mx-auto" />
                    <p className="mt-4 text-muted-foreground font-bold">Loading Mentoring Distribution System...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background font-manrope text-foreground relative overflow-x-hidden" dir="ltr">
            {/* Background Atmosphere */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />

            {/* ── Premium Header ─────────────────────────────────── */}
            <div className="relative z-50 bg-background/70 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm animate-in fade-in duration-500">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3.5">
                            <Link
                                to={`/event/${eventId}`}
                                className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-background border border-border/60 text-foreground hover:bg-athar-blue/5 hover:text-athar-blue hover:border-athar-blue/30 transition-all shadow-sm"
                                title="Back to Event Dashboard"
                            >
                                <ArrowLeft size={18} />
                            </Link>
                            <div className="flex items-center gap-3">
                                <div className="bg-athar-blue p-2 sm:p-2.5 rounded-xl shadow-lg shadow-athar-blue/20 text-white flex items-center justify-center">
                                    <Grid3X3 size={20} />
                                </div>
                                <div>
                                    <h1 className="text-base sm:text-lg font-extrabold text-athar-black tracking-tight flex items-center gap-2">
                                        1-1 Mentoring <span className="text-athar-blue">Distribution</span>
                                    </h1>
                                    <p className="text-[10px] font-bold text-athar-black/40 uppercase tracking-widest mt-0.5">
                                        Schedule & Matchmaking Manager
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Publish toggle & Generate button */}
                        <div className="flex items-center gap-2 sm:gap-3">
                            <span className="text-xs font-bold text-muted-foreground hidden sm:inline">Status</span>
                            <button
                                onClick={handleTogglePublish}
                                className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-full text-xs font-bold transition-all duration-300 ${
                                    config.is_published
                                        ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shadow-sm'
                                        : 'bg-muted text-muted-foreground border border-border/60'
                                }`}
                                title="Publish or Unpublish public links"
                            >
                                {config.is_published ? <ToggleRight size={16} className="text-emerald-600" /> : <ToggleLeft size={16} />}
                                {config.is_published ? 'Published' : 'Draft'}
                            </button>

                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="flex items-center gap-2 px-3.5 py-2 sm:px-5 sm:py-2.5 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 disabled:opacity-50 shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                            >
                                {generating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                <span>{generating ? 'Generating...' : 'Generate Schedule'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Conflict & Warning Banner ────────────────────────────── */}
            {criticalConflicts.length > 0 ? (
                <div className="relative z-40 bg-rose-500/10 border-b border-rose-500/20 px-4 py-3">
                    <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={16} className="text-rose-500 shrink-0" />
                            <p className="text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-400">
                                <strong>{criticalConflicts.length}</strong> critical conflict(s) detected in the current schedule.
                            </p>
                        </div>
                        <button
                            onClick={() => setActiveTab('config')}
                            className="text-xs font-extrabold text-rose-600 underline hover:text-rose-700"
                        >
                            View & Resolve
                        </button>
                    </div>
                </div>
            ) : warningNotices.length > 0 && !bannerDismissed ? (
                <div className="relative z-40 bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
                    <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <Info size={16} className="text-amber-500 shrink-0" />
                            <p className="text-xs sm:text-sm font-semibold text-amber-700 dark:text-amber-400">
                                <strong>{warningNotices.length}</strong> notice(s): Unique pairing limit reached for some slots (mentors met all startups).
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setActiveTab('config')}
                                className="text-xs font-extrabold text-amber-600 underline hover:text-amber-700 cursor-pointer"
                            >
                                View Details
                            </button>
                            <button
                                onClick={() => setBannerDismissed(true)}
                                className="p-1 rounded-lg hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 transition-colors cursor-pointer"
                                title="Dismiss notice"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* ── Tabs Navigation ─────────────────────────────────── */}
            <div className="relative z-40 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-16 shadow-xs">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex gap-1 overflow-x-auto">
                        <TabButton active={activeTab === 'config'} onClick={() => setActiveTab('config')} icon={<Settings size={16} />} label="Settings" badge={criticalConflicts.length} />
                        <TabButton active={activeTab === 'participants'} onClick={() => setActiveTab('participants')} icon={<Users size={16} />} label={`Participants (${mentors.length} Mentors / ${companies.length} Startups)`} />
                        <TabButton active={activeTab === 'links'} onClick={() => setActiveTab('links')} icon={<Link2 size={16} />} label="Public Links" />
                    </div>
                </div>
            </div>

            {/* ── Tab Content ────────────────────────────────────── */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* ═══ CONFIG TAB ═══════════════════════════════════ */}
                {activeTab === 'config' && (
                    <div className="space-y-8 max-w-4xl font-manrope">
                        {/* Stats Summary if sessions exist */}
                        {sessions.length > 0 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="bg-card border border-border/60 rounded-2xl p-4 text-center shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-athar-blue/10 to-transparent rounded-bl-full pointer-events-none" />
                                        <p className="text-2xl font-extrabold text-athar-blue">{mentors.length}</p>
                                        <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-wider">Mentors</p>
                                    </div>
                                    <div className="bg-card border border-border/60 rounded-2xl p-4 text-center shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-athar-blue/10 to-transparent rounded-bl-full pointer-events-none" />
                                        <p className="text-2xl font-extrabold text-athar-blue">{companies.length}</p>
                                        <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-wider">Startups</p>
                                    </div>
                                    <div className="bg-card border border-border/60 rounded-2xl p-4 text-center shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-athar-blue/10 to-transparent rounded-bl-full pointer-events-none" />
                                        <p className="text-2xl font-extrabold text-athar-blue">{config.num_days}</p>
                                        <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-wider">Event Days</p>
                                    </div>
                                    <div className="bg-card border border-border/60 rounded-2xl p-4 text-center shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-athar-blue/10 to-transparent rounded-bl-full pointer-events-none" />
                                        <p className="text-2xl font-extrabold text-athar-blue">
                                            {sessions.filter(s => s.company_name && !s.is_break).length}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-wider">Assigned Sessions</p>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-4">
                                    <div className="flex-1 bg-card border border-border/60 rounded-2xl p-5 shadow-sm flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-extrabold text-foreground tracking-tight">Distribution Matrix</h3>
                                            <p className="text-xs text-muted-foreground mt-1">The mentoring matrix is ready.</p>
                                        </div>
                                        <a
                                            href={matrixLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-athar-blue/20"
                                        >
                                            <ExternalLink size={14} /> Fullscreen Matrix
                                        </a>
                                    </div>

                                    {criticalConflicts.length > 0 ? (
                                        <div className="flex-1 bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 shadow-sm flex items-center gap-3">
                                            <AlertTriangle className="text-rose-500 shrink-0" size={24} />
                                            <div>
                                                <h4 className="text-sm font-extrabold text-rose-600 dark:text-rose-400">
                                                    {criticalConflicts.length} Conflicts Detected
                                                </h4>
                                                <p className="text-xs text-rose-500/80 mt-0.5">Please review constraints or re-generate.</p>
                                            </div>
                                        </div>
                                    ) : warningNotices.length > 0 ? (
                                        <div className="flex-1 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 shadow-sm flex items-center gap-3">
                                            <Info className="text-amber-500 shrink-0" size={24} />
                                            <div>
                                                <h4 className="text-sm font-extrabold text-amber-700 dark:text-amber-400">
                                                    {warningNotices.length} Unique Pairing Notices
                                                </h4>
                                                <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">Mentors have met all startups; empty slots are expected.</p>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>

                                {criticalConflicts.length > 0 && (
                                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 space-y-2 shadow-sm">
                                        <h4 className="text-xs font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-2">
                                            <AlertTriangle size={14} /> Critical Conflict Report
                                        </h4>
                                        <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                                            {criticalConflicts.map((c, idx) => (
                                                <li key={idx} className="text-xs font-semibold text-rose-600 dark:text-rose-300">
                                                    • {c.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {warningNotices.length > 0 && (
                                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-2 shadow-sm">
                                        <h4 className="text-xs font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-2">
                                            <Info size={14} /> Schedule Notices (Unique Pairing Limit)
                                        </h4>
                                        <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                                            {warningNotices.map((c, idx) => (
                                                <li key={idx} className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                                    • {c.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Distribution Mode & Constraints */}
                        <div className="bg-card border border-border/60 rounded-2xl p-6 space-y-6 shadow-md hover:shadow-lg transition-all overflow-hidden relative">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-athar-blue/10 p-2.5 rounded-xl text-athar-blue border border-athar-blue/10">
                                    <ShieldCheck size={20} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-extrabold text-foreground tracking-tight">Distribution Algorithm Rules</h2>
                                    <p className="text-xs sm:text-sm text-muted-foreground">Configure constraints and fair assignment logic</p>
                                </div>
                            </div>

                            {/* Unique Pairing Toggle */}
                            <div className="flex items-start justify-between gap-4 p-4.5 rounded-xl bg-gradient-to-r from-athar-blue/5 via-athar-blue/[0.02] to-transparent border border-athar-blue/15">
                                <div className="space-y-1">
                                    <label className="text-sm font-extrabold text-foreground flex items-center gap-2 cursor-pointer">
                                        <Sparkles size={16} className="text-athar-blue" />
                                        Unique Pairing (No Repeat Across Days)
                                    </label>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        When enabled, no startup can meet the same mentor more than once throughout all event days.
                                        If Startup X meets Mentor Y on Day 1, the pair (X-Y) is permanently excluded on Day 2 & Day 3.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setConfig(p => ({ ...p, unique_pairing: !p.unique_pairing }))}
                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        config.unique_pairing ? 'bg-athar-blue shadow-md shadow-athar-blue/30' : 'bg-muted-foreground/30'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            config.unique_pairing ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        {/* Time & Slot Settings (Flexible Day-by-Day) */}
                        <div className="bg-card border border-border/60 rounded-2xl p-6 space-y-8 shadow-md hover:shadow-lg transition-all overflow-hidden relative">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-athar-blue/10 p-2.5 rounded-xl text-athar-blue border border-athar-blue/10">
                                    <Clock size={20} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between gap-4 flex-wrap">
                                        <div>
                                            <h2 className="text-base sm:text-lg font-extrabold text-foreground tracking-tight">Time & Slot Settings</h2>
                                            <p className="text-xs sm:text-sm text-muted-foreground">Day-by-Day flexible schedule: set global defaults then fine-tune each day individually</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-3 py-1.5 rounded-full bg-athar-blue/10 text-athar-blue text-[10px] font-extrabold uppercase tracking-widest border border-athar-blue/20">
                                                <SlidersHorizontal size={12} className="inline mr-1.5" />
                                                Per-Day Mode
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ──────────── GLOBAL DEFAULTS PANEL ──────────── */}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-5 bg-gradient-to-br from-athar-blue/5 via-background to-transparent border border-athar-blue/15 rounded-2xl">
                                {/* Number of Days */}
                                <div>
                                    <label className="block text-[10px] font-extrabold text-athar-blue/70 uppercase tracking-[0.18em] mb-3">
                                        Number of Event Days
                                    </label>
                                    <div className="flex gap-2 flex-wrap">
                                        {DAY_PRESETS.map(p => (
                                            <button
                                                key={p.value}
                                                type="button"
                                                onClick={() => setConfig(p => ({ ...p, num_days: p.value }))}
                                                className={`flex-1 min-w-[68px] px-4 py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-200 border ${
                                                    config.num_days === p.value
                                                        ? 'bg-gradient-to-r from-athar-blue to-athar-black text-white border-transparent shadow-md shadow-athar-blue/30'
                                                        : 'bg-background border-border/60 text-muted-foreground hover:text-foreground hover:border-athar-blue/40 hover:bg-athar-blue/5'
                                                }`}
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                        <input
                                            type="number"
                                            min={1}
                                            max={14}
                                            value={config.num_days}
                                            onChange={(e) => setConfig(p => ({ ...p, num_days: Math.max(1, Math.min(14, parseInt(e.target.value, 10) || 1)) }))}
                                            className="w-20 px-3 py-3 bg-background border-2 border-border/60 focus:border-athar-blue/40 rounded-xl text-sm font-extrabold text-center focus:outline-none focus:ring-2 focus:ring-athar-blue/20"
                                        />
                                    </div>
                                </div>

                                {/* Global Start Time */}
                                <div>
                                    <label className="block text-[10px] font-extrabold text-athar-blue/70 uppercase tracking-[0.18em] mb-3">
                                        Global Start Time
                                    </label>
                                    <div className="space-y-2">
                                        <input
                                            type="time"
                                            value={globalStartTime}
                                            onChange={(e) => {
                                                setGlobalStartTime(e.target.value);
                                                setConfig(p => ({ ...p, start_time: e.target.value }));
                                            }}
                                            className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue transition-all"
                                        />
                                        <p className="text-[10px] text-muted-foreground font-bold">
                                            {timeTo12Hour(globalStartTime)} • stored: <code className="font-mono">{config.start_time}</code>
                                        </p>
                                    </div>
                                </div>

                                {/* Slot Duration Presets */}
                                <div>
                                    <label className="block text-[10px] font-extrabold text-athar-blue/70 uppercase tracking-[0.18em] mb-3">
                                        Default Slot Duration
                                    </label>
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {SLOT_PRESETS.map(mins => (
                                                <button
                                                    key={mins}
                                                    type="button"
                                                    onClick={() => {
                                                        setGlobalSlotMins(mins);
                                                        setGlobalUseCustom(false);
                                                        setConfig(p => ({ ...p, slot_duration_minutes: mins }));
                                                    }}
                                                    className={`py-2.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all duration-200 border ${
                                                        !globalUseCustom && globalSlotMins === mins
                                                            ? 'bg-gradient-to-r from-athar-blue to-athar-black text-white border-transparent shadow-sm shadow-athar-blue/20'
                                                            : 'bg-background border-border/60 text-muted-foreground hover:text-foreground hover:border-athar-blue/40'
                                                    }`}
                                                >
                                                    {mins}m
                                                </button>
                                            ))}
                                        </div>
                                        <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 border ${
                                            globalUseCustom
                                                ? 'bg-gradient-to-r from-athar-blue to-athar-black text-white border-transparent shadow-sm shadow-athar-blue/20'
                                                : 'bg-background border-border/60 text-muted-foreground hover:text-foreground hover:border-athar-blue/40'
                                        }`}>
                                            <input
                                                type="checkbox"
                                                className="sr-only"
                                                checked={globalUseCustom}
                                                onChange={(e) => setGlobalUseCustom(e.target.checked)}
                                            />
                                            Custom
                                        </label>
                                        {globalUseCustom && (
                                            <input
                                                type="number"
                                                min={5}
                                                max={240}
                                                step={5}
                                                value={globalCustomMins}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value, 10) || 25;
                                                    setGlobalCustomMins(v);
                                                    setConfig(p => ({ ...p, slot_duration_minutes: v }));
                                                }}
                                                className="w-full px-4 py-2.5 bg-athar-blue/5 border border-athar-blue/20 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue/40"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Apply Button + Total Round */}
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-[10px] font-extrabold text-athar-blue/70 uppercase tracking-[0.18em] mb-2">
                                            Total Round (Min)
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={30}
                                                max={720}
                                                step={15}
                                                value={config.total_round_minutes}
                                                onChange={e => setConfig(p => ({ ...p, total_round_minutes: parseInt(e.target.value) || 300 }))}
                                                className="flex-1 px-3 py-3 bg-background border border-border/60 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue"
                                            />
                                            <span className="text-[11px] font-extrabold text-muted-foreground whitespace-nowrap">
                                                {Math.floor(config.total_round_minutes / 60)}h {config.total_round_minutes % 60}m
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleApplyGlobalToAllDays}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-extrabold uppercase tracking-widest bg-gradient-to-r from-athar-blue to-athar-black text-white shadow-lg shadow-athar-blue/30 hover:shadow-athar-blue/50 hover:-translate-y-0.5 active:scale-95 transition-all duration-200 cursor-pointer"
                                    >
                                        <Database size={14} />
                                        Apply to All {config.num_days} Days
                                    </button>
                                </div>
                            </div>

                            {/* Global Summary */}
                            <div className="bg-gradient-to-r from-athar-blue/10 via-athar-blue/[0.06] to-transparent border border-athar-blue/20 rounded-2xl p-5 shadow-sm">
                                <p className="text-sm font-extrabold text-athar-blue mb-2 flex items-center gap-2">
                                    <Info size={15} /> Global Defaults Summary (for days without overrides)
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Slots/Mentor/Day</p>
                                        <p className="text-2xl font-black text-athar-black mt-1">{slotsPerDay}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Formula</p>
                                        <p className="text-xs text-muted-foreground font-bold mt-1 leading-relaxed">
                                            {config.total_round_minutes} ÷ {config.slot_duration_minutes} = {slotsPerDay}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Mentors × Days</p>
                                        <p className="text-2xl font-black text-athar-black mt-1">{mentors.length} × {config.num_days}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Max Capacity</p>
                                        <p className="text-2xl font-black text-athar-blue mt-1">
                                            {slotsPerDay * mentors.length * config.num_days}
                                        </p>
                                        <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mt-0.5">sessions</p>
                                    </div>
                                </div>
                            </div>

                            {/* ──────────── DAY CARDS ──────────── */}
                            <div className="space-y-5">
                                <div className="flex items-center justify-between gap-4 pt-2">
                                    <h3 className="text-sm font-extrabold text-athar-black uppercase tracking-wider flex items-center gap-2">
                                        <Calendar size={16} className="text-athar-blue" />
                                        Per-Day Configuration ({config.num_days} Day{config.num_days === 1 ? '' : 's'})
                                    </h3>
                                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                        Unsaved = {Object.keys(configDirtyByDay).filter(k => configDirtyByDay[k]).length} • Saved Overrides = {dayConfigs.length}
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                    {Array.from({ length: config.num_days }, (_, idx) => {
                                        const dayIndex = idx;
                                        const dayNumber = idx + 1;
                                        const cfg = getDayConfigOrDefault(dayIndex);
                                        const eff = resolveDayEffectiveConfig(config, [cfg], dayIndex);
                                        const preview = calculateDaySlotTimes(eff);
                                        const dayMeta = eventDays[dayIndex];
                                        const isDirty = configDirtyByDay[dayIndex];
                                        const isSaving = savingDay === dayIndex;
                                        const selectedMentorIds = selectedMentorsByDay[dayIndex] || [];
                                        const hasOverride = dayConfigs.some(c => c.day_index === dayIndex);

                                        return (
                                            <div key={dayIndex} className="bg-background border border-border/60 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
                                                {/* Day Header */}
                                                <div className={`px-6 py-5 border-b border-border/60 flex items-center justify-between gap-4 flex-wrap ${
                                                    hasOverride ? 'bg-gradient-to-r from-athar-blue/[0.08] via-transparent to-transparent' : ''
                                                }`}>
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg shadow-lg border-2 border-white ${
                                                            hasOverride
                                                                ? 'bg-gradient-to-br from-athar-blue to-athar-black text-white shadow-athar-blue/30'
                                                                : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500'
                                                        }`}>
                                                            D{dayNumber}
                                                        </div>
                                                        <div>
                                                            <h4 className="font-black text-base sm:text-lg text-athar-black uppercase tracking-tight flex items-center gap-2">
                                                                Day {dayNumber}
                                                                {dayMeta?.day_name && (
                                                                    <span className="text-xs font-bold text-muted-foreground normal-case tracking-normal">
                                                                        ({dayMeta.day_name})
                                                                    </span>
                                                                )}
                                                            </h4>
                                                            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mt-0.5">
                                                                {dayMeta?.day_date
                                                                    ? new Date(dayMeta.day_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                                                                    : 'No date linked — set in Event Agenda'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {hasOverride && !isDirty && (
                                                            <span className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                                                                Custom
                                                            </span>
                                                        )}
                                                        {!hasOverride && (
                                                            <span className="px-3 py-1.5 rounded-full bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border border-slate-200">
                                                                Defaults
                                                            </span>
                                                        )}
                                                        {isDirty && (
                                                            <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest border border-amber-200">
                                                                Unsaved
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="p-6 space-y-5">
                                                    {/* Row 1: Date, Slot Duration */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                Session Date (for display)
                                                            </label>
                                                            <input
                                                                type="date"
                                                                value={cfg.day_date || ''}
                                                                onChange={(e) => handleDayFieldChange(dayIndex, 'day_date', e.target.value || null)}
                                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:bg-white transition-all"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                Slot Duration (Min)
                                                            </label>
                                                            <div className="grid grid-cols-4 gap-1.5">
                                                                {SLOT_PRESETS.map(mins => (
                                                                    <button
                                                                        key={mins}
                                                                        type="button"
                                                                        onClick={() => handleDayFieldChange(dayIndex, 'slot_duration_minutes', mins)}
                                                                        className={`py-2.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all ${
                                                                            cfg.slot_duration_minutes === mins
                                                                                ? 'bg-gradient-to-r from-athar-blue to-athar-black text-white shadow-sm'
                                                                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200'
                                                                        }`}
                                                                    >
                                                                        {mins}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Row 2: Start Time, End Time, Total Round (3 cols) */}
                                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                Start Time
                                                            </label>
                                                            <input
                                                                type="time"
                                                                value={cfg.session_start_time?.slice(0, 5) || '09:00'}
                                                                onChange={(e) => handleDayFieldChange(dayIndex, 'session_start_time', e.target.value)}
                                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:bg-white transition-all"
                                                            />
                                                            <p className="text-[10px] text-muted-foreground font-bold mt-1">{timeTo12Hour(cfg.session_start_time)}</p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                End Time (override)
                                                            </label>
                                                            <input
                                                                type="time"
                                                                value={cfg.session_end_time ? cfg.session_end_time.slice(0, 5) : ''}
                                                                placeholder="(auto)"
                                                                onChange={(e) => handleDayFieldChange(dayIndex, 'session_end_time', e.target.value || null)}
                                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:bg-white transition-all placeholder:text-slate-300"
                                                            />
                                                            <p className="text-[10px] text-muted-foreground font-bold mt-1">
                                                                {cfg.session_end_time ? timeTo12Hour(cfg.session_end_time) : 'Auto via Round'}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                Total Round (Min)
                                                            </label>
                                                            <input
                                                                type="number"
                                                                min={30}
                                                                max={720}
                                                                step={15}
                                                                value={cfg.total_round_minutes ?? ''}
                                                                placeholder={`${config.total_round_minutes} (def)`}
                                                                onChange={(e) => {
                                                                    const val = e.target.value === '' ? null : (parseInt(e.target.value, 10) || null);
                                                                    handleDayFieldChange(dayIndex, 'total_round_minutes', val);
                                                                }}
                                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:bg-white transition-all placeholder:text-slate-300"
                                                            />
                                                            <p className="text-[10px] text-muted-foreground font-bold mt-1">
                                                                = {eff.total_round_minutes} min ({Math.floor(eff.total_round_minutes / 60)}h {eff.total_round_minutes % 60}m)
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Row 3: Break + Live Summary */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                                                        <div>
                                                            <label className="block text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em] mb-2">
                                                                Gap (Min)
                                                            </label>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={60}
                                                                step={5}
                                                                value={cfg.break_between_slots_minutes ?? 0}
                                                                onChange={(e) => handleDayFieldChange(dayIndex, 'break_between_slots_minutes', parseInt(e.target.value, 10) || 0)}
                                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-athar-blue focus:bg-white transition-all"
                                                            />
                                                        </div>
                                                        <div className="sm:col-span-3 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em]">
                                                                    Live Day {dayNumber} Slot Preview
                                                                </span>
                                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                                                    preview.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                                                }`}>
                                                                    {preview.length} slot{preview.length === 1 ? '' : 's'}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-baseline gap-5 flex-wrap">
                                                                <div>
                                                                    <span className="text-3xl font-black text-athar-black">{preview.length}</span>
                                                                    <span className="text-xs text-muted-foreground font-bold ml-2 uppercase tracking-wider">/ mentor</span>
                                                                </div>
                                                                <div className="h-5 w-px bg-slate-300" />
                                                                <div>
                                                                    <span className="text-xl font-black text-athar-blue">
                                                                        {preview.length > 0 ? timeTo12Hour(preview[0].start_time) : '--:--'}
                                                                    </span>
                                                                    <span className="text-xs text-muted-foreground font-bold mx-2">→</span>
                                                                    <span className="text-xl font-black text-athar-black">
                                                                        {preview.length > 0 ? timeTo12Hour(preview[preview.length - 1].end_time) : '--:--'}
                                                                    </span>
                                                                </div>
                                                                <div className="h-5 w-px bg-slate-300" />
                                                                <div>
                                                                    <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Capacity: </span>
                                                                    <span className="text-lg font-black text-athar-blue">
                                                                        {preview.length * Math.max(selectedMentorIds.length, mentors.length)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Save Config Button */}
                                                    <button
                                                        type="button"
                                                        disabled={isSaving || !isDirty}
                                                        onClick={() => handleSaveDayConfig(dayIndex)}
                                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-extrabold uppercase tracking-widest bg-athar-blue text-white shadow-lg shadow-athar-blue/20 hover:shadow-athar-blue/40 hover:bg-athar-blue/95 active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                                    >
                                                        {isSaving ? (
                                                            <>
                                                                <Loader2 size={14} className="animate-spin" />
                                                                Saving Day {dayNumber}...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckCircle2 size={14} />
                                                                Save Day {dayNumber} Config
                                                            </>
                                                        )}
                                                    </button>

                                                    <hr className="border-slate-100" />

                                                    {/* Mentor Selector for Day */}
                                                    <div>
                                                        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                                                            <label className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.18em]">
                                                                Assigned Mentors for Day {dayNumber} ({selectedMentorIds.length}/{mentors.length})
                                                            </label>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSelectAllMentorsForDay(dayIndex)}
                                                                    disabled={mentors.length === 0}
                                                                    className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200 transition-all disabled:opacity-40 cursor-pointer"
                                                                >
                                                                    Select All
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleClearMentorsForDay(dayIndex)}
                                                                    disabled={selectedMentorIds.length === 0}
                                                                    className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200 transition-all disabled:opacity-40 cursor-pointer"
                                                                >
                                                                    Clear
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {mentors.length === 0 ? (
                                                            <div className="p-5 text-center rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
                                                                <p className="text-sm font-bold text-slate-500 italic">
                                                                    Add mentors first from Participants tab (experts list)
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <div className="max-h-60 overflow-y-auto p-2 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-1.5 custom-scrollbar">
                                                                {mentors.map((m) => {
                                                                    const checked = selectedMentorIds.includes(m.id);
                                                                    const isAvailableGlobally = isMentorAvailableOnDay(m.id, dayIndex, config.mentor_availability);
                                                                    return (
                                                                        <label
                                                                            key={m.id}
                                                                            className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${
                                                                                checked
                                                                                    ? 'bg-white border-2 border-athar-blue/30 shadow-sm'
                                                                                    : 'bg-transparent border-2 border-transparent hover:bg-white hover:border-slate-200'
                                                                            } ${!isAvailableGlobally ? 'opacity-50' : ''}`}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={checked}
                                                                                onChange={() => handleToggleMentorForDay(dayIndex, m.id)}
                                                                                className="w-4 h-4 accent-athar-blue"
                                                                            />
                                                                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-athar-blue/10 shrink-0 flex items-center justify-center text-athar-blue font-black text-base border-2 border-white shadow-xs">
                                                                                {m.photo_url ? (
                                                                                    <img
                                                                                        src={getGoogleDriveFallbackUrls(m.photo_url)[0]}
                                                                                        alt={m.name}
                                                                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                                                        className="w-full h-full object-cover"
                                                                                    />
                                                                                ) : (
                                                                                    m.name.charAt(0)
                                                                                )}
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="text-sm font-black text-athar-black truncate flex items-center gap-2">
                                                                                    {m.name}
                                                                                    {!isAvailableGlobally && (
                                                                                        <span className="text-[9px] font-extrabold text-rose-500 uppercase tracking-widest px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200">
                                                                                            Excluded in Participants
                                                                                        </span>
                                                                                    )}
                                                                                </p>
                                                                                {m.title && (
                                                                                    <p className="text-[11px] text-muted-foreground font-bold truncate">{m.title}</p>
                                                                                )}
                                                                            </div>
                                                                            {preview.length > 0 && checked && (
                                                                                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest shrink-0">
                                                                                    +{preview.length}
                                                                                </span>
                                                                            )}
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        <p className="mt-3 text-[11px] text-muted-foreground font-bold leading-relaxed">
                                                            💡 <strong>Tip:</strong> If no mentors are explicitly assigned, the generator falls back to all mentors available on this day (respecting Participants availability rules).
                                                        </p>
                                                    </div>

                                                    {/* Generation Result Banner if exists */}
                                                    {genResultByDay[dayIndex] && (
                                                        <div className={`rounded-2xl p-4 border ${
                                                            genResultByDay[dayIndex].ok
                                                                ? 'bg-emerald-50 border-emerald-200'
                                                                : 'bg-rose-50 border-rose-200'
                                                        }`}>
                                                            {genResultByDay[dayIndex].ok ? (
                                                                <div className="flex items-center gap-3">
                                                                    <CheckCircle2 size={22} className="text-emerald-500 shrink-0" />
                                                                    <div>
                                                                        <p className="font-black text-emerald-700 text-xs uppercase tracking-widest mb-0.5">
                                                                            Saved Successfully ({genResultByDay[dayIndex].ts})
                                                                        </p>
                                                                        <p className="text-xs text-emerald-600 font-semibold">
                                                                            Custom config will be used on next Schedule Generation
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-3">
                                                                    <AlertTriangle size={22} className="text-rose-500 shrink-0" />
                                                                    <div>
                                                                        <p className="font-black text-rose-700 text-xs uppercase tracking-widest mb-0.5">Save Failed</p>
                                                                        <p className="text-xs text-rose-600 font-semibold">{genResultByDay[dayIndex].error}</p>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Break Slots */}
                        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-md hover:shadow-lg transition-all space-y-4 overflow-hidden relative">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-athar-blue/10 p-2.5 rounded-xl text-athar-blue border border-athar-blue/10">
                                    <Coffee size={20} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-extrabold text-foreground tracking-tight">Break Slots (Optional)</h2>
                                    <p className="text-xs sm:text-sm text-muted-foreground">Insert rest intervals between mentoring rounds</p>
                                </div>
                            </div>

                            {config.break_slots.length > 0 && (
                                <div className="space-y-2 mb-4">
                                    {config.break_slots.map((br, idx) => (
                                        <div key={idx} className="flex items-center justify-between px-4 py-3 bg-background border border-border/60 rounded-xl">
                                            <span className="text-xs sm:text-sm font-semibold text-foreground">
                                                After Slot #{br.after_slot + 1} ← {br.duration_minutes} min break
                                            </span>
                                            <button onClick={() => removeBreakSlot(idx)} className="text-rose-500 hover:text-rose-600 p-1 cursor-pointer">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">After Slot #</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max={slotsPerDay - 1}
                                        placeholder={`1 - ${slotsPerDay - 1}`}
                                        value={newBreak.after_slot}
                                        onChange={e => setNewBreak(p => ({ ...p, after_slot: e.target.value }))}
                                        className="w-full px-3.5 py-2.5 bg-background border border-border/60 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-athar-blue transition-all"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Break Duration (m)</label>
                                    <input
                                        type="number"
                                        min="5"
                                        max="60"
                                        value={newBreak.duration_minutes}
                                        onChange={e => setNewBreak(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 15 }))}
                                        className="w-full px-3.5 py-2.5 bg-background border border-border/60 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-athar-blue transition-all"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <button
                                        onClick={addBreakSlot}
                                        className="px-4 py-2.5 bg-athar-blue text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-athar-blue/90 transition-colors cursor-pointer shadow-sm"
                                    >
                                        + Add Break
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleSaveConfig}
                            disabled={saving}
                            className="w-full py-3.5 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                        >
                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {saving ? 'Saving Settings...' : 'Save Settings'}
                        </button>
                    </div>
                )}

                {/* ═══ PARTICIPANTS TAB ═════════════════════════════ */}
                {activeTab === 'participants' && (
                    <div className="space-y-8">
                        {/* Mentor Availability & Management Header */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card border border-border/60 rounded-2xl p-6 shadow-md">
                            <div>
                                <h2 className="text-base sm:text-lg font-extrabold text-foreground flex items-center gap-2">
                                    <Users className="text-athar-blue" size={20} />
                                    Mentor Availability & Participation
                                </h2>
                                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                                    Manage individual mentor attendance per event day and exclude/remove non-participating mentors.
                                </p>
                            </div>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                                <input
                                    type="text"
                                    placeholder="Search mentor..."
                                    value={mentorSearch}
                                    onChange={e => setMentorSearch(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 bg-background border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-athar-blue"
                                />
                            </div>
                        </div>

                        {/* Mentors List */}
                        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-md">
                            <div className="px-6 py-4 border-b border-border/60 bg-gradient-to-r from-athar-blue/5 to-transparent flex items-center justify-between">
                                <h3 className="text-xs sm:text-sm font-extrabold text-foreground uppercase tracking-wider">
                                    Mentors ({filteredMentors.length})
                                </h3>
                                <p className="text-xs text-muted-foreground font-semibold">
                                    Days Configured: {config.num_days} Day(s)
                                </p>
                            </div>

                            {filteredMentors.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground text-sm font-medium">
                                    No mentors found matching "{mentorSearch}".
                                </div>
                            ) : (
                                <div className="divide-y divide-border/60">
                                    {filteredMentors.map((m) => {
                                        const avail = config.mentor_availability[m.id];
                                        const isExcluded = avail === 'excluded' || avail === 'none';

                                        return (
                                            <div key={m.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-athar-blue/[0.02] transition-colors">
                                                {/* Mentor info */}
                                                <div className="flex items-center gap-4">
                                                    {m.photo_url ? (
                                                        <img src={getGoogleDriveFallbackUrls(m.photo_url)[0]} alt={m.name} className="w-12 h-12 rounded-full object-cover border border-border/60 shadow-xs" />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-full bg-athar-blue/10 text-athar-blue font-extrabold flex items-center justify-center text-base border border-athar-blue/20 shadow-xs">
                                                            {m.name.charAt(0)}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                                                            {m.name}
                                                            {isExcluded && (
                                                                <span className="px-2 py-0.5 text-[10px] font-extrabold bg-rose-500/10 text-rose-500 rounded-full border border-rose-500/20">
                                                                    Excluded
                                                                </span>
                                                            )}
                                                        </h4>
                                                        {m.title && <p className="text-xs text-muted-foreground mt-0.5">{m.title}</p>}
                                                    </div>
                                                </div>

                                                {/* Availability Controls */}
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <span className="text-xs font-bold text-muted-foreground mr-1">Availability:</span>
                                                    
                                                    {/* Day selection buttons */}
                                                    <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-xl p-1 shadow-xs">
                                                        {Array.from({ length: config.num_days }).map((_, dayIdx) => {
                                                            const isAvail = isMentorAvailableOnDay(m.id, dayIdx, config.mentor_availability);
                                                            return (
                                                                <button
                                                                    key={dayIdx}
                                                                    onClick={() => handleToggleMentorDay(m.id, dayIdx)}
                                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                                        isAvail
                                                                            ? 'bg-emerald-500 text-white shadow-sm'
                                                                            : 'bg-muted text-muted-foreground/50 hover:bg-muted/80'
                                                                    }`}
                                                                    title={`Toggle availability for Day ${dayIdx + 1}`}
                                                                >
                                                                    Day {dayIdx + 1}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    {/* Quick Presets */}
                                                    <button
                                                        onClick={() => handleMentorAvailabilityChange(m.id, 'all')}
                                                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                                            avail === undefined || avail === 'all'
                                                                ? 'bg-athar-blue/10 text-athar-blue border-athar-blue/30 font-extrabold'
                                                                : 'bg-background border-border/60 text-muted-foreground hover:text-foreground'
                                                        }`}
                                                    >
                                                        All Days
                                                    </button>
                                                    <button
                                                        onClick={() => handleMentorAvailabilityChange(m.id, 'excluded')}
                                                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                                            isExcluded
                                                                ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                                                                : 'bg-background border-border/60 text-muted-foreground hover:text-foreground'
                                                        }`}
                                                    >
                                                        Exclude
                                                    </button>

                                                    {/* Remove Button */}
                                                    <button
                                                        onClick={() => handleRemoveMentor(m.id, m.name)}
                                                        className="p-2 text-muted-foreground hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-colors ml-2 cursor-pointer"
                                                        title="Remove mentor from event"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Startups List */}
                        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-md">
                            <div className="px-6 py-4 border-b border-border/60 bg-gradient-to-r from-athar-blue/5 to-transparent flex items-center justify-between">
                                <h3 className="text-xs sm:text-sm font-extrabold text-foreground uppercase tracking-wider">
                                    Participating Startups ({companies.length})
                                </h3>
                                <span className="text-xs text-muted-foreground font-semibold">Loaded from Startups Manager</span>
                            </div>
                            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {companies.map(c => (
                                    <div key={c.id} className="p-3.5 bg-background border border-border/60 rounded-xl text-xs sm:text-sm font-bold text-foreground shadow-xs hover:border-athar-blue/30 transition-all">
                                        {c.name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ LINKS TAB ════════════════════════════════════ */}
                {activeTab === 'links' && (
                    <div className="space-y-6 max-w-3xl">
                        <div className="bg-card border border-border/60 rounded-2xl p-6 space-y-6 shadow-md">
                            <div>
                                <h2 className="text-base sm:text-lg font-extrabold text-foreground tracking-tight">Public Access Links</h2>
                                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Share these links for live TV display or full screen matrix view</p>
                            </div>

                            {/* Fit-to-screen Full Matrix Link */}
                            <div className="p-4.5 bg-background border border-border/60 rounded-xl space-y-3 shadow-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-2">
                                        <Grid3X3 size={16} className="text-athar-blue" />
                                        Full Matrix View (Fit to Screen)
                                    </span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-athar-blue/10 text-athar-blue rounded-full">
                                        No Horizontal Scroll
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={matrixLink}
                                        className="flex-1 px-3 py-2 bg-muted border border-border/60 rounded-xl text-xs font-mono text-muted-foreground select-all"
                                    />
                                    <button
                                        onClick={() => copyToClipboard(matrixLink, () => setCopiedLink('matrix'))}
                                        className="px-4 py-2 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-athar-blue/20 cursor-pointer"
                                    >
                                        {copiedLink === 'matrix' ? <Check size={14} /> : <Copy size={14} />}
                                        {copiedLink === 'matrix' ? 'Copied' : 'Copy Link'}
                                    </button>
                                    <a
                                        href={matrixLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-2 bg-secondary text-secondary-foreground rounded-xl hover:bg-secondary/80 transition-colors"
                                    >
                                        <ExternalLink size={14} />
                                    </a>
                                </div>
                            </div>

                            {/* Public Live View Link */}
                            <div className="p-4.5 bg-background border border-border/60 rounded-xl space-y-3 shadow-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-2">
                                        <Eye size={16} className="text-athar-blue" />
                                        Live Countdown & Current Slot View
                                    </span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-athar-blue/10 text-athar-blue rounded-full">
                                        TV Screen Mode
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={liveLink}
                                        className="flex-1 px-3 py-2 bg-muted border border-border/60 rounded-xl text-xs font-mono text-muted-foreground select-all"
                                    />
                                    <button
                                        onClick={() => copyToClipboard(liveLink, () => setCopiedLink('live'))}
                                        className="px-4 py-2 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-athar-blue/20 cursor-pointer"
                                    >
                                        {copiedLink === 'live' ? <Check size={14} /> : <Copy size={14} />}
                                        {copiedLink === 'live' ? 'Copied' : 'Copy Link'}
                                    </button>
                                    <a
                                        href={liveLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-2 bg-secondary text-secondary-foreground rounded-xl hover:bg-secondary/80 transition-colors"
                                    >
                                        <ExternalLink size={14} />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
