import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Upload, Calendar, Clock, User, Save, ExternalLink, Edit2, UserCheck, UserX, Copy, Check, FileSpreadsheet, Download, UploadCloud, Loader2, AlertTriangle, AlertCircle, X, List, GripVertical, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
    getEventDays,
    getAgendaSlots,
    createDay,
    createSlot,
    updateSlot,
    updateDay,
    deleteDay,
    deleteSlot,
    updateEvent,
    getEvent,
    uploadImage,
    importAgendaData,
    syncEventFromCloud
} from '../lib/api';
import { formatDate, formatTime, getGoogleDriveDirectLink } from '../lib/utils';
import { generateAgendaTemplate, parseAgendaExcel, fetchAndParseGoogleSheet } from '../lib/excel';
import { updateSlotsOrder } from '../lib/api';

// DnD Kit Imports
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Sortable Slot Component
function SortableSlot({ slot, onEdit, onDelete, onTogglePresenter, isInvalid }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: slot.slot_id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group/slot flex flex-col md:flex-row md:items-center justify-between p-2.5 md:p-5 bg-white border rounded-2xl gap-2 md:gap-6 hover:border-[#1a27c9] transition-premium shadow-sm hover:shadow-lg hover:shadow-indigo-50/50 
                ${isDragging ? 'shadow-2xl border-[#1a27c9] scale-[1.02]' : ''}
                ${isInvalid ? 'border-red-500 shadow-lg shadow-red-50 ring-1 ring-red-500/20 bg-red-50/5' : 'border-slate-100'}
            `}
        >
            <div className="flex-1 flex flex-col md:flex-row gap-1.5 md:gap-6 w-full">
                {/* Mobile Top Bar: Drag Handle + Actions */}
                <div className="flex items-center justify-between w-full md:hidden">
                    <div 
                        {...attributes} 
                        {...listeners} 
                        className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-slate-300 hover:text-slate-500 transition-colors shrink-0"
                    >
                        <GripVertical size={16} />
                    </div>
                    <div className="flex items-center gap-1 opacity-80 group-hover/slot:opacity-100 transition-opacity">
                        {slot.presenter_name && (
                            <button
                                onClick={() => onTogglePresenter(slot)}
                                className={`p-1.5 rounded-lg transition-premium border active:scale-95 ${slot.show_presenter
                                    ? 'text-emerald-600 bg-emerald-50 border-emerald-100'
                                    : 'text-slate-400 bg-slate-50 border-slate-100'
                                    }`}
                            >
                                {slot.show_presenter ? <UserCheck size={13} /> : <UserX size={13} />}
                            </button>
                        )}
                        <button
                            onClick={() => onEdit(slot)}
                            className="p-1.5 text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-premium active:scale-95"
                        >
                            <Edit2 size={13} />
                        </button>
                        <button
                            onClick={() => onDelete(slot.slot_id)}
                            className="p-1.5 text-red-500 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-premium active:scale-95"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>

                {/* Desktop Drag Handle */}
                <div 
                    {...attributes} 
                    {...listeners} 
                    className="hidden md:block cursor-grab active:cursor-grabbing p-2 -ml-2 text-slate-300 hover:text-slate-500 transition-colors shrink-0 self-center"
                >
                    <GripVertical size={20} />
                </div>

                {/* Slot Details (Time next to Title on Mobile) */}
                <div className="flex items-center gap-2 md:gap-4 w-full min-w-0">
                    {/* Time Indicator */}
                    <div className="flex items-center gap-1.5 md:gap-3 text-[#1a27c9] min-w-[105px] md:min-w-[160px] bg-indigo-50/50 px-2 py-1 md:px-4 md:py-2.5 rounded-lg md:rounded-xl font-black text-[10px] md:text-sm shrink-0">
                        <Clock size={11} className="md:w-4 md:h-4" />
                        <span className="whitespace-nowrap">
                            {formatTime(slot.start_time)} — {formatTime(slot.end_time)}
                        </span>
                    </div>

                    {/* Slot Content */}
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] md:text-lg font-extrabold text-[#0d0e0e] leading-tight md:mb-1 truncate md:whitespace-normal">{slot.slot_title}</p>
                        {slot.bullet_points?.length > 0 && (
                            <div className="hidden md:flex items-center gap-1.5 mt-1">
                                <List size={12} className="text-indigo-400" />
                                <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest">{slot.bullet_points.length} نقطة</span>
                            </div>
                        )}
                        {slot.presenter_name && (
                            <div className="hidden md:flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">
                                <User size={14} className="text-[#1a27c9]" />
                                <span>{slot.presenter_name}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Desktop Actions */}
            <div className="hidden md:flex items-center gap-2 w-full md:w-auto justify-end opacity-60 group-hover/slot:opacity-100 transition-opacity">
                {slot.presenter_name && (
                    <button
                        onClick={() => onTogglePresenter(slot)}
                        className={`p-2.5 rounded-xl transition-premium border active:scale-95 ${slot.show_presenter
                            ? 'text-emerald-600 bg-emerald-50 border-emerald-100 hover:bg-emerald-100'
                            : 'text-slate-400 bg-slate-50 border-slate-100 hover:bg-slate-100'
                            }`}
                        title={slot.show_presenter ? 'Hide Speaker' : 'Show Speaker'}
                    >
                        {slot.show_presenter ? <UserCheck size={20} /> : <UserX size={20} />}
                    </button>
                )}
                <button
                    onClick={() => onEdit(slot)}
                    className="p-2.5 text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-premium active:scale-95"
                    title="Edit Details"
                >
                    <Edit2 size={20} />
                </button>
                <button
                    onClick={() => onDelete(slot.slot_id)}
                    className="p-2.5 text-red-500 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-premium active:scale-95"
                    title="Remove Slot"
                >
                    <Trash2 size={20} />
                </button>
            </div>
        </div>
    );
}

export default function EventBuilder({ event, onBack }) {
    const [days, setDays] = useState([]);
    const [slots, setSlots] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('days');
    const [isSubmittingDay, setIsSubmittingDay] = useState(false);

    const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
        const hours = Math.floor(i / 2).toString().padStart(2, '0');
        const minutes = (i % 2 === 0 ? '00' : '30');
        return `${hours}:${minutes}`;
    });

    // ─── AM/PM Time helpers ───────────────────────────────────────────────────
    // Convert 24h "HH:MM" → { display: "H:MM", period: "AM"|"PM" }
    function to12h(time24) {
        if (!time24 || !time24.includes(':')) return { display: '', period: 'AM' };
        let [h, m] = time24.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        if (h === 0) h = 12;
        else if (h > 12) h -= 12;
        return { display: `${h}:${String(m).padStart(2, '0')}`, period };
    }
    // Convert 12h input + period → "HH:MM" (24h)
    function to24h(display, period) {
        if (!display || !display.includes(':')) return '';
        let [h, m] = display.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return '';
        if (period === 'AM') { if (h === 12) h = 0; }
        else { if (h !== 12) h += 12; }
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // Native time input — browser handles AM/PM display + arrow spinners
    function TimeAmPmInput({ value, onChange, id }) {
        return (
            <input
                id={id}
                type="time"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-slate-700 text-lg tracking-wide cursor-pointer"
            />
        );
    }

    // Form states
    const [newDayName, setNewDayName] = useState('');
    const [newDayNameAr, setNewDayNameAr] = useState('');
    const [newDayDate, setNewDayDate] = useState('');
    const [_selectedDay, setSelectedDay] = useState(null);
    const [_dayError, setDayError] = useState(false);

    const [slotModal, setSlotModal] = useState({
        show: false,
        isEditing: false,
        slotId: null,
        dayId: null,
        startTime: '09:00',
        endTime: '10:00',
        title: '',
        titleAr: '',
        presenter: '',
        presenterAr: '',
        bulletPoints: [],
        bulletPointsAr: [],
        saving: false
    });
    const [eventDetails, setEventDetails] = useState(event);


    // Day Editing State
    const [editingDayId, setEditingDayId] = useState(null);
    const [editDayName, setEditDayName] = useState('');
    const [editDayNameAr, setEditDayNameAr] = useState('');
    const [editDayDate, setEditDayDate] = useState('');

    const [isUploading, setIsUploading] = useState(false);
    const [coverImageUrl, setCoverImageUrl] = useState(event?.header_image_url || '');
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const [coverSaved, setCoverSaved] = useState(false);
    const [_isSyncing, setIsSyncing] = useState(false);
    const [_gsheetsUrl, setGsheetsUrl] = useState('');
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [syncReport, setSyncReport] = useState(null);
    const [syncError, setSyncError] = useState(null);
    const [showDayNames, setShowDayNames] = useState(event?.show_day_names !== false);
    const [isSavingVisuals, setIsSavingVisuals] = useState(false);

    // Staging and Validation States
    const [stableState, setStableState] = useState(null);
    const [pendingDeletions, setPendingDeletions] = useState([]);
    const [pendingDayDeletions, setPendingDayDeletions] = useState([]);
    const [invalidSlotIds, setInvalidSlotIds] = useState(new Set());

    // Header / Visual Settings State
    const [headerSettings, setHeaderSettings] = useState({
        visible: true,
        type: 'image',
        color: '#1a27c9',
        showTitle: false,
        titleDescription: '',
        titleColor: '#ffffff',
        overlayOpacity: 0.3,
        fontFamily: 'manrope',
        titleSize: '2rem',
        titleWeight: '800',
        contentSize: '1rem',
        contentWeight: '600',
    });
    const [imageUrls, setImageUrls] = useState({
        header: event?.header_image_url || '',
        height: '400px',
    });
    
    // Helper to normalize and serialize the state for robust comparison
    // This handles discrepancies like "09:00:00" (from API) vs "09:00" (local update)
    const serializeState = (days, slots, showDayNames) => {
        const normalizeTime = (t) => {
            if (!t) return '';
            // Only take HH:mm parts and ensure padding
            const parts = t.split(':');
            if (parts.length < 2) return t;
            return parts.slice(0, 2).map(p => p.padStart(2, '0')).join(':');
        };

        // Normalize days: pick only fields that affect the data, sort for stability
        const nDays = (days || []).map(d => ({
            day_name: (d.day_name || '').trim(),
            day_name_ar: (d.day_name_ar || '').trim(),
            day_date: d.day_date,
            day_number: Number(d.day_number)
        }));

        // Normalize slots: sort days by ID, then slots within day by properties
        const nSlots = {};
        const dayIds = Object.keys(slots || {}).sort();
        
        dayIds.forEach(id => {
            nSlots[id] = (slots[id] || []).map(s => ({
                start_time: normalizeTime(s.start_time),
                end_time: normalizeTime(s.end_time),
                slot_title: (s.slot_title || '').trim(),
                slot_title_ar: (s.slot_title_ar || '').trim(),
                presenter_name: (s.presenter_name || '').trim(),
                presenter_name_ar: (s.presenter_name_ar || '').trim(),
                show_presenter: !!s.show_presenter,
                bullet_points: (s.bullet_points || []).map(b => b.trim()).filter(Boolean),
                bullet_points_ar: (s.bullet_points_ar || []).map(b => b.trim()).filter(Boolean)
            }));
        });

        return JSON.stringify({
            days: nDays,
            slots: nSlots,
            showDayNames: !!showDayNames
        });
    };

    // Computed property: Automatically detect if anything has changed from the last saved state
    const hasUnsavedChanges = useMemo(() => {
        if (!stableState) return false;
        
        // Use the same serialization logic to compare current with stable
        const current = serializeState(days, slots, showDayNames);
        return current !== stableState;
    }, [days, slots, showDayNames, stableState]);

    const changeSummary = useMemo(() => {
        if (!hasUnsavedChanges) return null;
        
        const newDaysCount = days.filter(d => d.isOptimistic).length;
        const deletedDaysCount = pendingDayDeletions.length;
        const deletedSlotsCount = pendingDeletions.length;
        
        const parts = [];
        if (newDaysCount > 0) parts.push(`${newDaysCount} أيام جديدة`);
        if (deletedDaysCount > 0) parts.push(`${deletedDaysCount} أيام محذوفة`);
        if (deletedSlotsCount > 0) parts.push(`${deletedSlotsCount} فقرات محذوفة`);
        
        return parts.length > 0 ? parts.join('، ') : 'تعديلات بالمسودة';
    }, [hasUnsavedChanges, days, pendingDayDeletions, pendingDeletions]);

    // Custom UI Dialogs State
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const [confirmState, setConfirmState] = useState({ show: false, message: '', onConfirm: null });

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
    };

    const askConfirm = (message, onConfirm) => {
        setConfirmState({ show: true, message, onConfirm });
    };

    const handleCoverUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setIsUploadingCover(true);
            const publicUrl = await uploadImage(file, 'visuals');
            setCoverImageUrl(publicUrl);
            await updateEvent(event.event_id, { header_image_url: publicUrl });
            setCoverSaved(true);
            setTimeout(() => setCoverSaved(false), 3000);
        } catch (err) {
            console.error('Cover upload failed:', err);
            alert('فشل رفع الصورة. حاول مرة تانية.');
        } finally {
            setIsUploadingCover(false);
        }
    };

    const handleRemoveCover = async () => {
        try {
            setCoverImageUrl('');
            await updateEvent(event.event_id, { header_image_url: '' });
        } catch (err) {
            console.error('Remove cover failed:', err);
        }
    };

    const handleImageUpload = async (e, type) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setIsUploading(true);
            const publicUrl = await uploadImage(file, 'visuals');
            setImageUrls(prev => ({ ...prev, [type]: publicUrl }));
        } catch (err) {
            console.error('Image upload failed:', err);
            alert('فشل رفع الصورة. حاول مرة تانية.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveImages = async () => {
        try {
            setIsSavingVisuals(true);
            await updateEvent(event.event_id, {
                header_image_url: imageUrls.header,
                header_settings: headerSettings,
                header_height: imageUrls.height,
                show_day_names: showDayNames
            });
            showToast('Visual settings saved! 🎨');
        } catch (err) {
            console.error('Save images failed:', err);
            showToast('Failed to save visual settings.', 'error');
        } finally {
            setIsSavingVisuals(false);
        }
    };


    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setIsUploading(true);
            const data = await parseAgendaExcel(file);
            await importAgendaData(event.event_id, data);
            showToast('تم استيراد البيانات بنجاح! 🚀');
            loadEventData(); // Refresh UI
        } catch (error) {
            console.error('Import failed:', error);
            showToast(`فشل الاستيراد: ${error.message}`, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleGoogleSheetSync = async () => {
        if (!eventDetails?.gsheets_url) {
            setSyncError({ message: 'يرجى ضبط رابط Google Sheet من لوحة التحكم (Event Dashboard) أولاً.' });
            return;
        }

        try {
            setIsSyncing(true);
            setSyncReport(null);
            setSyncError(null);

            const data = await fetchAndParseGoogleSheet(eventDetails.gsheets_url);
            const result = await importAgendaData(event.event_id, data);

            setSyncReport(result.stats);
            setLastSyncTime(new Date().toLocaleTimeString());
            loadEventData();
        } catch (error) {
            console.error('GSheets Sync failed:', error);
            setSyncError(error);
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        loadEventData();

        // Load persisted URL from event details
        if (eventDetails?.gsheets_url) {
            setGsheetsUrl(eventDetails.gsheets_url);
        }
    }, [event.event_id, eventDetails?.gsheets_url]);

    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    const loadEventData = async (silent = false) => {
        try {
            if (!silent) setLoading(true);

            let currentEventData = eventDetails;
            // If we don't have full event details, fetch them
            if (!eventDetails.event_name) {
                const fullEvent = await getEvent(event.event_id);
                if (fullEvent) {
                    currentEventData = fullEvent;
                    setEventDetails(fullEvent);
                    setShowDayNames(fullEvent.show_day_names !== false);
                }
            } else {
                setShowDayNames(eventDetails.show_day_names !== false);
            }

            const daysData = await getEventDays(event.event_id);
            // Sort initial data by date
            const sortedDaysData = Array.isArray(daysData) 
                ? [...daysData].sort((a, b) => (a.day_date || '').localeCompare(b.day_date || ''))
                : [];
            setDays(sortedDaysData);

            // Load slots for all days in parallel
            if (sortedDaysData.length > 0) {
                const slotsPromises = sortedDaysData.map(day => getAgendaSlots(day.day_id));
                const allSlots = await Promise.all(slotsPromises);

                const slotsData = {};
                sortedDaysData.forEach((day, index) => {
                    slotsData[day.day_id] = allSlots[index] || [];
                });
                setSlots(slotsData);

                // Set initial stable state for comparison using our normalization helper
                const initialShowDayNames = currentEventData ? currentEventData.show_day_names !== false : true;
                setStableState(serializeState(sortedDaysData, slotsData, initialShowDayNames));
            } else {
                const initialShowDayNames = currentEventData ? currentEventData.show_day_names !== false : true;
                setStableState(serializeState([], {}, initialShowDayNames));
            }
        } catch (error) {
            console.error('Error loading event data:', error);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // Helper to re-index days by date to ensure sequential integrity
    const reorderDays = (daysArray) => {
        return [...daysArray]
            .sort((a, b) => (a.day_date || '').localeCompare(b.day_date || ''))
            .map((d, index) => ({ ...d, day_number: index + 1 }));
    };

    const handleAddDay = () => {
        const tempId = `day-temp-${Date.now()}`;
        const newDay = {
            day_id: tempId,
            day_name: newDayName.trim(),
            day_name_ar: newDayNameAr.trim(),
            day_date: newDayDate || new Date().toISOString().split('T')[0],
            day_number: days.length + 1,
            event_id: event.event_id,
            isOptimistic: true // Mark as new for handleFinalSave
        };

        setDays(prev => reorderDays([...prev, newDay]));
        setSlots(prev => ({ ...prev, [tempId]: [] }));
        
        // Clear inputs immediately
        setNewDayName('');
        setNewDayNameAr('');
        setNewDayDate(new Date().toISOString().split('T')[0]);
        setDayError(false);
        showToast('تم إضافة اليوم إلى المسودة');
    };

    const handleOpenSlotModal = (dayId) => {
        setSlotModal({
            show: true,
            isEditing: false,
            slotId: null,
            dayId,
            startTime: '09:00',
            endTime: '10:00',
            title: '',
            titleAr: '',
            presenter: '',
            presenterAr: '',
            bulletPoints: [],
            bulletPointsAr: [],
            saving: false
        });
    };

    const handleEditSlot = (slot) => {
        setSlotModal({
            show: true,
            isEditing: true,
            slotId: slot.slot_id,
            dayId: slot.day_id,
            startTime: slot.start_time,
            endTime: slot.end_time,
            title: slot.slot_title,
            titleAr: slot.slot_title_ar || '',
            presenter: slot.presenter_name || '',
            presenterAr: slot.presenter_name_ar || '',
            bulletPoints: slot.bullet_points || [],
            bulletPointsAr: slot.bullet_points_ar || [],
            saving: false
        });
    };

    const handleSaveSlot = async () => {
        const { dayId, startTime, endTime, title, titleAr, presenter, presenterAr, bulletPoints, bulletPointsAr, isEditing, slotId } = slotModal;
        if (!startTime || !endTime || !title) return;
        // Filter out empty bullet points before saving
        const cleanBullets = (bulletPoints || []).filter(b => b.trim() !== '');
        const cleanBulletsAr = (bulletPointsAr || []).filter(b => b.trim() !== '');

        // Store previous state for rollback (hoisted outside try for catch access)
        const previousSlots = { ...slots };
        try {
            // Calculate the new state for this day
            let newDaySlots;
            if (isEditing) {
                newDaySlots = previousSlots[dayId].map(s => s.slot_id === slotId ? {
                    ...s,
                    start_time: startTime,
                    end_time: endTime,
                    slot_title: title,
                    slot_title_ar: titleAr,
                    presenter_name: presenter,
                    presenter_name_ar: presenterAr,
                    bullet_points: cleanBullets,
                    bullet_points_ar: cleanBulletsAr
                } : s);
            } else {
                const tempId = `temp-${Date.now()}`;
                const newSlot = {
                    slot_id: tempId,
                    day_id: dayId,
                    start_time: startTime,
                    end_time: endTime,
                    slot_title: title,
                    slot_title_ar: titleAr,
                    presenter_name: presenter,
                    presenter_name_ar: presenterAr,
                    show_presenter: !!presenter || !!presenterAr,
                    bullet_points: cleanBullets,
                    bullet_points_ar: cleanBulletsAr,
                    isOptimistic: true
                };
                newDaySlots = [...(previousSlots[dayId] || []), newSlot].sort((a, b) => a.start_time.localeCompare(b.start_time));
            }

            // Apply state update
            setSlots(prev => ({
                ...prev,
                [dayId]: newDaySlots
            }));

            // Close modal immediately
            setSlotModal(prev => ({ ...prev, show: false, saving: false }));

            // Validate with the NEW slots to avoid stale state issues
            validateAgendaOrder(dayId, newDaySlots);
        } catch (error) {
            console.error('Error saving slot:', error);
            // Rollback on failure
            setSlots(previousSlots);
            showToast('حدث خطأ أثناء حفظ الفقرة. يرجى المحاولة مرة أخرى.', 'error');
        }
    };

    const handleDeleteDay = (dayId) => {
        askConfirm('متأكد إنك عايز تمسح اليوم ده؟ كل الفقرات اللي جواه هتتمسح.', async () => {
            // Track deletion if it's a real day (not temp)
            const dayToDelete = days.find(d => d.day_id === dayId);
            if (dayToDelete && !dayToDelete.isOptimistic) {
                setPendingDayDeletions(prev => [...prev, dayId]);
            }

            setDays(prev => {
                const filtered = prev.filter(day => day.day_id !== dayId);
                return reorderDays(filtered);
            });
            setSlots(prev => {
                const newSlots = { ...prev };
                delete newSlots[dayId];
                return newSlots;
            });

            showToast('تم حذف اليوم من المسودة (اضغط حفظ للتأكيد النهائي)');
        });
    };

    const handleDuplicateDay = (dayId) => {
        const sourceDay = days.find(d => d.day_id === dayId);
        if (!sourceDay) return;

        const tempDayId = `day-temp-${Date.now()}`;
        const newDayNumber = days.length + 1;
        const newDay = {
            ...sourceDay,
            day_id: tempDayId,
            day_name: sourceDay.day_name ? `${sourceDay.day_name} (Copy)` : '',
            day_name_ar: sourceDay.day_name_ar ? `${sourceDay.day_name_ar} (نسخة)` : '',
            day_number: newDayNumber,
            isOptimistic: true // Mark as new for handleFinalSave
        };

        const sourceSlots = slots[dayId] || [];
        const newSlots = sourceSlots.map((slot, index) => ({
            ...slot,
            slot_id: `temp-${Date.now()}-${index}`,
            day_id: tempDayId,
            isOptimistic: true
        }));

        setDays(prev => reorderDays([...prev, newDay]));
        setSlots(prev => ({ ...prev, [tempDayId]: newSlots }));
        
        showToast('تم تكرار اليوم بنجاح (اضغط حفظ للتأكيد النهائي)');
    };

    const handleDeleteSlot = (slotId) => {
        askConfirm('متأكد إنك عايز تمسح الفقرة دي؟', async () => {
            // Find slot to track deletion
            let deletedSlot = null;
            Object.values(slots).forEach(daySlots => {
                const found = daySlots.find(s => s.slot_id === slotId);
                if (found) deletedSlot = found;
            });

            if (deletedSlot && !deletedSlot.isOptimistic) {
                setPendingDeletions(prev => [...prev, slotId]);
            }

            setSlots(prev => {
                const newSlots = { ...prev };
                Object.keys(newSlots).forEach(dayId => {
                    newSlots[dayId] = newSlots[dayId].filter(slot => slot.slot_id !== slotId);
                });
                return newSlots;
            });

            showToast('تم حذف الفقرة من المسودة (اضغط حفظ للتأكيد النهائي)');
        });
    };


    const handleStartEditDay = (day) => {
        setEditingDayId(day.day_id);
        setEditDayName(day.day_name);
        setEditDayNameAr(day.day_name_ar || '');
        setEditDayDate(day.day_date);
    };

    const handleUpdateDay = () => {
        setDays(prev => {
            const updated = prev.map(d => 
                d.day_id === editingDayId 
                    ? { 
                        ...d, 
                        day_name: editDayName.trim(), 
                        day_name_ar: editDayNameAr.trim(), 
                        day_date: editDayDate 
                      } 
                    : d
            );
            return reorderDays(updated);
        });

        setEditingDayId(null);
        showToast('تم تحديث بيانات اليوم في المسودة');
    };

    const handleTogglePresenter = (slot) => {
        const newStatus = !slot.show_presenter;
        setSlots(prev => ({
            ...prev,
            [slot.day_id]: prev[slot.day_id].map(s => 
                s.slot_id === slot.slot_id ? { ...s, show_presenter: newStatus } : s
            )
        }));
    };

    const handleToggleDayNames = async () => {
        const newValue = !showDayNames;
        setShowDayNames(newValue);
        setEventDetails(prev => ({ ...prev, show_day_names: newValue }));
    };

    const shiftTimeString = (timeStr, shiftHours) => {
        if (!timeStr) return '00:00';
        let [hours, minutes] = timeStr.split(':').map(Number);
        hours += shiftHours;
        // Clamp to 00:00 - 23:59
        if (hours < 0) hours = 0;
        if (hours > 23) hours = 23;
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    };

    const handleShiftDayTime = (dayId, shiftHours) => {
        let newDaySlots = [];
        setSlots(prev => {
            const daySlots = prev[dayId] || [];
            newDaySlots = daySlots.map(slot => ({
                ...slot,
                start_time: shiftTimeString(slot.start_time, shiftHours),
                end_time: shiftTimeString(slot.end_time, shiftHours)
            }));
            
            return {
                ...prev,
                [dayId]: newDaySlots
            };
        });
        // We can call validateAgendaOrder immediately because it uses the passed array if provided
        validateAgendaOrder(dayId, newDaySlots);
        showToast(`تم ${shiftHours > 0 ? 'تقديم' : 'تأخير'} مواعيد اليوم بمقدار ساعة`);
    };

    const agendaUrl = `${window.location.href.split('#')[0].replace(/\/$/, '')}/#/agenda/${event.event_id}`;

    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(agendaUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Validation Helper
    const validateAgendaOrder = (dayId, updatedSlots = null) => {
        const currentSlots = updatedSlots || slots[dayId] || [];
        const newInvalidIds = new Set(invalidSlotIds);
        
        // Clear previous invalid IDs for THIS day's current slots
        const currentDaySlots = slots[dayId] || [];
        currentDaySlots.forEach(s => newInvalidIds.delete(s.slot_id));
        
        // Also clear invalid IDs for the updated slots being validated
        currentSlots.forEach(s => newInvalidIds.delete(s.slot_id));

        let isLogical = true;
        for (let i = 0; i < currentSlots.length - 1; i++) {
            const current = currentSlots[i];
            const next = currentSlots[i + 1];
            
            // Overlap or invalid sequence check
            // If current starts after next, OR current ends after next starts
            if (current.start_time > next.start_time || current.end_time > next.start_time) {
                isLogical = false;
                newInvalidIds.add(current.slot_id);
                newInvalidIds.add(next.slot_id);
            }
        }

        setInvalidSlotIds(newInvalidIds);
        return isLogical;
    };

    // DnD Sensors — include touch distance threshold for mobile
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // must drag 8px before activating (prevents accidental drags on tap)
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!active || !over || active.id === over.id) return;

        // Find which day this slot belongs to
        let targetDayId = null;
        Object.keys(slots).forEach(dayId => {
            if (slots[dayId].some(s => s.slot_id === active.id)) {
                targetDayId = dayId;
            }
        });

        if (!targetDayId) return;

        const daySlots = [...slots[targetDayId]];
        const oldIndex = daySlots.findIndex(s => s.slot_id === active.id);
        const newIndex = daySlots.findIndex(s => s.slot_id === over.id);

        const newDaySlots = arrayMove(daySlots, oldIndex, newIndex);

        // Update local state first
        setSlots(prev => ({
            ...prev,
            [targetDayId]: newDaySlots
        }));

        // Chronological Validation
        const isLogical = validateAgendaOrder(targetDayId, newDaySlots);

        if (!isLogical) {
            showToast('⚠️ الترتيب غير منطقي زمنياً! يرجى مراجعة الفقرات المحددة بالأحمر.', 'warning');
        }

        try {
            const updates = newDaySlots.map((slot, index) => ({
                ...slot,
                sort_order: index + 1
            }));
            
            const results = await updateSlotsOrder(updates);
            
            // Merge all returned slots from DB (both newly inserted and existing upserted)
            const allReturnedSlots = [
                ...(results.inserted || []),
                ...(results.upserted || [])
            ];

            if (allReturnedSlots.length > 0) {
                setSlots(prev => {
                    const currentDaySlots = [...(prev[targetDayId] || [])];
                    const updatedDaySlots = currentDaySlots.map(s => {
                        // Find matching returned slot from DB
                        // We match by slot_title and start_time as a heuristic for new slots,
                        // and by slot_id for existing ones.
                        const found = allReturnedSlots.find(returned => {
                            if (s.slot_id && !String(s.slot_id).startsWith('temp-')) {
                                return returned.slot_id === s.slot_id;
                            }
                            return returned.slot_title === s.slot_title && 
                                   returned.start_time === s.start_time;
                        });
                        
                        if (found) {
                            return { ...found, isOptimistic: false };
                        }
                        return s;
                    });
                    return { ...prev, [targetDayId]: updatedDaySlots };
                });

                // IMPORTANT: We don't call loadEventData(true) here to avoid wiping other unsaved changes.
                // However, the order is now persistent in the DB.
                showToast('تم تحديث الترتيب بنجاح');
            }
        } catch (error) {
            console.error('Error updating slots order:', error);
            showToast('فشل حفظ الترتيب الجديد', 'error');
            // Only reload on error to revert to last known good state
            loadEventData(true);
        }
    };

    const [isSavingChanges, setIsSavingChanges] = useState(false);

    const handleFinalSave = async () => {
        try {
            setIsSavingChanges(true);
            
            // 1. Handle Day Deletions
            if (pendingDayDeletions.length > 0) {
                console.log(`[Staging] Deleting ${pendingDayDeletions.length} days`);
                for (const id of pendingDayDeletions) {
                    await deleteDay(id);
                }
            }

            // 2. Handle Slot Deletions
            if (pendingDeletions.length > 0) {
                console.log(`[Staging] Deleting ${pendingDeletions.length} slots`);
                for (const id of pendingDeletions) {
                    await deleteSlot(id);
                }
            }

            // 3. Process Days and Slots
            // Re-index days to ensure sequence is correct (1, 2, 3...)
            const sortedDays = [...days].sort((a, b) => a.day_date.localeCompare(b.day_date));
            
            for (let i = 0; i < sortedDays.length; i++) {
                const day = sortedDays[i];
                const newDayNumber = i + 1;
                let currentDayId = day.day_id;
                
                if (day.isOptimistic) {
                    console.log(`[Staging] Creating new day: ${day.day_name}`);
                    const newDay = await createDay({
                        event_id: day.event_id,
                        day_name: day.day_name,
                        day_name_ar: day.day_name_ar,
                        day_date: day.day_date,
                        day_number: newDayNumber
                    });
                    currentDayId = newDay.day_id;
                } else {
                    // Update existing day properties and numbering
                    await updateDay(day.day_id, {
                        day_name: day.day_name,
                        day_name_ar: day.day_name_ar,
                        day_date: day.day_date,
                        day_number: newDayNumber
                    });
                }

                // Prepare slots for this day
                const daySlots = slots[day.day_id] || [];
                const slotsToUpsert = daySlots.map((slot, index) => {
                    const slotData = { 
                        ...slot, 
                        day_id: currentDayId, 
                        sort_order: index + 1 
                    };
                    
                    if (slot.isOptimistic || !slot.slot_id) {
                        delete slotData.slot_id;
                    }
                    
                    delete slotData.isOptimistic;
                    return slotData;
                });

                if (slotsToUpsert.length > 0) {
                    await updateSlotsOrder(slotsToUpsert);
                }
            }

            await updateEvent(event.event_id, {
                show_day_names: showDayNames
            });

            setPendingDeletions([]);
            setPendingDayDeletions([]);
            showToast('تم حفظ جميع التعديلات بنجاح! 🎉');
            loadEventData(true);
        } catch (error) {
            console.error('Final save failed:', error);
            showToast('فشل حفظ التعديلات النهائية.', 'error');
        } finally {
            setIsSavingChanges(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-manrope">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1a27c9]"></div>
                <p className="mt-4 text-slate-500 font-medium tracking-tight">Syncing Event Data...</p>
            </div>
        );
    }

    return (
        <>
            <div className="min-h-screen bg-gray-200 font-manrope antialiased">
                {/* Premium Header */}
                <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                    <div className="max-w-[1600] mx-auto px-4 sm:px-6 lg:px-8 py-4">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                            <div className="flex items-center gap-4 w-full md:w-auto">
                                <button
                                    onClick={() => {
                                        if (hasUnsavedChanges) {
                                            askConfirm('عندك تعديلات مش محفوظة، متأكد إنك عايز تخرج؟', onBack);
                                        } else {
                                            onBack();
                                        }
                                    }}
                                    className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-premium active:scale-95"
                                >
                                    <ArrowLeft size={24} />
                                </button>
                                <div className="min-w-0">
                                    <h1 className="text-xl md:text-2xl font-extrabold text-[#0d0e0e] tracking-tight truncate">
                                        {eventDetails.event_name || '...'}
                                    </h1>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-0.5">Event Orchestrator</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <button
                                    onClick={handleCopy}
                                    className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-premium border ${copied
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                    <span>{copied ? 'Link Copied' : 'Copy Link'}</span>
                                </button>
                                <a
                                    href={agendaUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-[#0d0e0e] text-white rounded-xl font-bold hover:bg-slate-800 transition-premium shadow-md active:scale-95"
                                >
                                    <ExternalLink size={18} />
                                    <span>Preview</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="bg-white border-b border-slate-200">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex gap-1">
                            <button
                                onClick={() => setActiveTab('days')}
                                className={`px-6 py-3.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${
                                    activeTab === 'days'
                                        ? 'border-[#1a27c9] text-[#1a27c9]'
                                        : 'border-transparent text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                Agenda Days
                            </button>
                            <button
                                onClick={() => setActiveTab('settings')}
                                className={`px-6 py-3.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${
                                    activeTab === 'settings'
                                        ? 'border-[#1a27c9] text-[#1a27c9]'
                                        : 'border-transparent text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                Visual Settings
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="max-w-7xl mx-auto px-4 py-8 pb-32">
                    {activeTab === 'days' && (
                        <div className="space-y-6">
                            {/* Save Changes Floating Bar */}
                            {hasUnsavedChanges && (
                                <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom-4 duration-500 safe-bottom">
                                    <div className="bg-[#0d0e0e] text-white px-4 sm:px-8 py-4 sm:py-5 mx-3 sm:mx-auto sm:max-w-3xl sm:rounded-[2.5rem] mb-3 sm:mb-8 shadow-2xl shadow-indigo-200/50 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 border border-white/10 backdrop-blur-xl rounded-2xl">
                                        <div className="flex items-center gap-3 sm:pr-8 sm:border-r sm:border-white/10">
                                            <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse shrink-0" />
                                            <div className="flex flex-col">
                                                <span className="font-bold text-sm tracking-tight">تعديلات غير محفوظة</span>
                                                {changeSummary && (
                                                    <span className="text-[10px] text-white/50 font-medium -mt-0.5">{changeSummary}</span>
                                                )}
                                            </div>
                                            {invalidSlotIds.size > 0 && (
                                                <div className="flex items-center gap-1.5 text-red-400 sm:hidden">
                                                    <AlertCircle size={14} />
                                                    <span className="text-xs font-bold">صلح الأخطاء أولاً</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-auto">
                                            <button
                                                onClick={() => {
                                                    askConfirm('متأكد إنك عايز تتجاهل كل التعديلات اللي عملتها؟', () => {
                                                        loadEventData(false);
                                                    });
                                                }}
                                                disabled={isSavingChanges}
                                                className="flex-1 sm:flex-none px-4 py-2.5 hover:bg-white/10 rounded-2xl font-bold text-sm transition-premium disabled:opacity-30 text-center"
                                            >
                                                تجاهل
                                            </button>
                                            <button
                                                onClick={handleFinalSave}
                                                disabled={isSavingChanges || invalidSlotIds.size > 0}
                                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-[#1a27c9] hover:bg-[#151e9c] text-white rounded-2xl font-black text-sm transition-premium shadow-xl shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSavingChanges ? (
                                                    <Loader2 size={18} className="animate-spin" />
                                                ) : (
                                                    <Save size={18} />
                                                )}
                                                <span>حفظ التعديلات</span>
                                            </button>
                                        </div>
                                        {invalidSlotIds.size > 0 && (
                                            <div className="hidden sm:flex pl-4 items-center gap-2 text-red-400">
                                                <AlertCircle size={18} />
                                                <span className="text-xs font-bold">صلح الأخطاء الزمنية أولاً</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Sync Error Display */}
                            {syncError && (
                                <div className="bg-amber-50 border border-amber-100 rounded-[2rem] p-8 shadow-sm mb-6 animate-in zoom-in-95 duration-300">
                                    <div className="flex items-start gap-5">
                                        <div className="bg-amber-500/10 p-3 rounded-2xl shrink-0">
                                            <AlertTriangle className="text-amber-600" size={28} />
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <h4 className="text-lg font-black text-[#0d0e0e] tracking-tight mb-1">تنبيه المزامنة</h4>
                                                <p className="text-sm font-bold text-amber-800/80 leading-relaxed">
                                                    {syncError.type === 'MISSING_COLUMNS'
                                                        ? `هناك أعمدة مفقودة في شيت "${syncError.sheetName}". يرجى التأكد من وجود الأعمدة التالية:`
                                                        : syncError.message.includes('fetch')
                                                            ? 'فشل الاتصال بالشيت. تأكد أن الرابط صحيح وأن الشيت متاح "للمشاهدة العامة" (Anyone with the link can view).'
                                                            : syncError.message}
                                                </p>
                                            </div>

                                            {syncError.type === 'MISSING_COLUMNS' && (
                                                <div className="flex flex-wrap gap-2">
                                                    {syncError.missing.map(col => (
                                                        <span key={col} className="px-4 py-1.5 bg-white border border-amber-200 rounded-xl text-[11px] font-black text-amber-700 uppercase tracking-wider shadow-sm">
                                                            {col === 'Day Name' ? 'اسم اليوم (Day Name)' :
                                                                col === 'Date' ? 'التاريخ (Date)' :
                                                                    col === 'Slot Title' ? 'عنوان الفقرة (Slot Title)' :
                                                                        col === 'Start Time' ? 'وقت البدء (Start Time)' :
                                                                            col === 'End Time' ? 'وقت الانتهاء (End Time)' :
                                                                                col === 'Company Name' ? 'اسم الشركة (Company Name)' : col}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="pt-2">
                                                <button
                                                    onClick={() => setSyncError(null)}
                                                    className="text-[10px] font-black uppercase tracking-widest text-[#1a27c9] hover:underline"
                                                >
                                                    تجاهل التنبيه
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Sync Status & Report */}
                            {(lastSyncTime || syncReport) && (
                                <div className="flex flex-wrap items-center gap-6 px-6 py-3 bg-white border border-slate-100 rounded-3xl shadow-sm mb-6 animate-in fade-in slide-in-from-top-2 duration-500">
                                    {lastSyncTime && (
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Sync:</span>
                                            <span className="text-[11px] font-bold text-slate-600">{lastSyncTime}</span>
                                        </div>
                                    )}
                                    {syncReport && (
                                        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-l border-slate-100 pl-6">
                                            {[
                                                { label: 'الاياّم', key: 'days' },
                                                { label: 'الجلسات', key: 'slots' },
                                                { label: 'الخبراء', key: 'experts' },
                                                { label: 'الشركات', key: 'companies' }
                                            ].map(category => (
                                                <div key={category.key} className="flex flex-col gap-1">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{category.label}</span>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-1" title="New">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            <span className="text-[11px] font-black text-emerald-600">+{syncReport[category.key].added}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1" title="Updated">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                            <span className="text-[11px] font-black text-blue-600">~{syncReport[category.key].updated}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1" title="Skipped">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                                            <span className="text-[11px] font-black text-slate-400">{syncReport[category.key].skipped}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Agenda Cover Image ── */}
                            <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                                <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5 border-b border-slate-100">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-indigo-50 p-2 sm:p-2.5 rounded-xl text-[#1a27c9]">
                                            <Upload size={18} />
                                        </div>
                                        <div>
                                            <h3 className="text-sm sm:text-base font-black text-[#0d0e0e]">Agenda Cover</h3>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider hidden sm:block">صورة الكوفر في صفحة الأجندة</p>
                                        </div>
                                    </div>
                                    {coverSaved && (
                                        <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-black animate-in fade-in duration-300">
                                            <Check size={14} /> Saved!
                                        </span>
                                    )}
                                </div>
                                <div className="relative group aspect-[4/1] sm:aspect-[5/1] bg-slate-50 flex items-center justify-center overflow-hidden">
                                    {coverImageUrl ? (
                                        <>
                                            <img
                                                src={getGoogleDriveDirectLink(coverImageUrl)}
                                                className="w-full h-full object-cover"
                                                alt="Agenda cover"
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                                <label className="cursor-pointer bg-white text-[#0d0e0e] px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors">
                                                    Change
                                                    <input type="file" className="hidden" onChange={handleCoverUpload} accept="image/*" />
                                                </label>
                                                <button
                                                    onClick={handleRemoveCover}
                                                    className="bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-600 transition-colors"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <label className="cursor-pointer flex flex-col items-center gap-2 group/lbl">
                                            <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-slate-300 group-hover/lbl:text-[#1a27c9] group-hover/lbl:border-indigo-200 transition-colors">
                                                <Upload size={28} />
                                            </div>
                                            <span className="text-xs font-bold text-slate-400 group-hover/lbl:text-[#1a27c9] transition-colors">Click to upload agenda cover</span>
                                            <input type="file" className="hidden" onChange={handleCoverUpload} accept="image/*" />
                                        </label>
                                    )}
                                    {isUploadingCover && (
                                        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                                            <Loader2 className="animate-spin text-[#1a27c9]" size={36} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Agenda Layout Controls - Side by Side on Mobile */}
                            <div className="grid grid-cols-2 gap-3 sm:gap-6 mb-6">
                                {/* Agenda Display Settings Card */}
                                <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-8 shadow-sm">
                                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 sm:gap-6">
                                        <div className="flex items-center gap-3 sm:gap-4">
                                            <div className="bg-indigo-50 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-[#1a27c9]">
                                                <Settings size={18} className="sm:w-[22px] sm:h-[22px]" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm sm:text-lg font-black text-[#0d0e0e] leading-tight">إعدادات العرض</h3>
                                                <p className="hidden sm:block text-xs text-slate-400 font-bold uppercase tracking-wider mt-0.5">Settings</p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-3 p-3 sm:p-4 bg-slate-50 rounded-xl sm:rounded-2xl border border-slate-100">
                                            <div className="flex-1">
                                                <p className="font-bold text-[10px] sm:text-sm text-[#0d0e0e] whitespace-nowrap">إظهار أسماء الأيام</p>
                                                <p className="hidden sm:block text-[10px] text-slate-400 font-medium leading-none mt-1">Show custom day names</p>
                                            </div>
                                            <button
                                                onClick={handleToggleDayNames}
                                                className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-colors focus:outline-none ${showDayNames ? 'bg-[#1a27c9]' : 'bg-slate-300'}`}
                                            >
                                                <span
                                                    className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white transition-transform ${showDayNames ? 'translate-x-4 sm:translate-x-6' : 'translate-x-1'}`}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Add Day Card - Optimized Form */}
                                <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-8 shadow-sm">
                                    <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                                        <div className="bg-indigo-50 p-2 rounded-lg sm:rounded-xl">
                                            <Calendar className="text-[#1a27c9] w-4 h-4 sm:w-5 sm:h-5" />
                                        </div>
                                        <h3 className="text-sm sm:text-xl font-extrabold text-[#0d0e0e] leading-tight">Add Day</h3>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <div className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    value={newDayName}
                                                    onChange={(e) => {
                                                        setNewDayName(e.target.value);
                                                    }}
                                                    placeholder="Day Label (EN) - Optional"
                                                    className={`w-full px-4 sm:px-5 py-2.5 sm:py-3.5 bg-slate-50 border rounded-xl sm:rounded-2xl text-xs sm:text-base font-medium placeholder-slate-400 focus:outline-none focus:ring-2 transition-premium border-slate-100 focus:ring-[#1a27c9] focus:bg-white`}
                                                />
                                            </div>
                                            <div className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    value={newDayNameAr}
                                                    onChange={(e) => setNewDayNameAr(e.target.value)}
                                                    placeholder="اسم اليوم (AR) - اختياري"
                                                    dir="rtl"
                                                    className="w-full px-4 sm:px-5 py-2.5 sm:py-3.5 bg-slate-50 border border-slate-100 rounded-xl sm:rounded-2xl text-xs sm:text-base font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                                            <input
                                                type="date"
                                                value={newDayDate}
                                                onChange={(e) => setNewDayDate(e.target.value)}
                                                className="w-full sm:flex-1 px-4 sm:px-5 py-2.5 sm:py-3.5 bg-slate-50 border border-slate-100 rounded-xl sm:rounded-2xl text-xs sm:text-base font-medium focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium min-w-0"
                                            />
                                            <button
                                                onClick={handleAddDay}
                                                disabled={isSubmittingDay}
                                                className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3.5 bg-[#1a27c9] text-white rounded-xl sm:rounded-2xl font-extrabold hover:bg-[#1a27c9]/90 shadow-lg shadow-indigo-100 transition-premium flex items-center justify-center gap-2 group disabled:opacity-50 active:scale-95 text-xs sm:text-base"
                                            >
                                                {isSubmittingDay ? (
                                                    <div className="animate-spin h-4 w-4 sm:h-5 sm:w-5 border-2 border-white border-t-transparent rounded-full" />
                                                ) : (
                                                    <>
                                                        <Plus size={16} className="sm:w-5 sm:h-5 group-hover:rotate-90 transition-transform" />
                                                        <span>Add</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Days List */}
                            {days.map((day) => (
                                <div key={day.day_id} className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-premium">
                                    <div className="p-3 sm:p-6 border-b border-slate-100 flex flex-row items-center justify-between gap-2 sm:gap-4 bg-slate-50/50">
                                        {editingDayId === day.day_id ? (
                                            <div className="flex flex-col md:flex-row flex-1 gap-3 md:items-center min-w-0">
                                                <div className="flex flex-col gap-2 w-full">
                                                    <input
                                                        type="text"
                                                        value={editDayName}
                                                        onChange={(e) => setEditDayName(e.target.value)}
                                                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm sm:text-lg font-bold focus:ring-[#1a27c9] outline-none w-full"
                                                        placeholder="Day Label (EN)"
                                                        autoFocus
                                                    />
                                                    <input
                                                        type="text"
                                                        value={editDayNameAr}
                                                        onChange={(e) => setEditDayNameAr(e.target.value)}
                                                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm sm:text-lg font-bold focus:ring-[#1a27c9] outline-none w-full text-right"
                                                        placeholder="اسم اليوم (AR)"
                                                        dir="rtl"
                                                    />
                                                </div>
                                                <input
                                                    type="date"
                                                    value={editDayDate.split('T')[0]}
                                                    onChange={(e) => setEditDayDate(e.target.value)}
                                                    className="bg-white border border-slate-200 rounded-xl px-4 py-2 outline-none text-sm w-full"
                                                />
                                                <div className="flex gap-2 shrink-0">
                                                    <button
                                                        onClick={handleUpdateDay}
                                                        className="p-2 sm:p-2.5 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors"
                                                    >
                                                        <Save size={18} className="sm:w-5 sm:h-5" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingDayId(null)}
                                                        className="p-2 sm:p-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                                                    >
                                                        <X size={18} className="sm:w-5 sm:h-5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                                                <div className="bg-[#1a27c9] text-white h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl flex items-center justify-center font-black text-sm sm:text-xl shadow-lg shadow-indigo-100 shrink-0">
                                                    {day.day_number || '?'}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <h3 className="text-sm sm:text-2xl font-black text-[#0d0e0e] truncate">{day.day_name}</h3>
                                                        <button
                                                            onClick={() => handleStartEditDay(day)}
                                                            className="text-slate-300 hover:text-[#1a27c9] transition-premium shrink-0"
                                                            title="Rename Day"
                                                        >
                                                            <Edit2 size={12} className="sm:w-4 sm:h-4" />
                                                        </button>
                                                    </div>
                                                    <p className="text-slate-500 font-bold text-[8px] sm:text-xs uppercase tracking-widest truncate">{formatDate(day.day_date)}</p>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                            {/* +1 / -1 Buttons */}
                                            <div className="flex items-center bg-slate-200/50 rounded-lg sm:rounded-xl p-0.5 sm:p-1">
                                                <button
                                                    onClick={() => handleShiftDayTime(day.day_id, -1)}
                                                    className="px-2 py-1 sm:px-4 sm:py-2 text-slate-600 font-bold text-[9px] sm:text-sm hover:bg-white rounded-md sm:rounded-lg transition-premium"
                                                    title="Delay one hour"
                                                >
                                                    -1
                                                </button>
                                                <div className="w-px h-3 sm:h-4 bg-slate-300 mx-0.5 sm:mx-1"></div>
                                                <button
                                                    onClick={() => handleShiftDayTime(day.day_id, 1)}
                                                    className="px-2 py-1 sm:px-4 sm:py-2 text-slate-600 font-bold text-[9px] sm:text-sm hover:bg-white rounded-md sm:rounded-lg transition-premium"
                                                    title="Forward one hour"
                                                >
                                                    +1
                                                </button>
                                            </div>

                                            <button
                                                onClick={() => handleOpenSlotModal(day.day_id)}
                                                className="px-2 py-1.5 sm:px-5 sm:py-2.5 bg-[#0d0e0e] text-white rounded-lg sm:rounded-xl font-bold hover:bg-slate-800 transition-premium flex items-center justify-center gap-1 sm:gap-2 active:scale-95 shadow-md"
                                            >
                                                <Plus size={12} className="sm:w-[18px] sm:h-[18px]" />
                                                <span className="text-[9px] sm:text-sm whitespace-nowrap">Add Slot</span>
                                            </button>
                                            <button
                                                onClick={() => handleDuplicateDay(day.day_id)}
                                                className="p-1.5 sm:px-3 sm:py-2.5 bg-indigo-50 text-indigo-500 border border-indigo-100 rounded-lg sm:rounded-xl hover:bg-indigo-100 transition-premium flex items-center gap-1.5"
                                                title="Duplicate Day"
                                            >
                                                <Copy size={13} className="sm:w-[20px] sm:h-[20px]" />
                                                <span className="hidden sm:inline text-sm font-bold">Duplicate</span>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteDay(day.day_id)}
                                                className="p-1.5 sm:px-3 sm:py-2.5 bg-red-50 text-red-500 border border-red-100 rounded-lg sm:rounded-xl hover:bg-red-100 transition-premium"
                                                title="Delete Day"
                                            >
                                                <Trash2 size={13} className="sm:w-[20px] sm:h-[20px]" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Slots List */}
                                    <div className="p-4">
                                        {slots[day.day_id]?.length > 0 ? (
                                            <DndContext
                                                sensors={sensors}
                                                collisionDetection={closestCenter}
                                                onDragEnd={handleDragEnd}
                                            >
                                                <SortableContext
                                                    items={slots[day.day_id].map(s => s.slot_id)}
                                                    strategy={verticalListSortingStrategy}
                                                >
                                                    <div className="space-y-3">
                                                        {slots[day.day_id].map((slot) => (
                                                            <SortableSlot
                                                                key={slot.slot_id}
                                                                slot={slot}
                                                                isInvalid={invalidSlotIds.has(slot.slot_id)}
                                                                onEdit={handleEditSlot}
                                                                onDelete={handleDeleteSlot}
                                                                onTogglePresenter={handleTogglePresenter}
                                                            />
                                                        ))}
                                                    </div>
                                                </SortableContext>
                                            </DndContext>
                                        ) : (
                                            <div className="py-12 flex flex-col items-center justify-center text-slate-300">
                                                <Clock size={40} className="mb-3 opacity-20" />
                                                <p className="text-sm font-bold uppercase tracking-widest">No slots scheduled yet</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {days.length === 0 && (
                                <div className="text-center py-16 text-gray-400">
                                    <Calendar size={64} className="mx-auto mb-4 opacity-30" />
                                    <p>Start by adding event days</p>
                                </div>
                            )}
                        </div>
                    )}


                    {activeTab === 'settings' && (
                        <div className="space-y-8 pb-20">
                            {/* Global Styles Header */}
                            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                                <div className="flex items-center justify-between mb-8">
                                    <div>
                                        <h3 className="text-2xl font-black text-[#0d0e0e]">Visual identity</h3>
                                        <p className="text-slate-500 font-medium">Configure your agenda branding and theme settings.</p>
                                    </div>
                                    <button
                                        onClick={handleSaveImages}
                                        disabled={isSavingVisuals}
                                        className="flex items-center gap-2 px-8 py-3.5 bg-[#1a27c9] text-white rounded-2xl font-extrabold hover:bg-[#1a27c9]/90 shadow-xl shadow-indigo-100 transition-premium active:scale-95 disabled:opacity-50"
                                    >
                                        {isSavingVisuals ? (
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        ) : (
                                            <Save size={20} />
                                        )}
                                        <span>{isSavingVisuals ? 'Saving...' : 'Save Changes'}</span>
                                    </button>
                                </div>

                                {/* Header Configuration Segment */}
                                <div className="space-y-8">
                                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-100">
                                                    <Edit2 size={18} className="text-[#1a27c9]" />
                                                </div>
                                                <h4 className="text-lg font-black text-[#0d0e0e]">Hero Section (Header)</h4>
                                            </div>
                                            <button
                                                onClick={() => setHeaderSettings(prev => ({ ...prev, visible: !prev.visible }))}
                                                className={`w-14 h-7 rounded-full transition-premium relative ${headerSettings.visible ? 'bg-[#1a27c9]' : 'bg-slate-300'}`}
                                            >
                                                <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${headerSettings.visible ? 'left-8' : 'left-1'} shadow-sm`} />
                                            </button>
                                        </div>

                                        {headerSettings.visible && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
                                                <div className="space-y-6">
                                                    <div>
                                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Cover Type</label>
                                                        <div className="flex gap-4 p-1.5 bg-white rounded-xl border border-slate-200">
                                                            <button
                                                                onClick={() => setHeaderSettings(prev => ({ ...prev, type: 'image' }))}
                                                                className={`flex-1 py-2 px-4 rounded-lg font-bold transition-premium ${headerSettings.type === 'image' ? 'bg-[#1a27c9] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                                                            >
                                                                Image
                                                            </button>
                                                            <button
                                                                onClick={() => setHeaderSettings(prev => ({ ...prev, type: 'color' }))}
                                                                className={`flex-1 py-2 px-4 rounded-lg font-bold transition-premium ${headerSettings.type === 'color' ? 'bg-[#1a27c9] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                                                            >
                                                                Solid Color
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {headerSettings.type === 'image' ? (
                                                        <div className="space-y-3">
                                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Cover Image Source</label>
                                                            <div className="flex flex-col sm:flex-row gap-4">
                                                                <div className="flex-1 relative">
                                                                    <input
                                                                        type="url"
                                                                        value={imageUrls.header}
                                                                        onChange={(e) => setImageUrls({ ...imageUrls, header: e.target.value })}
                                                                        placeholder="Paste Image URL"
                                                                        className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl font-medium focus:outline-none focus:ring-2 focus:ring-[#1a27c9] transition-premium"
                                                                    />
                                                                </div>
                                                                <div className="shrink-0">
                                                                    <label className="cursor-pointer flex items-center justify-center gap-2 px-6 py-3.5 bg-white border-2 border-dashed border-slate-200 rounded-2xl font-bold text-slate-500 hover:border-[#1a27c9] hover:text-[#1a27c9] transition-premium group h-full">
                                                                        <input
                                                                            type="file"
                                                                            className="hidden"
                                                                            accept="image/*"
                                                                            onChange={(e) => handleImageUpload(e, 'header')}
                                                                            disabled={isUploading}
                                                                        />
                                                                        {isUploading ? (
                                                                            <div className="animate-spin h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full" />
                                                                        ) : (
                                                                            <>
                                                                                <Upload size={18} className="group-hover:scale-110 transition-transform" />
                                                                                <span>Upload Cover</span>
                                                                            </>
                                                                        )}
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Pick Color</label>
                                                            <div className="flex items-center gap-4 bg-white p-3 rounded-2xl border border-slate-200">
                                                                <input
                                                                    type="color"
                                                                    value={headerSettings.color}
                                                                    onChange={(e) => setHeaderSettings(prev => ({ ...prev, color: e.target.value }))}
                                                                    className="h-10 w-20 rounded-xl cursor-pointer border-0 p-0"
                                                                />
                                                                <span className="font-bold text-slate-600 uppercase tracking-wider">{headerSettings.color}</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div>
                                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Section Height</label>
                                                        <input
                                                            type="text"
                                                            value={imageUrls.height}
                                                            onChange={(e) => setImageUrls({ ...imageUrls, height: e.target.value })}
                                                            placeholder="e.g. 400px"
                                                            className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl font-medium focus:outline-none focus:ring-2 focus:ring-[#1a27c9] transition-premium"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-6">
                                                    {/* Text Overlay Segment */}
                                                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                                                        <div className="flex items-center justify-between mb-6">
                                                            <label className="text-sm font-black text-[#0d0e0e] uppercase tracking-wider">Overlay Title</label>
                                                            <button
                                                                onClick={() => setHeaderSettings(prev => ({ ...prev, showTitle: !prev.showTitle }))}
                                                                className={`w-12 h-6 rounded-full transition-premium relative ${headerSettings.showTitle ? 'bg-[#1a27c9]' : 'bg-slate-200'}`}
                                                            >
                                                                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${headerSettings.showTitle ? 'left-7' : 'left-1'} shadow-sm`} />
                                                            </button>
                                                        </div>

                                                        {headerSettings.showTitle && (
                                                            <div className="space-y-4 animate-fadeIn">
                                                                <input
                                                                    type="text"
                                                                    value={headerSettings.titleDescription}
                                                                    onChange={(e) => setHeaderSettings(prev => ({ ...prev, titleDescription: e.target.value }))}
                                                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a27c9]/10 focus:bg-white transition-premium"
                                                                    placeholder="Subtitle or brief description..."
                                                                />
                                                                <div className="flex items-center gap-4">
                                                                    <input
                                                                        type="color"
                                                                        value={headerSettings.titleColor}
                                                                        onChange={(e) => setHeaderSettings(prev => ({ ...prev, titleColor: e.target.value }))}
                                                                        className="h-10 w-16 rounded-xl cursor-pointer border-0 p-0"
                                                                    />
                                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Title Color</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {headerSettings.type === 'image' && (
                                                        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
                                                            <label className="block text-xs font-black text-[#1a27c9] uppercase tracking-[0.2em] mb-4">Background Dimming</label>
                                                            <div className="flex items-center gap-6">
                                                                <input
                                                                    type="range"
                                                                    min="0"
                                                                    max="0.9"
                                                                    step="0.1"
                                                                    value={headerSettings.overlayOpacity}
                                                                    onChange={(e) => setHeaderSettings(prev => ({ ...prev, overlayOpacity: e.target.value }))}
                                                                    className="flex-1 accent-[#1a27c9]"
                                                                />
                                                                <div className="bg-white p-2 rounded-lg border border-indigo-100 min-w-[3rem] text-center font-black text-indigo-600 text-xs">
                                                                    {Math.round(headerSettings.overlayOpacity * 100)}%
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                                        <div>
                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Event Branding Name</label>
                                            <input
                                                type="text"
                                                value={eventDetails.event_name}
                                                onChange={(e) => setEventDetails({ ...eventDetails, event_name: e.target.value })}
                                                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-extrabold text-xl text-[#0d0e0e] focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium"
                                                placeholder="Brand Name"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Typography & Tone</label>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                                                {[
                                                    { id: 'font-manrope', name: 'Manrope', class: 'font-manrope' },
                                                    { id: 'font-hepta', name: 'Hepta Slab', class: 'font-hepta' },
                                                    { id: 'font-jomhuria', name: 'Jomhuria', class: 'font-jomhuria text-xl' },
                                                ].map(f => (
                                                    <button
                                                        key={f.id}
                                                        onClick={() => setHeaderSettings(prev => ({ ...prev, fontFamily: f.id }))}
                                                        className={`p-4 border-2 rounded-2xl transition-premium text-center flex flex-col items-center justify-center gap-1 ${headerSettings.fontFamily === f.id
                                                            ? 'border-[#1a27c9] bg-indigo-50/50 text-[#1a27c9] shadow-inner'
                                                            : 'border-slate-100 hover:border-slate-300 text-slate-400 hover:text-slate-600 bg-white'}`}
                                                    >
                                                        <span className={`${f.class} text-lg font-bold`}>Aa</span>
                                                        <span className="text-[10px] font-black uppercase tracking-wider">{f.name}</span>
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Typography Details */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
                                                <div className="p-6 bg-white rounded-2xl border border-slate-200">
                                                    <h5 className="text-sm font-black text-[#0d0e0e] uppercase tracking-wider mb-4">Header Title Style</h5>
                                                    <div className="space-y-4">
                                                        <div>
                                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Size</label>
                                                            <input
                                                                type="text"
                                                                value={headerSettings.titleSize}
                                                                onChange={(e) => setHeaderSettings(prev => ({ ...prev, titleSize: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#1a27c9]/10 focus:bg-white transition-premium outline-none"
                                                                placeholder="e.g. 3rem"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Weight</label>
                                                            <select
                                                                value={headerSettings.titleWeight}
                                                                onChange={(e) => setHeaderSettings(prev => ({ ...prev, titleWeight: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#1a27c9]/10 focus:bg-white transition-premium outline-none appearance-none"
                                                            >
                                                                <option value="100">Thin (100)</option>
                                                                <option value="200">Extra Light (200)</option>
                                                                <option value="300">Light (300)</option>
                                                                <option value="400">Regular (400)</option>
                                                                <option value="500">Medium (500)</option>
                                                                <option value="600">Semi Bold (600)</option>
                                                                <option value="700">Bold (700)</option>
                                                                <option value="800">Extra Bold (800)</option>
                                                                <option value="900">Black (900)</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="p-6 bg-white rounded-2xl border border-slate-200">
                                                    <h5 className="text-sm font-black text-[#0d0e0e] uppercase tracking-wider mb-4">Content Typography</h5>
                                                    <div className="space-y-4">
                                                        <div>
                                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Size</label>
                                                            <input
                                                                type="text"
                                                                value={headerSettings.contentSize}
                                                                onChange={(e) => setHeaderSettings(prev => ({ ...prev, contentSize: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#1a27c9]/10 focus:bg-white transition-premium outline-none"
                                                                placeholder="e.g. 1rem"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Weight</label>
                                                            <select
                                                                value={headerSettings.contentWeight}
                                                                onChange={(e) => setHeaderSettings(prev => ({ ...prev, contentWeight: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#1a27c9]/10 focus:bg-white transition-premium outline-none appearance-none"
                                                            >
                                                                <option value="100">Thin (100)</option>
                                                                <option value="200">Extra Light (200)</option>
                                                                <option value="300">Light (300)</option>
                                                                <option value="400">Regular (400)</option>
                                                                <option value="500">Medium (500)</option>
                                                                <option value="600">Semi Bold (600)</option>
                                                                <option value="700">Bold (700)</option>
                                                                <option value="800">Extra Bold (800)</option>
                                                                <option value="900">Black (900)</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Slot Addition/Edit Modal */}
                {slotModal.show && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 font-manrope">
                        <div className="bg-white rounded-t-3xl sm:rounded-[2.5rem] w-full sm:max-w-xl p-5 sm:p-10 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto flex flex-col">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="bg-indigo-50 p-3 rounded-2xl">
                                    <Plus size={24} className="text-[#1a27c9]" />
                                </div>
                                <h3 className="text-3xl font-black text-[#0d0e0e] tracking-tight">
                                    {slotModal.isEditing ? 'Pulse Edit Slot' : 'Create New Pulse'}
                                </h3>
                            </div>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 xs:grid-cols-2 gap-4 sm:gap-6">
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Start Time</label>
                                        <TimeAmPmInput
                                            id="slot-start-time"
                                            value={slotModal.startTime}
                                            onChange={(v) => setSlotModal({ ...slotModal, startTime: v })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">End Time</label>
                                        <TimeAmPmInput
                                            id="slot-end-time"
                                            value={slotModal.endTime}
                                            onChange={(v) => setSlotModal({ ...slotModal, endTime: v })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Session Title (EN)</label>
                                        <input
                                            type="text"
                                            value={slotModal.title}
                                            onChange={(e) => setSlotModal({ ...slotModal, title: e.target.value })}
                                            placeholder="Headline of this slot..."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-lg text-[#0d0e0e]"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1 text-right">عنوان الفقرة (AR)</label>
                                        <input
                                            type="text"
                                            value={slotModal.titleAr}
                                            onChange={(e) => setSlotModal({ ...slotModal, titleAr: e.target.value })}
                                            placeholder="عنوان الفقرة بالعربي..."
                                            dir="rtl"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-lg text-[#0d0e0e] text-right"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Narrator / Lead (EN)</label>
                                        <input
                                            type="text"
                                            value={slotModal.presenter}
                                            onChange={(e) => setSlotModal({ ...slotModal, presenter: e.target.value })}
                                            placeholder="Full name or team..."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-slate-600"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1 text-right">المتحدث / القائم بالفقرة (AR)</label>
                                        <input
                                            type="text"
                                            value={slotModal.presenterAr}
                                            onChange={(e) => setSlotModal({ ...slotModal, presenterAr: e.target.value })}
                                            placeholder="الاسم الكامل أو الفريق..."
                                            dir="rtl"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-slate-600 text-right"
                                        />
                                    </div>
                                </div>

                                {/* Bullet Points Section (EN) */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Sub-Topics / Bullet Points (EN)</label>
                                        <button
                                            type="button"
                                            onClick={() => setSlotModal(prev => ({ ...prev, bulletPoints: [...(prev.bulletPoints || []), ''] }))}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-[#1a27c9] rounded-xl text-xs font-black hover:bg-indigo-100 transition-colors"
                                        >
                                            <Plus size={14} />
                                            Add Point
                                        </button>
                                    </div>

                                    {slotModal.bulletPoints?.length > 0 && (
                                        <div className="space-y-2">
                                            {slotModal.bulletPoints.map((point, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-indigo-300 shrink-0" />
                                                    <input
                                                        type="text"
                                                        value={point}
                                                        onChange={(e) => {
                                                            const updated = [...slotModal.bulletPoints];
                                                            updated[index] = e.target.value;
                                                            setSlotModal(prev => ({ ...prev, bulletPoints: updated }));
                                                        }}
                                                        placeholder={`Point ${index + 1}...`}
                                                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-medium text-slate-700 text-sm"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const updated = slotModal.bulletPoints.filter((_, i) => i !== index);
                                                            setSlotModal(prev => ({ ...prev, bulletPoints: updated }));
                                                        }}
                                                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Bullet Points Section (AR) */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1 text-right w-full">نقاط فرعية / تفاصيل (AR)</label>
                                        <button
                                            type="button"
                                            onClick={() => setSlotModal(prev => ({ ...prev, bulletPointsAr: [...(prev.bulletPointsAr || []), ''] }))}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-[#1a27c9] rounded-xl text-xs font-black hover:bg-indigo-100 transition-colors shrink-0"
                                        >
                                            <Plus size={14} />
                                            إضافة نقطة
                                        </button>
                                    </div>

                                    {slotModal.bulletPointsAr?.length > 0 && (
                                        <div className="space-y-2" dir="rtl">
                                            {slotModal.bulletPointsAr.map((point, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-indigo-300 shrink-0" />
                                                    <input
                                                        type="text"
                                                        value={point}
                                                        onChange={(e) => {
                                                            const updated = [...slotModal.bulletPointsAr];
                                                            updated[index] = e.target.value;
                                                            setSlotModal(prev => ({ ...prev, bulletPointsAr: updated }));
                                                        }}
                                                        placeholder={`النقطة ${index + 1}...`}
                                                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-medium text-slate-700 text-sm text-right"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const updated = slotModal.bulletPointsAr.filter((_, i) => i !== index);
                                                            setSlotModal(prev => ({ ...prev, bulletPointsAr: updated }));
                                                        }}
                                                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 mt-8">
                                <button
                                    onClick={handleSaveSlot}
                                    disabled={slotModal.saving}
                                    className="flex-[2] px-6 py-4 bg-[#1a27c9] text-white rounded-2xl hover:bg-indigo-700 transition-premium font-black text-base sm:text-lg shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95"
                                >
                                    {slotModal.saving ? (
                                        <div className="animate-spin h-6 w-6 border-3 border-white border-t-transparent rounded-full" />
                                    ) : (
                                        <>
                                            <Save size={20} />
                                            <span>{slotModal.isEditing ? 'Update Pulse' : 'Save Pulse'}</span>
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => setSlotModal({ ...slotModal, show: false })}
                                    disabled={slotModal.saving}
                                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-premium font-bold active:scale-95"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Custom Confirmation Modal */}
            {
                confirmState.show && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fadeIn">
                        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmState({ show: false, message: '', onConfirm: null })} />
                        <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full relative z-10 shadow-2xl border border-white active:scale-[0.99] transition-transform">
                            <div className="flex flex-col items-center text-center">
                                <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mb-6 text-rose-500">
                                    <AlertTriangle size={36} />
                                </div>
                                <h3 className="text-xl font-black text-[#0d0e0e] mb-2 tracking-tight">تأكيد الإجراء</h3>
                                <p className="text-slate-500 font-bold mb-8 leading-relaxed">
                                    {confirmState.message}
                                </p>
                                <div className="flex gap-4 w-full">
                                    <button
                                        onClick={() => {
                                            confirmState.onConfirm();
                                            setConfirmState({ show: false, message: '', onConfirm: null });
                                        }}
                                        className="flex-1 px-6 py-4 bg-rose-600 text-white rounded-2xl font-black hover:bg-rose-700 transition-premium shadow-lg shadow-rose-200 active:scale-95"
                                    >
                                        تأكيد
                                    </button>
                                    <button
                                        onClick={() => setConfirmState({ show: false, message: '', onConfirm: null })}
                                        className="flex-1 px-6 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black hover:bg-slate-200 transition-premium active:scale-95"
                                    >
                                        تراجع
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Global Toast Notification */}
            {toast.show && (
                <div className={`fixed bottom-20 sm:bottom-8 left-4 right-4 sm:left-auto sm:right-8 sm:w-auto z-[110] flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl border animate-slideInRight ${toast.type === 'success' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-rose-600 text-white border-rose-500'}`}>
                    <div className="flex items-center gap-3">
                        {toast.type === 'success' ? <Check size={20} className="shrink-0" /> : <AlertTriangle size={20} className="shrink-0" />}
                        <span className="font-extrabold text-sm tracking-tight">{toast.message}</span>
                    </div>
                    <button
                        onClick={() => setToast(prev => ({ ...prev, show: false }))}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}
        </>
    );
}
