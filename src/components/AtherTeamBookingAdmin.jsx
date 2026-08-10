import React, { useMemo, useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Calendar, Clock, Users, Copy, CheckCircle, ArrowLeft, Search, Loader2, Briefcase, X, Database, AlertTriangle, ExternalLink, Settings } from 'lucide-react';
import {
    getAtherTeamMembers,
    createAtherTeamMember,
    updateAtherTeamMember,
    deleteAtherTeamMember,
    getAtherTeamSlots,
    createAtherTeamSlot,
    updateAtherTeamSlot,
    deleteAtherTeamSlot,
    getAtherTeamBookings,
    deleteAtherTeamBooking,
    getEvent
} from '../lib/atherTeamBooking';
import { supabase } from '../lib/supabase';
import LazyImage from './LazyImage';

export default function AtherTeamBookingAdmin({ eventId: propEventId, isEmbedded = false }) {
    const params = useParams();
    const eventId = propEventId || params.eventId;
    const [members, setMembers] = useState([]);
    const [slots, setSlots] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('members');
    const [showAddMember, setShowAddMember] = useState(false);
    const [showAddSlot, setShowAddSlot] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [editingSlot, setEditingSlot] = useState(null);
    const [newMember, setNewMember] = useState({ name: '', email: '', photo_url: '', bio: '' });
    const [newSlot, setNewSlot] = useState({ 
        ather_team_member_id: '', 
        date: '', 
        start_time: '', 
        slot_duration: 30, 
        break_time: 5, 
        num_slots: 1,
        meet_link: ''
    });
    const [copied, setCopied] = useState(false);
    const [selectedSlotIds, setSelectedSlotIds] = useState([]);
    const [generatingMeetLink, setGeneratingMeetLink] = useState(false);

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
                    summary: 'Interview Meeting'
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
            const [membersData, slotsData, bookingsData, eventData] = await Promise.all([
                getAtherTeamMembers(eventId),
                getAtherTeamSlots(eventId),
                getAtherTeamBookings(eventId),
                getEvent(eventId)
            ]);
            setMembers(membersData);
            setSlots(slotsData);
            setBookings(bookingsData);
            setEvent(eventData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateMember = async (e) => {
        e.preventDefault();
        try {
            await createAtherTeamMember({ ...newMember, event_id: eventId });
            setNewMember({ name: '', email: '', photo_url: '', bio: '' });
            setShowAddMember(false);
            loadData();
        } catch (error) {
            alert('Error creating member: ' + error.message);
        }
    };

    const handleUpdateMember = async (e) => {
        e.preventDefault();
        try {
            await updateAtherTeamMember(editingMember.id, editingMember);
            setEditingMember(null);
            loadData();
        } catch (error) {
            alert('Error updating member: ' + error.message);
        }
    };

    const handleDeleteMember = async (id) => {
        if (!confirm('Are you sure you want to delete this team member?')) return;
        try {
            await deleteAtherTeamMember(id);
            loadData();
        } catch (error) {
            alert('Error deleting member: ' + error.message);
        }
    };

    const handleCreateSlot = async (e) => {
        e.preventDefault();
        try {
            const slotsToCreate = [];
            const { ather_team_member_id, date, start_time, slot_duration, break_time, num_slots, meet_link } = newSlot;
            
            // Parse start time
            const [hours, minutes] = start_time.split(':').map(Number);
            let currentStartTime = new Date(date);
            currentStartTime.setHours(hours, minutes, 0, 0);
            
            for (let i = 0; i < num_slots; i++) {
                const currentEndTime = new Date(currentStartTime);
                currentEndTime.setMinutes(currentEndTime.getMinutes() + slot_duration);
                
                slotsToCreate.push({
                    ather_team_member_id,
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
            await Promise.all(slotsToCreate.map(slot => createAtherTeamSlot(slot)));
            
            // Reset state
            setNewSlot({ 
                ather_team_member_id: '', 
                date: '', 
                start_time: '', 
                slot_duration: 30, 
                break_time: 5, 
                num_slots: 1,
                meet_link: ''
            });
            setShowAddSlot(false);
            loadData();
        } catch (error) {
            alert('Error creating slots: ' + error.message);
        }
    };

    const handleUpdateSlot = async (e) => {
        e.preventDefault();
        try {
            const updates = {
                start_time: editingSlot.start_time,
                end_time: editingSlot.end_time,
                is_available: editingSlot.is_available,
                meet_link: editingSlot.meet_link
            };
            await updateAtherTeamSlot(editingSlot.id, updates);
            setEditingSlot(null);
            loadData();
        } catch (error) {
            alert('Error updating slot: ' + error.message);
        }
    };

    const handleDeleteSlot = async (id) => {
        if (!confirm('Are you sure you want to delete this slot?')) return;
        try {
            await deleteAtherTeamSlot(id);
            loadData();
        } catch (error) {
            alert('Error deleting slot: ' + error.message);
        }
    };

    const handleDeleteBooking = async (id) => {
        if (!confirm('Are you sure you want to cancel this booking?')) return;
        try {
            await deleteAtherTeamBooking(id);
            loadData();
        } catch (error) {
            alert('Error canceling booking: ' + error.message);
        }
    };

    const copyBookingLink = (memberId) => {
        const link = `${window.location.origin}${window.location.pathname}#/ather-team-book/${memberId}`;
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
            await Promise.all(selectedSlotIds.map(id => deleteAtherTeamSlot(id)));
            setSelectedSlotIds([]);
            loadData();
        } catch (error) {
            alert('Error deleting slots: ' + error.message);
        }
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
        <div className={isEmbedded ? "font-manrope" : "min-h-screen bg-gray-200 font-manrope"}>
            <div className={isEmbedded ? "" : "max-w-7xl mx-auto p-6"}>
                {!isEmbedded && (
                    <div className="mb-8">
                        <Link to={`/event/${eventId}`} className="flex items-center gap-2 text-slate-400 hover:text-[#1a27c9] mb-4 transition-premium">
                            <ArrowLeft size={18} />
                            <span className="font-bold">Back to Event</span>
                        </Link>
                        <h1 className="text-3xl font-black text-[#0d0e0e] mb-2 tracking-tight">Ather Team Booking Admin</h1>
                        <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">Manage Ather Team members, slots, and bookings</p>
                    </div>
                )}

                {/* Tabs */}
                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 mb-6 overflow-hidden">
                    <div className="flex border-b border-slate-100">
                        <button
                            onClick={() => setActiveTab('members')}
                            className={`flex items-center gap-3 px-8 py-6 font-black text-xs uppercase tracking-widest transition-premium ${
                                activeTab === 'members'
                                    ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Users size={20} />
                            Team Members
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
                    </div>
                </div>

                {/* Members Tab */}
                {activeTab === 'members' && (
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-xl font-black text-[#0d0e0e]">Team Members</h2>
                            <button
                                onClick={() => setShowAddMember(true)}
                                className="flex items-center gap-3 bg-[#1a27c9] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium group active:scale-95"
                            >
                                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-500" />
                                Add Member
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {members.map((member) => (
                                <div
                                    key={member.id}
                                    className="bg-slate-50 rounded-[2.5rem] border border-slate-100 p-6 hover:shadow-xl hover:bg-white transition-premium block"
                                >
                                    {editingMember?.id === member.id ? (
                                        <form onSubmit={(e) => { e.preventDefault(); handleUpdateMember(e); }} className="space-y-4">
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Name</label>
                                                <input
                                                    type="text"
                                                    value={editingMember.name}
                                                    onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
                                                <input
                                                    type="email"
                                                    value={editingMember.email}
                                                    onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Photo URL</label>
                                                <input
                                                    type="text"
                                                    value={editingMember.photo_url || ''}
                                                    onChange={(e) => setEditingMember({ ...editingMember, photo_url: e.target.value })}
                                                    className="w-full px-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Bio</label>
                                                <textarea
                                                    value={editingMember.bio || ''}
                                                    onChange={(e) => setEditingMember({ ...editingMember, bio: e.target.value })}
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
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingMember(null); }}
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
                                                            src={member.photo_url}
                                                            alt={member.name}
                                                            objectFit="cover"
                                                            className="w-full h-full"
                                                            fallback={
                                                                <div className="w-full h-full flex items-center justify-center bg-[#1a27c9]/5 text-[#1a27c9] font-black text-2xl">
                                                                    {member.name.charAt(0)}
                                                                </div>
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-black text-lg text-[#0d0e0e] uppercase leading-tight truncate mb-1">{member.name}</h4>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate mb-2">{member.email}</p>
                                                        {member.bio && (
                                                            <p className="text-sm font-bold text-slate-500 leading-relaxed italic">{member.bio}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-3 mt-6">
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyBookingLink(member.id); }}
                                                    className="flex-1 flex items-center justify-center gap-2 bg-white border-2 border-slate-100 text-[#0d0e0e] hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium py-4 rounded-2xl font-black text-xs uppercase tracking-widest"
                                                >
                                                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                                                    {copied ? 'Copied!' : 'Copy Link'}
                                                </button>
                                                <a
                                                    href={`#/ather-team-book/${member.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => { e.stopPropagation(); }}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <ExternalLink size={18} />
                                                </a>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingMember(member); }}
                                                    className="p-4 bg-white border-2 border-slate-100 text-slate-400 hover:border-[#1a27c9] hover:text-[#1a27c9] hover:shadow-lg transition-premium rounded-2xl"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteMember(member.id); }}
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
                                        ather_team_member_id: '', 
                                        date: '', 
                                        start_time: '', 
                                        slot_duration: 30, 
                                        break_time: 5, 
                                        num_slots: 1 
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
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Team Member</th>
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
                                                <span className="font-bold text-[#0d0e0e]">{slot.ather_team_members?.name || 'Unknown'}</span>
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
                                        <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Team Member</th>
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
                                                <span className="text-slate-500 font-bold">{booking.ather_team_members?.name}</span>
                                            </td>
                                            <td className="py-5 px-6">
                                                <span className="text-slate-500 font-bold">
                                                    {new Date(booking.ather_team_slots?.start_time).toLocaleString()}
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
            </div>

            {/* Add Member Modal */}
            {showAddMember && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 pointer-events-auto" onClick={() => setShowAddMember(false)} />
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 p-8 relative z-[101] pointer-events-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-2xl font-black text-[#0d0e0e] tracking-tight">Add New Team Member</h3>
                            </div>
                            <button
                                onClick={() => setShowAddMember(false)}
                                className="p-4 hover:bg-slate-50 rounded-2xl text-slate-400 transition-premium"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleCreateMember} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Name</label>
                                <input
                                    type="text"
                                    value={newMember.name}
                                    onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                                    placeholder="Team Member Name"
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Email</label>
                                <input
                                    type="email"
                                    value={newMember.email}
                                    onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                                    placeholder="team@ather.com"
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Photo URL</label>
                                <input
                                    type="text"
                                    value={newMember.photo_url}
                                    onChange={(e) => setNewMember({ ...newMember, photo_url: e.target.value })}
                                    placeholder="https://example.com/photo.jpg"
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Bio</label>
                                <textarea
                                    value={newMember.bio}
                                    onChange={(e) => setNewMember({ ...newMember, bio: e.target.value })}
                                    placeholder="Short bio about the team member"
                                    rows={3}
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium resize-none"
                                />
                            </div>
                            <button
                                type="submit"
                                className="w-full bg-[#1a27c9] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium"
                            >
                                Add Member
                            </button>
                        </form>
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
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Team Member</label>
                                <select
                                    value={newSlot.ather_team_member_id}
                                    onChange={(e) => setNewSlot({ ...newSlot, ather_team_member_id: e.target.value })}
                                    required
                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-[#0d0e0e] focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                >
                                    <option value="">Select a team member</option>
                                    {members.map((member) => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
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
                            <button
                                type="submit"
                                className="w-full bg-[#1a27c9] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl hover:shadow-indigo-200 transition-premium"
                            >
                                {newSlot.num_slots > 1 ? `Add ${newSlot.num_slots} Slots` : 'Add Slot'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
