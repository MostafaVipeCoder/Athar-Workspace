import React, { useMemo, useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Calendar, Clock, Users, Copy, CheckCircle, ArrowLeft, Search, Loader2, Briefcase, X, Database, AlertTriangle, ExternalLink, Settings, Mail, Save } from 'lucide-react';
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
    updateMentorNotificationSettings,
    ADVANCE_NOTICE_OPTIONS,
    isSlotWithinNoticeWindow
} from '../lib/mentorBooking';
import { supabase } from '../lib/supabase';
import { getMasterExperts } from '../lib/api';
import { getGoogleDriveFallbackUrls } from '../lib/utils';
import LazyImage from './LazyImage';
import RichTextEditor from './RichTextEditor';

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

export default function MentorBookingAdmin() {
    const { eventId } = useParams();
    const [mentors, setMentors] = useState([]);
    const [slots, setSlots] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('mentors');
    const [adminEmail, setAdminEmail] = useState('');
    const [mentorAdminEmails, setMentorAdminEmails] = useState([]);
    const [mentorCcEmails, setMentorCcEmails] = useState([]);
    const [newAdminEmail, setNewAdminEmail] = useState('');
    const [newCcEmail, setNewCcEmail] = useState('');
    const [mentorEmailTemplateSubject, setMentorEmailTemplateSubject] = useState('');
    const [mentorEmailTemplateBody, setMentorEmailTemplateBody] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const [showHubModal, setShowHubModal] = useState(false);
    const [showAddSlot, setShowAddSlot] = useState(false);
    const [editingMentor, setEditingMentor] = useState(null);
    const [editingSlot, setEditingSlot] = useState(null);
    const [newSlot, setNewSlot] = useState({ 
        mentor_id: '', 
        date: '', 
        start_time: '', 
        slot_duration: 30, 
        break_time: 5, 
        num_slots: 1,
        meet_link: ''
    });
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

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
    };

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
            const [mentorsData, slotsData, bookingsData, eventData] = await Promise.all([
                getMentors(eventId),
                getSlots(eventId),
                getBookings(eventId),
                getEvent(eventId)
            ]);
            setMentors(mentorsData);
            setSlots(slotsData);
            setBookings(bookingsData);
            setEvent(eventData);
            setAdminEmail(eventData?.admin_email || '');
            setMentorAdminEmails(eventData?.mentor_admin_emails || []);
            setMentorCcEmails(eventData?.mentor_cc_emails || []);
            setMentorEmailTemplateSubject(eventData?.mentor_email_template_subject || 'New Mentor Session Booking: {{company_name}} with {{mentor_name}}');
            setMentorEmailTemplateBody(eventData?.mentor_email_template_body || '<p>Dear Team,</p><p>A new mentor session has been booked.</p><p><strong>Company:</strong> {{company_name}}<br><strong>Mentor:</strong> {{mentor_name}}</p><p>Best regards,<br>The Athar Team</p>');
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveNotificationSettings = async () => {
        try {
            setSavingSettings(true);
            const updates = {
                admin_email: adminEmail.trim(),
                mentor_admin_emails: mentorAdminEmails,
                mentor_cc_emails: mentorCcEmails,
                mentor_email_template_subject: mentorEmailTemplateSubject,
                mentor_email_template_body: mentorEmailTemplateBody
            };
            await updateMentorNotificationSettings(eventId, updates);
            setEvent(prev => prev ? { ...prev, ...updates } : null);
            showToast('تم حفظ إعدادات إشعارات المينتورز بنجاح');
        } catch (error) {
            console.error('Error saving mentor notification settings:', error);
            showToast('فشل حفظ الإعدادات: ' + error.message, 'error');
        } finally {
            setSavingSettings(false);
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
            const slotsToCreate = [];
            const { mentor_id, date, start_time, slot_duration, break_time, num_slots, meet_link } = newSlot;
            
            // Parse start time
            const [hours, minutes] = start_time.split(':').map(Number);
            let currentStartTime = new Date(date);
            currentStartTime.setHours(hours, minutes, 0, 0);
            
            for (let i = 0; i < num_slots; i++) {
                const currentEndTime = new Date(currentStartTime);
                currentEndTime.setMinutes(currentEndTime.getMinutes() + slot_duration);
                
                slotsToCreate.push({
                    mentor_id,
                    event_id: eventId,
                    start_time: currentStartTime.toISOString(),
                    end_time: currentEndTime.toISOString(),
                    is_available: true,
                    meet_link
                });
                
                // Prepare for next slot (add break time if not last slot)
                if (i < num_slots - 1) {
                    currentStartTime = new Date(currentEndTime);
                    currentStartTime.setMinutes(currentStartTime.getMinutes() + break_time);
                }
            }
            
            // Create all slots
            await Promise.all(slotsToCreate.map(slot => createSlot(slot)));
            
            // Reset state
            setNewSlot({ 
                mentor_id: '', 
                date: '', 
                start_time: '', 
                slot_duration: 30, 
                break_time: 5, 
                num_slots: 1,
                meet_link: ''
            });
            setShowAddSlot(false);
            showToast(`تم إنشاء ${slotsToCreate.length} موعد بنجاح`);
            loadData();
        } catch (error) {
            alert('Error creating slots: ' + error.message);
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
                                <div
                                    key={mentor.id}
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
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Advance Notice Window</label>
                                                <select
                                                    value={editingMentor.advance_notice_minutes ?? 1440}
                                                    onChange={(e) => setEditingMentor({ ...editingMentor, advance_notice_minutes: parseInt(e.target.value, 10) })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                >
                                                    {ADVANCE_NOTICE_OPTIONS.map((opt) => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-400 font-bold mt-1">Minimum notice required before a booking can be made.</p>
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
                                                    onClick={() => setEditingMentor(null)}
                                                    className="px-6 py-4 border border-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-premium"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <>
                                            <Link
                                                to={`/event/${eventId}/mentor-booking/${mentor.id}`}
                                                className="block group"
                                            >
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
                                                            <h4 className="font-black text-lg text-[#0d0e0e] group-hover:text-[#1a27c9] uppercase leading-tight truncate mb-1 transition-colors">{mentor.name}</h4>
                                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate mb-2">{mentor.email}</p>
                                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                <span className="px-3 py-1 rounded-lg bg-indigo-50 text-[#1a27c9] text-[10px] font-black uppercase tracking-wider">
                                                                    Notice: {ADVANCE_NOTICE_OPTIONS.find(o => o.value === (mentor.advance_notice_minutes ?? 1440))?.label?.split('(')[0]?.trim() || `${mentor.advance_notice_minutes ?? 1440}m`}
                                                                </span>
                                                            </div>
                                                            {mentor.bio && (
                                                                <p className="text-sm font-bold text-slate-500 leading-relaxed italic">{mentor.bio}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </Link>
                                            <div className="flex gap-3 mt-6">
                                                <button
                                                    type="button"
                                                    onClick={() => copyBookingLink(mentor.id)}
                                                    className="flex-1 flex items-center justify-center gap-2 bg-white border-2 border-slate-100 text-[#0d0e0e] hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium py-4 rounded-2xl font-black text-xs uppercase tracking-widest"
                                                >
                                                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                                                    {copied ? 'Copied!' : 'Copy Link'}
                                                </button>
                                                <a
                                                    href={`#/book/${mentor.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <ExternalLink size={18} />
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingMentor(mentor)}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteMentor(mentor.id)}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-rose-500 hover:text-rose-500 hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
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
                                onClick={() => {
                                    setNewSlot({ 
                                        mentor_id: '', 
                                        date: '', 
                                        start_time: '', 
                                        slot_duration: 30, 
                                        break_time: 5, 
                                        num_slots: 1,
                                        meet_link: ''
                                    });
                                    setShowAddSlot(true);
                                }}
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
                                                ) : (() => {
                                                    const isNoticeExpired = isSlotWithinNoticeWindow(slot.start_time, slot.mentors?.advance_notice_minutes ?? 1440);
                                                    const isEffectivelyAvailable = slot.is_available && !isNoticeExpired;
                                                    return (
                                                        <div className="flex flex-col gap-1 items-start">
                                                            <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                                                isEffectivelyAvailable
                                                                    ? 'bg-emerald-100 text-emerald-700'
                                                                    : 'bg-rose-100 text-rose-700'
                                                            }`}>
                                                                {isEffectivelyAvailable ? 'Yes' : 'No'}
                                                            </span>
                                                            {slot.is_available && isNoticeExpired && (
                                                                <span className="text-[9px] font-bold text-amber-600">Within notice window</span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
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

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 space-y-8">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 bg-[#1a27c9]/10 rounded-2xl flex items-center justify-center text-[#1a27c9]">
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-[#0d0e0e]">Mentor Booking Notification Settings</h2>
                                    <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">إعدادات إشعارات موديول المينتورز (مستقلة تماماً عن السيلكشن بروسيس)</p>
                                </div>
                            </div>
                        </div>

                        {/* Notice Banner */}
                        <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex items-start gap-3">
                            <AlertTriangle size={18} className="text-[#1a27c9] shrink-0 mt-0.5" />
                            <div className="text-xs text-slate-600 font-bold leading-relaxed">
                                <span className="text-[#1a27c9] font-black">نظام الإشعارات المعزول:</span> هذه الإعدادات وقوائم المستلمين تخص حصرياً حجوزات المينتورز بوكينج ولن ترسل أي إشعارات لمسؤولي السيلكشن أو متقدمي البرامج.
                            </div>
                        </div>

                        {/* Mentor Admin Emails */}
                        <div className="space-y-4 pt-2">
                            <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Mentor Admin Emails (مسؤولو المينتورنج)</h3>
                            <p className="text-xs text-slate-500 font-medium">سيتم إرسال نسخة من كل إشعار حجز جلسة توجيه إلى هذه العناوين.</p>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={newAdminEmail}
                                    onChange={(e) => setNewAdminEmail(e.target.value)}
                                    placeholder="mentor.admin@example.com"
                                    className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter' && newAdminEmail.trim() && !mentorAdminEmails.includes(newAdminEmail.trim())) {
                                            e.preventDefault();
                                            setMentorAdminEmails(prev => [...prev, newAdminEmail.trim()]);
                                            setNewAdminEmail('');
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (newAdminEmail.trim() && !mentorAdminEmails.includes(newAdminEmail.trim())) {
                                            setMentorAdminEmails(prev => [...prev, newAdminEmail.trim()]);
                                            setNewAdminEmail('');
                                        }
                                    }}
                                    className="px-5 py-3 rounded-2xl bg-[#1a27c9] text-white font-black text-sm hover:bg-[#0d0e0e] transition-all flex items-center gap-1"
                                >
                                    <Plus size={18} />
                                    <span>Add</span>
                                </button>
                            </div>
                            <div className="space-y-2">
                                {mentorAdminEmails.length === 0 ? (
                                    <p className="text-slate-400 text-xs font-bold italic py-2">لا توجد إيميلات مسؤولي مينتورنج مضافة حالياً</p>
                                ) : (
                                    mentorAdminEmails.map((email, index) => (
                                        <div key={index} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                                            <span className="text-sm font-bold text-slate-700">{email}</span>
                                            <button
                                                type="button"
                                                onClick={() => setMentorAdminEmails(prev => prev.filter(e => e !== email))}
                                                className="text-rose-500 hover:text-rose-700 transition-colors p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Mentor CC Emails */}
                        <div className="space-y-4 pt-2 border-t border-slate-100">
                            <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Mentor CC Emails (نسخة كربونية CC)</h3>
                            <p className="text-xs text-slate-500 font-medium">عناوين البريد الإلكتروني الإضافية لاستقبال نسخة CC من إشعارات حجوزات المينتورز.</p>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={newCcEmail}
                                    onChange={(e) => setNewCcEmail(e.target.value)}
                                    placeholder="coordinator@example.com"
                                    className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter' && newCcEmail.trim() && !mentorCcEmails.includes(newCcEmail.trim())) {
                                            e.preventDefault();
                                            setMentorCcEmails(prev => [...prev, newCcEmail.trim()]);
                                            setNewCcEmail('');
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (newCcEmail.trim() && !mentorCcEmails.includes(newCcEmail.trim())) {
                                            setMentorCcEmails(prev => [...prev, newCcEmail.trim()]);
                                            setNewCcEmail('');
                                        }
                                    }}
                                    className="px-5 py-3 rounded-2xl bg-[#1a27c9] text-white font-black text-sm hover:bg-[#0d0e0e] transition-all flex items-center gap-1"
                                >
                                    <Plus size={18} />
                                    <span>Add</span>
                                </button>
                            </div>
                            <div className="space-y-2">
                                {mentorCcEmails.length === 0 ? (
                                    <p className="text-slate-400 text-xs font-bold italic py-2">لا توجد إيميلات CC مضافة حالياً</p>
                                ) : (
                                    mentorCcEmails.map((email, index) => (
                                        <div key={index} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                                            <span className="text-sm font-bold text-slate-700">{email}</span>
                                            <button
                                                type="button"
                                                onClick={() => setMentorCcEmails(prev => prev.filter(e => e !== email))}
                                                className="text-rose-500 hover:text-rose-700 transition-colors p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Mentor Email Template */}
                        <div className="space-y-4 pt-2 border-t border-slate-100">
                            <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Mentor Booking Notification Template</h3>
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Subject (عنوان الإيميل)</label>
                                <input
                                    type="text"
                                    value={mentorEmailTemplateSubject}
                                    onChange={(e) => setMentorEmailTemplateSubject(e.target.value)}
                                    placeholder="New Mentor Session Booking: {{company_name}} with {{mentor_name}}"
                                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Body (محتوى الإيميل)</label>
                                <RichTextEditor
                                    value={mentorEmailTemplateBody}
                                    onChange={setMentorEmailTemplateBody}
                                    placeholder="Write your mentor notification email body here..."
                                    minHeight="180px"
                                />
                            </div>
                            <p className="text-xs text-slate-400 font-medium">
                                المتغيرات المتاحة: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#1a27c9] font-bold">{'{{company_name}}'}</code> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#1a27c9] font-bold">{'{{mentor_name}}'}</code> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#1a27c9] font-bold">{'{{booker_email}}'}</code> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#1a27c9] font-bold">{'{{start_time}}'}</code> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#1a27c9] font-bold">{'{{meet_link}}'}</code>
                            </p>
                        </div>

                        {/* Save Action */}
                        <div className="pt-4 border-t border-slate-100 flex justify-end">
                            <button
                                type="button"
                                disabled={savingSettings}
                                onClick={handleSaveNotificationSettings}
                                className="bg-[#1a27c9] text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium flex items-center gap-2 disabled:opacity-50"
                            >
                                {savingSettings ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Saving Settings...</span>
                                    </>
                                ) : (
                                    <>
                                        <Save size={16} />
                                        <span>Save Notification Settings</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Toast Notification */}
            {toast.show && (
                <div className={`fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl transition-all duration-300 ${toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>
                    <CheckCircle size={20} />
                    <span className="font-bold text-sm">{toast.message}</span>
                </div>
            )}

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

            {/* Add Slot Modal */}
            {showAddSlot && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 pointer-events-auto" onClick={() => setShowAddSlot(false)} />
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 p-8 relative z-[101] pointer-events-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-2xl font-black text-[#0d0e0e] tracking-tight">Add New Slots</h3>
                            </div>
                            <button
                                onClick={() => setShowAddSlot(false)}
                                className="p-4 hover:bg-slate-50 rounded-2xl text-slate-400 transition-premium"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleCreateSlot} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mentor</label>
                                <select
                                    value={newSlot.mentor_id}
                                    onChange={(e) => setNewSlot({ ...newSlot, mentor_id: e.target.value })}
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                >
                                    <option value="">Select a mentor</option>
                                    {mentors.map((mentor) => (
                                        <option key={mentor.id} value={mentor.id}>{mentor.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Date</label>
                                <input
                                    type="date"
                                    value={newSlot.date}
                                    onChange={(e) => setNewSlot({ ...newSlot, date: e.target.value })}
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Start Time</label>
                                <input
                                    type="time"
                                    value={newSlot.start_time}
                                    onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Slot Duration (Minutes)</label>
                                <input
                                    type="number"
                                    value={newSlot.slot_duration}
                                    onChange={(e) => setNewSlot({ ...newSlot, slot_duration: parseInt(e.target.value) || 30 })}
                                    min="5"
                                    step="5"
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Break Time Between Slots (Minutes)</label>
                                <input
                                    type="number"
                                    value={newSlot.break_time}
                                    onChange={(e) => setNewSlot({ ...newSlot, break_time: parseInt(e.target.value) || 0 })}
                                    min="0"
                                    step="5"
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Number of Slots</label>
                                <input
                                    type="number"
                                    value={newSlot.num_slots}
                                    onChange={(e) => setNewSlot({ ...newSlot, num_slots: parseInt(e.target.value) || 1 })}
                                    min="1"
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
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
                                        className="flex-1 px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                    />
                                    <button
                                        type="button"
                                        disabled={generatingMeetLink || !newSlot.date || !newSlot.start_time}
                                        onClick={async () => {
                                            if (!newSlot.date || !newSlot.start_time) {
                                                alert('Please select date and start time first.');
                                                return;
                                            }

                                            // Calculate start and end dates
                                            const startTimeStr = `${newSlot.date}T${newSlot.start_time}:00`;
                                            const startTime = new Date(startTimeStr);
                                            const endTime = new Date(startTime.getTime() + newSlot.slot_duration * 60000);

                                            const link = await generateMeetLink(
                                                startTime.toISOString(),
                                                endTime.toISOString(),
                                                null
                                            );

                                            if (link) {
                                                setNewSlot({ ...newSlot, meet_link: link });
                                            }
                                        }}
                                        className="px-4 py-4 bg-white border-2 border-slate-100 text-[#1a27c9] hover:border-[#1a27c9] hover:bg-[#1a27c9]/5 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    Create Slots
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
