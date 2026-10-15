import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Calendar, Clock, Copy, CheckCircle, ArrowLeft, X, AlertTriangle, ExternalLink } from 'lucide-react';
import {
    getMentorById,
    getSlots,
    createSlot,
    updateSlot,
    deleteSlot,
    ADVANCE_NOTICE_OPTIONS,
    isSlotWithinNoticeWindow
} from '../lib/mentorBooking';
import LazyImage from './LazyImage';
import { getGoogleDriveFallbackUrls } from '../lib/utils';

export default function MentorDetails() {
    const { eventId, mentorId } = useParams();
    const [mentor, setMentor] = useState(null);
    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddSlot, setShowAddSlot] = useState(false);
    const [editingSlot, setEditingSlot] = useState(null);
    const [newSlot, setNewSlot] = useState({ start_time: '', end_time: '' });
    const [copied, setCopied] = useState(false);

    const loadData = async () => {
        try {
            setLoading(true);
            const [mentorData, slotsData] = await Promise.all([
                getMentorById(mentorId),
                getSlots(eventId, mentorId)
            ]);
            setMentor(mentorData);
            setSlots(slotsData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (eventId && mentorId) {
            loadData();
        }
    }, [eventId, mentorId]);

    const handleCreateSlot = async (e) => {
        e.preventDefault();
        try {
            await createSlot({
                ...newSlot,
                mentor_id: mentorId,
                event_id: eventId,
                is_available: true
            });
            setNewSlot({ start_time: '', end_time: '' });
            setShowAddSlot(false);
            loadData();
        } catch (error) {
            alert('Error creating slot: ' + error.message);
        }
    };

    const handleUpdateSlot = async (e) => {
        e.preventDefault();
        try {
            const updates = {
                start_time: editingSlot.start_time,
                end_time: editingSlot.end_time,
                is_available: editingSlot.is_available
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

    const copyBookingLink = () => {
        const link = `${window.location.origin}${window.location.pathname}#/book/${mentorId}`;
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const isNoticeExpired = (dateTime) => {
        if (!dateTime) return false;
        return isSlotWithinNoticeWindow(dateTime, mentor?.advance_notice_minutes ?? 1440);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-200 flex items-center justify-center p-6 font-manrope">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-[#1a27c9] rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-lg font-black text-slate-400 uppercase tracking-widest">Loading...</p>
                </div>
            </div>
        );
    }

    if (!mentor) {
        return (
            <div className="min-h-screen bg-gray-200 flex items-center justify-center p-6 font-manrope">
                <div className="text-center">
                    <p className="text-lg font-black text-slate-400 uppercase tracking-widest">Mentor not found</p>
                    <Link
                        to={`/event/${eventId}/mentor-booking`}
                        className="inline-block mt-4 text-[#1a27c9] font-bold hover:underline"
                    >
                        Back to mentor booking
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-200 font-manrope">
            <div className="max-w-4xl mx-auto p-6">
                <div className="mb-8">
                    <Link
                        to={`/event/${eventId}/mentor-booking`}
                        className="flex items-center gap-2 text-slate-400 hover:text-[#1a27c9] mb-4 transition-premium"
                    >
                        <ArrowLeft size={18} />
                        <span className="font-bold">Back to Mentor Booking</span>
                    </Link>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 mb-6">
                    <div className="flex flex-col md:flex-row items-center gap-8">
                        <div className="w-32 h-32 rounded-3xl overflow-hidden shadow-lg border-2 border-white shrink-0 bg-white">
                            <LazyImage
                                src={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url)[0] : null}
                                urls={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url) : []}
                                alt={mentor.name}
                                objectFit="cover"
                                className="w-full h-full"
                                fallback={
                                    <div className="w-full h-full flex items-center justify-center bg-[#1a27c9]/5 text-[#1a27c9] font-black text-5xl">
                                        {mentor.name.charAt(0)}
                                    </div>
                                }
                            />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                            <h1 className="text-3xl font-black text-[#0d0e0e] mb-2 tracking-tight">{mentor.name}</h1>
                            <p className="text-slate-400 font-bold tracking-widest text-xs uppercase mb-2">{mentor.email}</p>
                            <div className="flex items-center justify-center md:justify-start gap-2 mb-2 flex-wrap">
                                <span className="px-3 py-1 rounded-lg bg-indigo-50 text-[#1a27c9] text-[10px] font-black uppercase tracking-wider">
                                    Notice: {ADVANCE_NOTICE_OPTIONS.find(o => o.value === (mentor.advance_notice_minutes ?? 1440))?.label?.split('(')[0]?.trim() || `${mentor.advance_notice_minutes ?? 1440}m`}
                                </span>
                            </div>
                            {mentor.bio && <p className="text-slate-500 font-bold leading-relaxed italic">{mentor.bio}</p>}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={copyBookingLink}
                                className="flex items-center gap-2 bg-[#1a27c9] text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl transition-premium"
                            >
                                {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                                {copied ? 'Copied!' : 'Copy Booking Link'}
                            </button>
                            <a
                                href={`#/book/${mentorId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 bg-white border-2 border-[#1a27c9] text-[#1a27c9] px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#1a27c9]/5 transition-premium"
                            >
                                <ExternalLink size={18} />
                                Open in New Tab
                            </a>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
                    <div className="flex justify-between items-center mb-8">
                        <h2 className="text-xl font-black text-[#0d0e0e]">Available Slots</h2>
                        <button
                            onClick={() => setShowAddSlot(true)}
                            className="flex items-center gap-3 bg-[#1a27c9] text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl transition-premium"
                        >
                            <Plus size={18} />
                            Add Slot
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Start Time</th>
                                    <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">End Time</th>
                                    <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Available</th>
                                    <th className="text-left py-5 px-6 font-black text-[#0d0e0e] text-xs uppercase tracking-widest">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {slots.map((slot) => (
                                    <tr key={slot.id} className="border-b border-slate-50">
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
                                                <input
                                                    type="checkbox"
                                                    checked={editingSlot.is_available}
                                                    onChange={(e) => setEditingSlot({ ...editingSlot, is_available: e.target.checked })}
                                                    className="w-5 h-5"
                                                />
                                            ) : (() => {
                                                const isExpired = isSlotWithinNoticeWindow(slot.start_time, mentor?.advance_notice_minutes ?? 1440);
                                                const isEffectivelyAvailable = slot.is_available && !isExpired;
                                                return (
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                                            isEffectivelyAvailable
                                                                ? 'bg-emerald-100 text-emerald-700'
                                                                : 'bg-rose-100 text-rose-700'
                                                        }`}>
                                                            {isEffectivelyAvailable ? 'Yes' : 'No'}
                                                        </span>
                                                        {slot.is_available && isExpired && (
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
                                {slots.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="py-10 text-center text-slate-400 font-black text-xs uppercase tracking-widest">
                                            No slots yet. Add a slot to get started!
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

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

                        {isNoticeExpired(newSlot.start_time) && (
                            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-black text-amber-700 text-xs uppercase tracking-widest mb-1">Important Notice</p>
                                    <p className="text-amber-600 font-bold text-sm">
                                        Slots within {ADVANCE_NOTICE_OPTIONS.find(o => o.value === (mentor?.advance_notice_minutes ?? 1440))?.label?.split('(')[0]?.trim() || `${mentor?.advance_notice_minutes ?? 1440} minutes`} from now will NOT be visible to clients on the booking page.
                                    </p>
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleCreateSlot} className="space-y-6">
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
                                    className="flex-[2] px-8 py-5 bg-[#1a27c9] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-xl transition-premium"
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
