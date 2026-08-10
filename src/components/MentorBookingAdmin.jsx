import React, { useMemo, useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Calendar, Clock, Users, Copy, CheckCircle, ArrowLeft, Search, Loader2, Briefcase, X, Database, AlertTriangle, ExternalLink, Settings } from 'lucide-react';
import {
    getMentors,
    createMentor,
    updateMentor,
    deleteMentor,
    getSlots,
    createSlot,
    updateSlot,
    deleteSlot,
    getBookings,
    deleteBooking,
    getEvent,
    getMentorDayConfigs,
    saveMentorDayConfig,
    deleteMentorDayConfig,
    calculateDaySlotTimes,
    buildMentorSlotsPayload,
    detectMentorSlotConflicts,
    generateMentorSlotsForDay,
} from '../lib/mentorBooking';
import { supabase } from '../lib/supabase';
import { getMasterExperts, getEventDays } from '../lib/api';
import { getGoogleDriveFallbackUrls } from '../lib/utils';
import LazyImage from './LazyImage';

const timeTo12Hour = (t24) => {
    if (!t24) return '';
    const [hh, mm] = t24.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h = ((hh + 11) % 12) + 1;
    return `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
};

// Local storage for remembering mentor emails
const getStoredMentorEmails = () => {
    try {
        const stored = localStorage.getItem('mentorBookingEmails');
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
};

const storeMentorEmail = (masterId, email) => {
    try {
        const stored = getStoredMentorEmails();
        stored[masterId] = email;
        localStorage.setItem('mentorBookingEmails', JSON.stringify(stored));
    } catch {}
};

const DEFAULT_DAY_CONFIG = {
    session_start_time: '09:00',
    session_end_time: '17:00',
    slot_duration_minutes: 30,
    break_between_slots_minutes: 5,
};

const SLOT_PRESETS = [10, 15, 20, 30];

const DAY_PRESETS = [
    { label: '1 Day', value: 1 },
    { label: '2 Days', value: 2 },
    { label: '3 Days', value: 3 },
];

export default function MentorBookingAdmin() {
    const { eventId } = useParams();
    const [mentors, setMentors] = useState([]);
    const [slots, setSlots] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [event, setEvent] = useState(null);
    const [eventDays, setEventDays] = useState([]);
    const [dayConfigs, setDayConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('mentors');
    const [adminEmail, setAdminEmail] = useState('');
    const [showHubModal, setShowHubModal] = useState(false);
    const [showAddSlot, setShowAddSlot] = useState(false);
    const [editingMentor, setEditingMentor] = useState(null);
    const [editingSlot, setEditingSlot] = useState(null);
    const [newSlot, setNewSlot] = useState({ mentor_id: '', start_time: '', end_time: '', meet_link: '' });
    const [copied, setCopied] = useState(false);
    const [selectedSlotIds, setSelectedSlotIds] = useState([]);
    const [hubExperts, setHubExperts] = useState([]);
    const [hubLoading, setHubLoading] = useState(false);
    const [hubSearch, setHubSearch] = useState('');
    const [selectedHubExpert, setSelectedHubExpert] = useState(null);
    const [mentorEmail, setMentorEmail] = useState('');
    const [importingMentorId, setImportingMentorId] = useState(null);
    const [storedEmails, setStoredEmails] = useState(getStoredMentorEmails());
    const [generatingMeetLink, setGeneratingMeetLink] = useState(false);

    const [dayEdits, setDayEdits] = useState({});
    const [customSlotMinsByDay, setCustomSlotMinsByDay] = useState({});
    const [numDays, setNumDays] = useState(1);
    const [globalStartTime, setGlobalStartTime] = useState('09:00');
    const [globalTotalMins, setGlobalTotalMins] = useState(300);
    const [globalSlotMins, setGlobalSlotMins] = useState(20);
    const [globalUseCustom, setGlobalUseCustom] = useState(false);
    const [globalCustomMins, setGlobalCustomMins] = useState(25);

    const [selectedMentorsByDay, setSelectedMentorsByDay] = useState({});
    const [savingDay, setSavingDay] = useState(null);
    const [generatingDay, setGeneratingDay] = useState(null);
    const [genResultByDay, setGenResultByDay] = useState({});
    const [overwriteModeByDay, setOverwriteModeByDay] = useState({});
    const [configDirtyByDay, setConfigDirtyByDay] = useState({});

    const generateMeetLink = async (
        slotStart, 
        slotEnd, 
        existingSlotId = null
    ) => {
        try {
            setGeneratingMeetLink(true);
            
            const response = await supabase.functions.invoke('generate-google-meet', {
                body: {
                    slot_id: existingSlotId || crypto.randomUUID(),
                    event_id: eventId,
                    start_time: slotStart,
                    end_time: slotEnd,
                    summary: 'Mentor Session'
                }
            });

            if (response.error) {
                console.error('Error generating Meet link:', response.error);
                alert(`Error generating Meet link: ${response.error.message}`);
                return null;
            }

            if (!response.data.success) {
                alert(`Error generating Meet link: ${response.data.error}`);
                return null;
            }

            return response.data.meet_link;
        } catch (error) {
            console.error('Error generating Meet link:', error);
            alert(`Error generating Meet link: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return null;
        } finally {
            setGeneratingMeetLink(false);
        }
    };

    useEffect(() => {
        if (eventId) {
            loadData();
        }
    }, [eventId]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [mentorsData, slotsData, bookingsData, eventData, dayConfigsData, eventDaysData] = await Promise.all([
                getMentors(eventId),
                getSlots(eventId),
                getBookings(eventId),
                getEvent(eventId),
                getMentorDayConfigs(eventId),
                getEventDays(eventId)
            ]);
            setMentors(mentorsData);
            setSlots(slotsData);
            setBookings(bookingsData);
            setEvent(eventData);
            setDayConfigs(dayConfigsData || []);
            setEventDays(eventDaysData || []);
            setAdminEmail(eventData?.admin_email || '');

            const computedNumDays = (dayConfigsData && dayConfigsData.length > 0)
                ? Math.max(...dayConfigsData.map(d => d.day_number))
                : (eventDaysData && eventDaysData.length > 0 ? eventDaysData.length : 1);
            setNumDays(computedNumDays);

            const newDayEdits = {};
            for (const cfg of (dayConfigsData || [])) {
                newDayEdits[cfg.day_number] = { ...cfg };
            }
            setDayEdits(newDayEdits);
            setConfigDirtyByDay({});
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveAdminEmail = async () => {
        try {
            await supabase
                .from('events')
                .update({ admin_email: adminEmail })
                .eq('id', eventId);
            setEvent(prev => prev ? { ...prev, admin_email: adminEmail } : null);
        } catch (error) {
            console.error('Error saving admin email:', error);
            alert('Failed to save admin email');
        }
    };

    const filteredHubExperts = useMemo(() => {
        const normalizedSearch = hubSearch.trim().toLowerCase();

        return hubExperts.filter((expert) => {
            const isAlreadyAdded = mentors.some((mentor) => mentor.master_id === expert.id);

            if (isAlreadyAdded) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            return [
                expert.name,
                expert.title,
                expert.company,
                expert.name_ar,
                expert.title_ar,
                expert.company_ar
            ]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(normalizedSearch));
        });
    }, [hubExperts, hubSearch, mentors]);

    const openHubModal = async () => {
        try {
            setShowHubModal(true);
            setHubLoading(true);
            setSelectedHubExpert(null);
            setMentorEmail('');
            const experts = await getMasterExperts();
            setHubExperts(experts || []);
        } catch (error) {
            console.error('Error loading hub experts:', error);
            alert('Failed to load Athar Experts Network.');
        } finally {
            setHubLoading(false);
        }
    };

    const closeHubModal = () => {
        setShowHubModal(false);
        setHubSearch('');
        setSelectedHubExpert(null);
        setMentorEmail('');
        setImportingMentorId(null);
    };

    const handleSelectHubExpert = (expert) => {
        setSelectedHubExpert(expert);
        const storedEmail = storedEmails[expert.id];
        setMentorEmail(storedEmail || expert.email || '');
    };

    const handleImportMentor = async () => {
        if (!selectedHubExpert) return;

        const normalizedEmail = mentorEmail.trim().toLowerCase();
        if (!normalizedEmail) {
            alert('Please enter the mentor booking email before adding them.');
            return;
        }

        const duplicateByEmail = mentors.some((mentor) => mentor.email?.trim().toLowerCase() === normalizedEmail);
        if (duplicateByEmail) {
            alert('A mentor with this email is already added to this booking module.');
            return;
        }

        try {
            setImportingMentorId(selectedHubExpert.id);
            const data = await createMentor({
                event_id: eventId,
                name: selectedHubExpert.name,
                email: normalizedEmail,
                master_id: selectedHubExpert.id,
                bio: selectedHubExpert.bio,
                photo_url: selectedHubExpert.photo_url
            });

            // Store the email for future use
            storeMentorEmail(selectedHubExpert.id, normalizedEmail);
            setStoredEmails(getStoredMentorEmails());

            setMentors((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
            closeHubModal();
        } catch (error) {
            console.error('Error importing mentor from hub:', error);
            alert(error.message || 'Failed to add mentor from Athar Experts Network.');
        } finally {
            setImportingMentorId(null);
        }
    };

    const handleUpdateMentor = async (e) => {
        e.preventDefault();
        try {
            await updateMentor(editingMentor.id, editingMentor);
            setEditingMentor(null);
            loadData();
        } catch (error) {
            alert('Error updating mentor: ' + error.message);
        }
    };

    const handleDeleteMentor = async (id) => {
        if (!confirm('Are you sure you want to delete this mentor?')) return;
        try {
            await deleteMentor(id);
            loadData();
        } catch (error) {
            alert('Error deleting mentor: ' + error.message);
        }
    };

    const handleCreateSlot = async (e) => {
        e.preventDefault();
        try {
            await createSlot({ ...newSlot, event_id: eventId, is_available: true });
            setNewSlot({ mentor_id: '', start_time: '', end_time: '', meet_link: '' });
            setShowAddSlot(false);
            loadData();
        } catch (error) {
            alert('Error creating slot: ' + error.message);
        }
    };

    const handleUpdateSlot = async (e) => {
        e.preventDefault();
        try {
            // Only send the fields that exist on mentor_slots table
            const updates = {
                start_time: editingSlot.start_time,
                end_time: editingSlot.end_time,
                is_available: editingSlot.is_available,
                meet_link: editingSlot.meet_link
            };
            await updateSlot(editingSlot.id, updates);
            setEditingSlot(null);
            loadData();
        } catch (error) {
            alert('Error updating slot: ' + error.message);
        }
    };

    const handleDeleteSlot = async (id) => {
        if (!confirm('Are you sure you want to delete this slot?')) return;
        try {
            await deleteSlot(id);
            loadData();
        } catch (error) {
            alert('Error deleting slot: ' + error.message);
        }
    };

    const handleDeleteBooking = async (id) => {
        if (!confirm('Are you sure you want to cancel this booking?')) return;
        try {
            await deleteBooking(id);
            loadData();
        } catch (error) {
            alert('Error canceling booking: ' + error.message);
        }
    };

    const copyBookingLink = (mentorId) => {
        const link = `${window.location.origin}${window.location.pathname}#/book/${mentorId}`;
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const toggleSlotSelection = (slotId) => {
        setSelectedSlotIds(prev => 
            prev.includes(slotId) 
                ? prev.filter(id => id !== slotId) 
                : [...prev, slotId]
        );
    };

    const toggleSelectAllSlots = () => {
        if (selectedSlotIds.length === slots.length) {
            setSelectedSlotIds([]);
        } else {
            setSelectedSlotIds(slots.map(slot => slot.id));
        }
    };

    const handleBulkDeleteSlots = async () => {
        if (!confirm(`Are you sure you want to delete ${selectedSlotIds.length} slot(s)?`)) return;
        try {
            await Promise.all(selectedSlotIds.map(id => deleteSlot(id)));
            setSelectedSlotIds([]);
            loadData();
        } catch (error) {
            alert('Error deleting slots: ' + error.message);
        }
    };

    const isWithin24Hours = (dateTime) => {
        if (!dateTime) return false;
        const slotTime = new Date(dateTime);
        const now = new Date();
        const diffMs = slotTime - now;
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours < 24;
    };

    // ------------------------------
    // Schedule (Day-by-Day) Handlers
    // ------------------------------

    const getDayConfigOrDefault = (dayNumber) => {
        const saved = dayConfigs.find(c => c.day_number === dayNumber);
        const edited = dayEdits[dayNumber];
        return {
            day_number: dayNumber,
            day_date: eventDays[dayNumber - 1]?.day_date || null,
            session_start_time: DEFAULT_DAY_CONFIG.session_start_time,
            session_end_time: DEFAULT_DAY_CONFIG.session_end_time,
            slot_duration_minutes: DEFAULT_DAY_CONFIG.slot_duration_minutes,
            break_between_slots_minutes: DEFAULT_DAY_CONFIG.break_between_slots_minutes,
            ...(saved || {}),
            ...(edited || {})
        };
    };

    const handleDayFieldChange = (dayNumber, field, value) => {
        setDayEdits(prev => ({
            ...prev,
            [dayNumber]: {
                ...(prev[dayNumber] || getDayConfigOrDefault(dayNumber)),
                [field]: value
            }
        }));
        setConfigDirtyByDay(prev => ({ ...prev, [dayNumber]: true }));
    };

    const handleApplyGlobalToAllDays = () => {
        const slotDur = globalUseCustom
            ? (parseInt(globalCustomMins, 10) || 20)
            : (parseInt(globalSlotMins, 10) || 20);
        const newDayEdits = { ...dayEdits };
        for (let d = 1; d <= numDays; d++) {
            const existing = newDayEdits[d] || getDayConfigOrDefault(d);
            newDayEdits[d] = {
                ...existing,
                session_start_time: globalStartTime,
                slot_duration_minutes: slotDur,
                break_between_slots_minutes: 5,
            };
        }
        setDayEdits(newDayEdits);
        const dirty = {};
        for (let d = 1; d <= numDays; d++) dirty[d] = true;
        setConfigDirtyByDay(dirty);
    };

    const handleSaveDayConfig = async (dayNumber) => {
        try {
            setSavingDay(dayNumber);
            const cfg = getDayConfigOrDefault(dayNumber);
            const saved = await saveMentorDayConfig({
                ...cfg,
                event_id: eventId,
            });
            setDayConfigs(prev => {
                const others = prev.filter(c => c.day_number !== dayNumber);
                return [...others, saved].sort((a, b) => a.day_number - b.day_number);
            });
            setDayEdits(prev => ({ ...prev, [dayNumber]: saved }));
            setConfigDirtyByDay(prev => ({ ...prev, [dayNumber]: false }));
            setGenResultByDay(prev => ({ ...prev, [dayNumber]: null }));
        } catch (error) {
            console.error('Error saving day config:', error);
            alert('Error saving schedule: ' + (error.message || 'Unknown error'));
        } finally {
            setSavingDay(null);
        }
    };

    const handleToggleMentorForDay = (dayNumber, mentorId) => {
        setSelectedMentorsByDay(prev => {
            const current = new Set(prev[dayNumber] || []);
            if (current.has(mentorId)) {
                current.delete(mentorId);
            } else {
                current.add(mentorId);
            }
            return { ...prev, [dayNumber]: [...current] };
        });
    };

    const handleSelectAllMentorsForDay = (dayNumber) => {
        setSelectedMentorsByDay(prev => ({
            ...prev,
            [dayNumber]: mentors.map(m => m.id)
        }));
    };

    const handleClearMentorsForDay = (dayNumber) => {
        setSelectedMentorsByDay(prev => ({
            ...prev,
            [dayNumber]: []
        }));
    };

    const handleGenerateSlotsForDay = async (dayNumber) => {
        try {
            setGeneratingDay(dayNumber);
            setGenResultByDay(prev => ({ ...prev, [dayNumber]: null }));

            const cfg = getDayConfigOrDefault(dayNumber);
            const mentorIds = selectedMentorsByDay[dayNumber] || [];
            const overwriteMode = overwriteModeByDay[dayNumber] || 'skip';

            const result = await generateMentorSlotsForDay({
                config: cfg,
                mentorIds,
                eventId,
                dayDate: cfg.day_date,
                overwriteMode,
            });

            setGenResultByDay(prev => ({
                ...prev,
                [dayNumber]: {
                    ok: true,
                    created: result.created.length,
                    skipped: result.skipped,
                    conflicts: result.conflicts.length,
                    perMentor: result.slotsPerMentor,
                    ts: new Date().toLocaleTimeString(),
                }
            }));
            await loadData();
        } catch (error) {
            console.error('Error generating slots:', error);
            setGenResultByDay(prev => ({
                ...prev,
                [dayNumber]: {
                    ok: false,
                    error: error.message || 'Failed to generate slots',
                    ts: new Date().toLocaleTimeString(),
                }
            }));
        } finally {
            setGeneratingDay(null);
        }
    };

    const getEventDayMeta = (dayNumber) => {
        return eventDays[dayNumber - 1] || null;
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-gray-200">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-[#1a27c9] rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-lg font-black text-slate-400 uppercase tracking-widest">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-200 font-manrope">
            <div className="max-w-7xl mx-auto p-6">
                <div className="mb-8">
                    <Link to={`/event/${eventId}`} className="flex items-center gap-2 text-slate-400 hover:text-[#1a27c9] mb-4 transition-premium">
                        <ArrowLeft size={18} />
                        <span className="font-bold">Back to Event</span>
                    </Link>
                    <h1 className="text-3xl font-black text-[#0d0e0e] mb-2 tracking-tight">Mentor Booking Admin</h1>
                    <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">Manage mentors, slots, and bookings</p>
                </div>

                {/* Tabs */}
                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 mb-6 overflow-hidden">
                    <div className="flex border-b border-slate-100">
                        <button
                            onClick={() => setActiveTab('mentors')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'mentors'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Users size={20} />
                            Mentors
                        </button>
                        <button
                            onClick={() => setActiveTab('slots')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'slots'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Calendar size={20} />
                            Slots
                        </button>
                        <button
                            onClick={() => setActiveTab('bookings')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'bookings'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Clock size={20} />
                            Bookings
                        </button>
                        <button
                            onClick={() => setActiveTab('schedule')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'schedule'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Database size={20} />
                            Schedule
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'settings'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Settings size={20} />
                            Settings
                        </button>
                    </div>
                </div>

                {/* Mentors Tab */}
                {activeTab === 'mentors' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-xl font-black text-[#0d0e0e]">Mentors</h2>
                            <button
                                onClick={openHubModal}
                                className="flex items-center gap-3 bg-[#1a27c9] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium group active:scale-95"
                            >
                                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-500" />
                                Add from Network
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {mentors.map((mentor) => (
                                <Link
                                    key={mentor.id}
                                    to={`/event/${eventId}/mentor-booking/${mentor.id}`}
                                    className="bg-slate-50 rounded-[2.5rem] border border-slate-100 p-6 hover:shadow-xl hover:bg-white transition-premium block"
                                >
                                    {editingMentor?.id === mentor.id ? (
                                        <form onSubmit={(e) => { e.preventDefault(); handleUpdateMentor(e); }} className="space-y-4">
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Name</label>
                                                <input
                                                    type="text"
                                                    value={editingMentor.name}
                                                    onChange={(e) => setEditingMentor({ ...editingMentor, name: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
                                                <input
                                                    type="email"
                                                    value={editingMentor.email}
                                                    onChange={(e) => setEditingMentor({ ...editingMentor, email: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Bio</label>
                                                <textarea
                                                    value={editingMentor.bio || ''}
                                                    onChange={(e) => setEditingMentor({ ...editingMentor, bio: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium min-h-[100px]"
                                                />
                                            </div>
                                            <div className="flex gap-3">
                                                <button
                                                    type="submit"
                                                    className="flex-1 bg-[#1a27c9] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:opacity-90 transition-premium"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingMentor(null); }}
                                                    className="px-6 py-4 border border-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-premium"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <>
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg border-2 border-white shrink-0 bg-white">
                                                        <LazyImage
                                                            src={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url)[0] : null}
                                                            urls={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url) : []}
                                                            alt={mentor.name}
                                                            objectFit="cover"
                                                            className="w-full h-full"
                                                            fallback={
                                                                <div className="w-full h-full flex items-center justify-center bg-[#1a27c9]/5 text-[#1a27c9] font-black text-2xl">
                                                                    {mentor.name.charAt(0)}
                                                                </div>
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-black text-lg text-[#0d0e0e] uppercase leading-tight truncate mb-1">{mentor.name}</h4>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate mb-2">{mentor.email}</p>
                                                        {mentor.bio && (
                                                            <p className="text-sm font-bold text-slate-500 leading-relaxed italic">{mentor.bio}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-3 mt-6">
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyBookingLink(mentor.id); }}
                                                    className="flex-1 flex items-center justify-center gap-2 bg-white border-2 border-slate-100 text-[#0d0e0e] hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium py-4 rounded-2xl font-black text-xs uppercase tracking-widest"
                                                >
                                                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                                                    {copied ? 'Copied!' : 'Copy Link'}
                                                </button>
                                                <a
                                                    href={`#/book/${mentor.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => { e.stopPropagation(); }}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <ExternalLink size={18} />
                                                </a>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingMentor(mentor); }}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteMentor(mentor.id); }}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-rose-500 hover:text-rose-500 hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {/* Slots Tab */}
                {activeTab === 'slots' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                        <div className="flex justify-between items-center mb-8">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-black text-[#0d0e0e]">Slots</h2>
                                {selectedSlotIds.length > 0 && (
                                    <button
                                        onClick={handleBulkDeleteSlots}
                                        className="flex items-center gap-2 bg-rose-500 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-600 transition-premium"
                                    >
                                        <Trash2 size={16} />
                                        Delete {selectedSlotIds.length} Slot{selectedSlotIds.length > 1 ? 's' : ''}
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setShowAddSlot(true)}
                                className="flex items-center gap-3 bg-[#1a27c9] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium group active:scale-95"
                            >
                                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-500" />
                                Add Slot
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">
                                            <input
                                                type="checkbox"
                                                checked={slots.length > 0 && selectedSlotIds.length === slots.length}
                                                onChange={toggleSelectAllSlots}
                                                className="w-5 h-5"
                                            />
                                        </th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Mentor</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Start Time</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">End Time</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Meet Link</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Available</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {slots.map((slot) => (
                                        <tr key={slot.id} className="border-b border-slate-50">
                                            <td className="py-5 px-6">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSlotIds.includes(slot.id)}
                                                    onChange={() => toggleSlotSelection(slot.id)}
                                                    className="w-5 h-5"
                                                />
                                            </td>
                                            <td className="py-5 px-6">
                                                <span className="font-bold text-[#0d0e0e]">{slot.mentors?.name || 'Unknown'}</span>
                                            </td>
                                            <td className="py-5 px-6">
                                                {editingSlot?.id === slot.id ? (
                                                    <input
                                                        type="datetime-local"
                                                        value={editingSlot.start_time?.slice(0, 16)}
                                                        onChange={(e) => setEditingSlot({ ...editingSlot, start_time: e.target.value })}
                                                        className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                    />
                                                ) : (
                                                    <span className="text-slate-500 font-bold">{new Date(slot.start_time).toLocaleString()}</span>
                                                )}
                                            </td>
                                            <td className="py-5 px-6">
                                                {editingSlot?.id === slot.id ? (
                                                    <input
                                                        type="datetime-local"
                                                        value={editingSlot.end_time?.slice(0, 16)}
                                                        onChange={(e) => setEditingSlot({ ...editingSlot, end_time: e.target.value })}
                                                        className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                    />
                                                ) : (
                                                    <span className="text-slate-500 font-bold">{new Date(slot.end_time).toLocaleString()}</span>
                                                )}
                                            </td>
                                            <td className="py-5 px-6">
                                                {editingSlot?.id === slot.id ? (
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="url"
                                                            value={editingSlot.meet_link || ''}
                                                            onChange={(e) => setEditingSlot({ ...editingSlot, meet_link: e.target.value })}
                                                            placeholder="https://meet.google.com/..."
                                                            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={generatingMeetLink}
                                                            onClick={async () => {
                                                                const link = await generateMeetLink(
                                                                    editingSlot.start_time,
                                                                    editingSlot.end_time,
                                                                    slot.id
                                                                );

                                                                if (link) {
                                                                    setEditingSlot({ ...editingSlot, meet_link: link });
                                                                }
                                                            }}
                                                            className="px-4 py-3 bg-white border-2 border-slate-100 text-[#1a27c9] hover:border-[#1a27c9] hover:bg-[#1a27c9]/5 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {generatingMeetLink ? 'Generating...' : 'Generate'}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    slot.meet_link ? (
                                                        <a 
                                                            href={slot.meet_link} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-[#1a27c9] hover:underline font-bold text-sm truncate block"
                                                        >
                                                            {slot.meet_link}
                                                        </a>
                                                    ) : (
                                                        <span className="text-slate-400 font-bold text-sm">-</span>
                                                    )
                                                )}
                                            </td>
                                            <td className="py-5 px-6">
                                                {editingSlot?.id === slot.id ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={editingSlot.is_available}
                                                        onChange={(e) => setEditingSlot({ ...editingSlot, is_available: e.target.checked })}
                                                        className="w-5 h-5"
                                                    />
                                                ) : (
                                                    <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                                        slot.is_available
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-rose-100 text-rose-700'
                                                    }`}>
                                                        {slot.is_available ? 'Yes' : 'No'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-5 px-6">
                                                <div className="flex gap-3">
                                                    {editingSlot?.id === slot.id ? (
                                                        <>
                                                            <button
                                                                onClick={handleUpdateSlot}
                                                                className="text-emerald-600 hover:text-emerald-700 font-black text-xs uppercase tracking-widest"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingSlot(null)}
                                                                className="text-slate-400 hover:text-slate-600 font-black text-xs uppercase tracking-widest"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => setEditingSlot(slot)}
                                                                className="text-[#1a27c9] hover:text-[#0d0e0e]"
                                                            >
                                                                <Edit size={18} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteSlot(slot.id)}
                                                                className="text-rose-500 hover:text-rose-600"
                                                            >
                                                                <Trash2 size={18} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Bookings Tab */}
                {activeTab === 'bookings' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                        <h2 className="text-xl font-black text-[#0d0e0e] mb-8">Bookings</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Company</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Booker Email</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Mentor</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Slot Time</th>
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bookings.map((booking) => (
                                        <tr key={booking.id} className="border-b border-slate-50">
                                            <td className="py-5 px-6">
                                                <span className="font-bold text-[#0d0e0e]">{booking.company_name}</span>
                                            </td>
                                            <td className="py-5 px-6">
                                                <span className="text-slate-500 font-bold">{booking.booker_email}</span>
                                            </td>
                                            <td className="py-5 px-6">
                                                <span className="text-slate-500 font-bold">{booking.mentors?.name}</span>
                                            </td>
                                            <td className="py-5 px-6">
                                                <span className="text-slate-500 font-bold">
                                                    {new Date(booking.mentor_slots?.start_time).toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="py-5 px-6">
                                                <button
                                                    onClick={() => handleDeleteBooking(booking.id)}
                                                    className="text-rose-500 hover:text-rose-600"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Schedule Tab */}
                {activeTab === 'schedule' && (
                    <div className="space-y-6">
                        {/* Global Defaults Panel */}
                        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-black text-[#0d0e0e]">Day-by-Day Schedule Settings</h2>
                                <span className="px-4 py-2 rounded-full bg-[#1a27c9]/10 text-[#1a27c9] text-[10px] font-black uppercase tracking-widest">
                                    Flexible Per-Day Config
                                </span>
                            </div>
                            <p className="text-sm text-slate-500 font-bold mb-8 leading-relaxed">
                                Configure mentoring session time windows and slot granularity for each day. You can set global defaults below, then fine-tune individual days.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Number of Days</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {DAY_PRESETS.map(p => (
                                            <button
                                                key={p.value}
                                                type="button"
                                                onClick={() => setNumDays(p.value)}
                                                className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium ${
                                                    numDays === p.value
                                                        ? 'bg-[#1a27c9] text-white shadow-lg shadow-indigo-200'
                                                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                                }`}
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                        <input
                                            type="number"
                                            min={1}
                                            max={31}
                                            value={numDays}
                                            onChange={(e) => setNumDays(Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)))}
                                            className="w-24 px-4 py-3 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all text-center"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Global Session Start Time</label>
                                    <input
                                        type="time"
                                        value={globalStartTime}
                                        onChange={(e) => setGlobalStartTime(e.target.value)}
                                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                    />
                                    <p className="text-[10px] text-slate-400 mt-2 font-bold">
                                        Default: {timeTo12Hour(globalStartTime)}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Slot Duration (Minutes)</label>
                                    <div className="space-y-3">
                                        <div className="flex gap-2 flex-wrap">
                                            {SLOT_PRESETS.map(mins => (
                                                <button
                                                    key={mins}
                                                    type="button"
                                                    onClick={() => { setGlobalSlotMins(mins); setGlobalUseCustom(false); }}
                                                    className={`px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium ${
                                                        !globalUseCustom && globalSlotMins === mins
                                                            ? 'bg-[#1a27c9] text-white shadow-md shadow-indigo-200'
                                                            : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    {mins}m
                                                </button>
                                            ))}
                                            <label className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-widest cursor-pointer transition-premium ${
                                                globalUseCustom ? 'bg-[#1a27c9] text-white shadow-md shadow-indigo-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                            }`}>
                                                <input
                                                    type="checkbox"
                                                    className="sr-only"
                                                    checked={globalUseCustom}
                                                    onChange={(e) => setGlobalUseCustom(e.target.checked)}
                                                />
                                                Custom
                                            </label>
                                        </div>
                                        {globalUseCustom && (
                                            <input
                                                type="number"
                                                min={5}
                                                max={240}
                                                step={5}
                                                value={globalCustomMins}
                                                onChange={(e) => setGlobalCustomMins(parseInt(e.target.value, 10) || 25)}
                                                className="w-full px-5 py-3 bg-white border-2 border-slate-100 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col justify-end">
                                    <button
                                        type="button"
                                        onClick={handleApplyGlobalToAllDays}
                                        className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-[#1a27c9] to-indigo-600 text-white px-8 py-5 rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-2xl hover:shadow-indigo-200/60 transition-premium active:scale-95"
                                    >
                                        <Database size={16} />
                                        Apply Defaults to All {numDays} Days
                                    </button>
                                </div>
                            </div>

                            {mentors.length === 0 && (
                                <div className="p-6 bg-amber-50 border border-amber-200 rounded-3xl flex items-start gap-4">
                                    <AlertTriangle size={24} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-black text-amber-700 text-xs uppercase tracking-widest mb-1">No Mentors Added Yet</p>
                                        <p className="text-amber-600 font-bold text-sm leading-relaxed">
                                            Add mentors from the "Mentors" tab first, then return here to assign them to schedule days and generate slots.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Day Cards */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {Array.from({ length: numDays }, (_, idx) => {
                                const dayNumber = idx + 1;
                                const cfg = getDayConfigOrDefault(dayNumber);
                                const dayMeta = getEventDayMeta(dayNumber);
                                const preview = calculateDaySlotTimes(cfg);
                                const isDirty = configDirtyByDay[dayNumber];
                                const isSaving = savingDay === dayNumber;
                                const isGenerating = generatingDay === dayNumber;
                                const selectedMentorIds = selectedMentorsByDay[dayNumber] || [];
                                const genResult = genResultByDay[dayNumber];
                                const overMode = overwriteModeByDay[dayNumber] || 'skip';

                                return (
                                    <div key={dayNumber} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                                        {/* Day Header */}
                                        <div className="px-8 pt-8 pb-6 border-b border-slate-100 flex items-center justify-between flex-wrap gap-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1a27c9] to-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-lg shadow-indigo-200/60">
                                                    D{dayNumber}
                                                </div>
                                                <div>
                                                    <h3 className="font-black text-lg text-[#0d0e0e] uppercase tracking-tight">
                                                        Day {dayNumber}
                                                        {dayMeta?.day_name && <span className="ml-3 text-sm text-slate-400 font-bold normal-case tracking-normal">({dayMeta.day_name})</span>}
                                                    </h3>
                                                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                                                        {dayMeta?.day_date ? new Date(dayMeta.day_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'No date linked to event_days'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {isDirty && (
                                                    <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest border border-amber-200">
                                                        Unsaved
                                                    </span>
                                                )}
                                                {!isDirty && dayConfigs.some(c => c.day_number === dayNumber) && (
                                                    <span className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                                                        Saved
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Config Section */}
                                        <div className="p-8 space-y-6">
                                            {/* Date Override */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Date (for slot generation)</label>
                                                    <input
                                                        type="date"
                                                        value={cfg.day_date || ''}
                                                        onChange={(e) => handleDayFieldChange(dayNumber, 'day_date', e.target.value || null)}
                                                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Slot Duration (Min)</label>
                                                    <div className="flex gap-2">
                                                        {SLOT_PRESETS.map(mins => (
                                                            <button
                                                                key={mins}
                                                                type="button"
                                                                onClick={() => handleDayFieldChange(dayNumber, 'slot_duration_minutes', mins)}
                                                                className={`flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium ${
                                                                    cfg.slot_duration_minutes === mins
                                                                        ? 'bg-[#1a27c9] text-white shadow-md shadow-indigo-200'
                                                                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                                                }`}
                                                            >
                                                                {mins}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Times */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Session Start Time</label>
                                                    <input
                                                        type="time"
                                                        value={cfg.session_start_time}
                                                        onChange={(e) => handleDayFieldChange(dayNumber, 'session_start_time', e.target.value)}
                                                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                                    />
                                                    <p className="text-[10px] text-slate-400 mt-1.5 font-bold">{timeTo12Hour(cfg.session_start_time)}</p>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Session End Time</label>
                                                    <input
                                                        type="time"
                                                        value={cfg.session_end_time}
                                                        onChange={(e) => handleDayFieldChange(dayNumber, 'session_end_time', e.target.value)}
                                                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                                    />
                                                    <p className="text-[10px] text-slate-400 mt-1.5 font-bold">{timeTo12Hour(cfg.session_end_time)}</p>
                                                </div>
                                            </div>

                                            {/* Break + Preview */}
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-end">
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Break Between (Min)</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={60}
                                                        step={5}
                                                        value={cfg.break_between_slots_minutes}
                                                        onChange={(e) => handleDayFieldChange(dayNumber, 'break_between_slots_minutes', parseInt(e.target.value, 10) || 0)}
                                                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                                    />
                                                </div>
                                                <div className="sm:col-span-2 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-5 border border-slate-200">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Slot Preview</span>
                                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                                            preview.slotsCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                                        }`}>
                                                            {preview.slotsCount} slots
                                                        </span>
                                                    </div>
                                                    <div className="flex items-baseline gap-4 flex-wrap">
                                                        <div>
                                                            <span className="text-2xl font-black text-[#0d0e0e]">{preview.slotsCount}</span>
                                                            <span className="text-xs text-slate-500 font-bold ml-2 uppercase tracking-wider">per mentor</span>
                                                        </div>
                                                        <div className="h-4 w-px bg-slate-300" />
                                                        <div>
                                                            <span className="text-2xl font-black text-[#1a27c9]">{preview.totalHours}</span>
                                                            <span className="text-xs text-slate-500 font-bold ml-2 uppercase tracking-wider">hrs total</span>
                                                        </div>
                                                        <div className="h-4 w-px bg-slate-300" />
                                                        <div>
                                                            <span className="text-lg font-black text-slate-600">{preview.slotsCount > 0 ? timeTo12Hour(preview.slotTimes[0].start_time) : '--:--'}</span>
                                                            <span className="text-xs text-slate-400 font-bold mx-2">→</span>
                                                            <span className="text-lg font-black text-slate-600">{preview.slotsCount > 0 ? timeTo12Hour(preview.slotTimes[preview.slotsCount - 1].end_time) : '--:--'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Save Config Button */}
                                            <button
                                                type="button"
                                                disabled={isSaving || !isDirty}
                                                onClick={() => handleSaveDayConfig(dayNumber)}
                                                className="w-full flex items-center justify-center gap-3 bg-[#1a27c9] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                                            >
                                                {isSaving ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        Saving Config...
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle size={16} />
                                                        Save Day {dayNumber} Config
                                                    </>
                                                )}
                                            </button>

                                            <hr className="border-slate-100" />

                                            {/* Mentor Selection */}
                                            <div>
                                                <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
                                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                        Assign Mentors ({selectedMentorIds.length}/{mentors.length})
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSelectAllMentorsForDay(dayNumber)}
                                                            disabled={mentors.length === 0}
                                                            className="px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 rounded-2xl hover:bg-slate-100 transition-premium disabled:opacity-40"
                                                        >
                                                            Select All
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleClearMentorsForDay(dayNumber)}
                                                            disabled={selectedMentorIds.length === 0}
                                                            className="px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 rounded-2xl hover:bg-slate-100 transition-premium disabled:opacity-40"
                                                        >
                                                            Clear
                                                        </button>
                                                    </div>
                                                </div>
                                                {mentors.length === 0 ? (
                                                    <p className="text-sm text-slate-400 font-bold p-4 bg-slate-50 rounded-2xl italic text-center">
                                                        Add mentors first from the Mentors tab
                                                    </p>
                                                ) : (
                                                    <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-2 p-2 bg-slate-50/50 rounded-2xl border border-slate-100">
                                                        {mentors.map((mentor) => {
                                                            const checked = selectedMentorIds.includes(mentor.id);
                                                            return (
                                                                <label
                                                                    key={mentor.id}
                                                                    className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-premium border ${
                                                                        checked ? 'bg-white border-[#1a27c9]/30 shadow-sm' : 'bg-transparent border-transparent hover:bg-white hover:border-slate-200'
                                                                    }`}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        onChange={() => handleToggleMentorForDay(dayNumber, mentor.id)}
                                                                        className="w-4 h-4 accent-[#1a27c9]"
                                                                    />
                                                                    <div className="w-9 h-9 rounded-xl overflow-hidden bg-[#1a27c9]/10 shrink-0 flex items-center justify-center text-[#1a27c9] font-black text-sm border-2 border-white shadow">
                                                                        {mentor.photo_url ? (
                                                                            <LazyImage
                                                                                src={getGoogleDriveFallbackUrls(mentor.photo_url)[0]}
                                                                                urls={getGoogleDriveFallbackUrls(mentor.photo_url)}
                                                                                alt={mentor.name}
                                                                                objectFit="cover"
                                                                                className="w-full h-full"
                                                                            />
                                                                        ) : (
                                                                            mentor.name.charAt(0)
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="font-black text-sm text-[#0d0e0e] truncate">{mentor.name}</p>
                                                                        <p className="text-[10px] text-slate-400 font-bold truncate">{mentor.email}</p>
                                                                    </div>
                                                                    {preview.slotsCount > 0 && checked && (
                                                                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest shrink-0">
                                                                            +{preview.slotsCount}
                                                                        </span>
                                                                    )}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Overwrite Mode + Generate */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Conflict Handling</label>
                                                    <select
                                                        value={overMode}
                                                        onChange={(e) => setOverwriteModeByDay(prev => ({ ...prev, [dayNumber]: e.target.value }))}
                                                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                                    >
                                                        <option value="skip">Skip Conflicting (Safe)</option>
                                                        <option value="replace_if_conflict">Replace Only Conflicts</option>
                                                        <option value="replace_all_for_day">Replace All Slots For Day</option>
                                                    </select>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={isGenerating || selectedMentorIds.length === 0 || preview.slotsCount === 0}
                                                    onClick={() => handleGenerateSlotsForDay(dayNumber)}
                                                    className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-xl hover:shadow-emerald-200 transition-premium disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                                                >
                                                    {isGenerating ? (
                                                        <>
                                                            <Loader2 size={16} className="animate-spin" />
                                                            Generating Slots...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Plus size={16} />
                                                            Generate {selectedMentorIds.length * preview.slotsCount} Slot{selectedMentorIds.length * preview.slotsCount === 1 ? '' : 's'}
                                                        </>
                                                    )}
                                                </button>
                                            </div>

                                            {/* Generation Result Banner */}
                                            {genResult && (
                                                <div className={`rounded-2xl p-5 border ${
                                                    genResult.ok
                                                        ? 'bg-emerald-50 border-emerald-200'
                                                        : 'bg-rose-50 border-rose-200'
                                                }`}>
                                                    {genResult.ok ? (
                                                        <div className="flex items-start gap-3">
                                                            <CheckCircle size={22} className="text-emerald-500 shrink-0 mt-0.5" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-black text-emerald-800 text-xs uppercase tracking-widest mb-1">
                                                                    Slots Generated Successfully ({genResult.ts})
                                                                </p>
                                                                <div className="grid grid-cols-3 gap-3 mt-2">
                                                                    <div>
                                                                        <p className="text-2xl font-black text-emerald-700">{genResult.created}</p>
                                                                        <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Created</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-2xl font-black text-amber-600">{genResult.skipped}</p>
                                                                        <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">Skipped</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-2xl font-black text-rose-600">{genResult.conflicts}</p>
                                                                        <p className="text-[10px] text-rose-600 font-bold uppercase tracking-wider">Conflicts</p>
                                                                    </div>
                                                                </div>
                                                                <p className="text-xs text-emerald-700 font-bold mt-2">
                                                                    {genResult.perMentor} slot{genResult.perMentor === 1 ? '' : 's'} per mentor × {selectedMentorIds.length} mentor{selectedMentorIds.length === 1 ? '' : 's'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-start gap-3">
                                                            <AlertTriangle size={22} className="text-rose-500 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="font-black text-rose-800 text-xs uppercase tracking-widest mb-1">Failed ({genResult.ts})</p>
                                                                <p className="text-rose-700 font-bold text-sm leading-relaxed">{genResult.error}</p>
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
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                        <h2 className="text-xl font-black text-[#0d0e0e] mb-8">Notification Settings</h2>
                        
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Admin Email</label>
                                <p className="text-sm text-slate-500 mb-3">This email will receive a copy of all booking notifications.</p>
                                <div className="flex gap-3">
                                    <input
                                        type="email"
                                        value={adminEmail}
                                        onChange={(e) => setAdminEmail(e.target.value)}
                                        placeholder="admin@example.com"
                                        className="flex-1 px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                    />
                                    <button
                                        onClick={handleSaveAdminEmail}
                                        className="bg-[#1a27c9] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Mentor Hub Modal - Moved outside main container */}
            {showHubModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 pointer-events-auto" onClick={closeHubModal} />
                    <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-[3.5rem] shadow-2xl relative z-[101] flex flex-col overflow-hidden animate-in zoom-in duration-500 pointer-events-auto">
                        {/* Header Section */}
                        <div className="p-8 sm:p-12 border-b border-slate-100 shrink-0">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 bg-[#1a27c9]/10 rounded-2xl flex items-center justify-center text-[#1a27c9]">
                                            <Database size={20} />
                                        </div>
                                        <h2 className="text-3xl font-black text-[#0d0e0e] tracking-tight uppercase">Athar Network</h2>
                                    </div>
                                    <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">Source vetted experts from the global Pulse network</p>
                                </div>
                                <button
                                    onClick={closeHubModal}
                                    className="p-4 hover:bg-slate-50 rounded-2xl text-slate-400 transition-premium"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Internal Modal Search */}
                            <div className="relative">
                                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search by name, title or sector..."
                                    value={hubSearch}
                                    onChange={(e) => setHubSearch(e.target.value)}
                                    className="w-full pl-16 pr-8 py-5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-3xl font-bold text-[#0d0e0e] transition-all placeholder:text-slate-300 focus:outline-none"
                                />
                            </div>
                        </div>

                        {/* Content Section */}
                        <div className="flex-1 overflow-y-auto p-8 sm:p-12 custom-scrollbar">
                            {hubLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4">
                                    <Loader2 className="animate-spin text-[#1a27c9]" size={40} />
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Hub Database...</p>
                                </div>
                            ) : filteredHubExperts.length === 0 ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4 grayscale opacity-40">
                                    <Database size={64} className="text-slate-300" />
                                    <p className="font-black text-slate-400 uppercase tracking-widest">No experts found</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {filteredHubExperts.map((expert) => (
                                        <div 
                                            key={expert.id}
                                            className={`group/item relative bg-slate-50 rounded-[2.5rem] border border-slate-100 p-6 hover:shadow-xl hover:bg-white transition-premium cursor-default ${selectedHubExpert?.id === expert.id ? 'border-[#1a27c9] bg-[#1a27c9]/5' : ''}`}
                                        >
                                            <div className="flex items-center gap-6" onClick={() => handleSelectHubExpert(expert)}>
                                                <div className="w-20 h-20 rounded-3xl overflow-hidden shadow-lg border-2 border-white shrink-0 bg-white">
                                                    <LazyImage
                                                        src={expert.photo_url ? getGoogleDriveFallbackUrls(expert.photo_url)[0] : null}
                                                        urls={expert.photo_url ? getGoogleDriveFallbackUrls(expert.photo_url) : []}
                                                        alt={expert.name}
                                                        objectFit="cover"
                                                        className="group-hover/item:scale-110 transition-transform duration-700"
                                                        fallback={
                                                            <div className="w-full h-full flex items-center justify-center bg-[#1a27c9]/5 text-[#1a27c9] font-black text-3xl">
                                                                {expert.name.charAt(0)}
                                                            </div>
                                                        }
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-black text-lg text-[#0d0e0e] uppercase leading-tight truncate mb-1">{expert.name}</h4>
                                                    <p className="text-[10px] font-bold text-[#1a27c9] uppercase tracking-wider truncate mb-2">{expert.title}</p>
                                                    <div className="flex items-center gap-2">
                                                        <Briefcase size={12} className="text-slate-300" />
                                                        <span className="text-[10px] font-black text-slate-400 uppercase truncate">{expert.company || 'Vetted Pulse'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {selectedHubExpert?.id === expert.id && (
                                                <div className="mt-6 space-y-4">
                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Booking Email</label>
                                                        <input
                                                            type="email"
                                                            value={mentorEmail}
                                                            onChange={(e) => setMentorEmail(e.target.value)}
                                                            placeholder="mentor@company.com"
                                                            className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                        />
                                                        <p className="text-[10px] text-slate-400 mt-2">
                                                            هذا الإيميل سيُستخدم داخل موديول الحجز فقط
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={handleImportMentor}
                                                        disabled={importingMentorId === expert.id}
                                                        className="w-full bg-[#1a27c9] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium flex items-center justify-center gap-3 disabled:opacity-60"
                                                    >
                                                        {importingMentorId === expert.id ? (
                                                            <>
                                                                <Loader2 size={16} className="animate-spin" />
                                                                Adding Mentor...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Plus size={16} />
                                                                Add to Booking
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Add Slot Modal - Moved outside main container */}
            {showAddSlot && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 pointer-events-auto" onClick={() => setShowAddSlot(false)} />
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 p-8 relative z-[101] pointer-events-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-2xl font-black text-[#0d0e0e] tracking-tight">Add New Slot</h3>
                            </div>
                            <button
                                onClick={() => setShowAddSlot(false)}
                                className="p-4 hover:bg-slate-50 rounded-2xl text-slate-400 transition-premium"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {isWithin24Hours(newSlot.start_time) && (
                            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-black text-amber-700 text-xs uppercase tracking-widest mb-1">Important Notice</p>
                                    <p className="text-amber-600 font-bold text-sm">
                                        Slots within 24 hours from now will NOT be visible to clients on the booking page.
                                    </p>
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleCreateSlot} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mentor</label>
                                <select
                                    value={newSlot.mentor_id}
                                    onChange={(e) => setNewSlot({ ...newSlot, mentor_id: e.target.value })}
                                    className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-3xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                    required
                                >
                                    <option value="">Select Mentor</option>
                                    {mentors.map((mentor) => (
                                        <option key={mentor.id} value={mentor.id}>{mentor.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Start Time</label>
                                <input
                                    type="datetime-local"
                                    value={newSlot.start_time}
                                    onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                                    className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-3xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">End Time</label>
                                <input
                                    type="datetime-local"
                                    value={newSlot.end_time}
                                    onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                                    className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-3xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Google Meet Link</label>
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        value={newSlot.meet_link}
                                        onChange={(e) => setNewSlot({ ...newSlot, meet_link: e.target.value })}
                                        placeholder="https://meet.google.com/..."
                                        className="flex-1 px-6 py-5 bg-slate-50 border-2 border-slate-50 focus:border-[#1a27c9]/20 rounded-3xl font-bold text-[#0d0e0e] focus:outline-none transition-all"
                                    />
                                    <button
                                        type="button"
                                        disabled={generatingMeetLink || !newSlot.start_time || !newSlot.end_time}
                                        onClick={async () => {
                                            if (!newSlot.start_time || !newSlot.end_time) {
                                                alert('Please select start and end time first.');
                                                return;
                                            }

                                            const link = await generateMeetLink(
                                                new Date(newSlot.start_time).toISOString(),
                                                new Date(newSlot.end_time).toISOString(),
                                                null
                                            );

                                            if (link) {
                                                setNewSlot({ ...newSlot, meet_link: link });
                                            }
                                        }}
                                        className="px-4 py-5 bg-white border-2 border-slate-100 text-[#1a27c9] hover:border-[#1a27c9] hover:bg-[#1a27c9]/5 rounded-3xl font-black text-xs uppercase tracking-widest transition-premium disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {generatingMeetLink ? 'Generating...' : 'Generate'}
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAddSlot(false)}
                                    className="flex-1 px-8 py-5 bg-white border-2 border-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-premium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-[2] px-8 py-5 bg-[#1a27c9] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium"
                                >
                                    Create Slot
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
