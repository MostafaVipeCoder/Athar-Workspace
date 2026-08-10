import { supabase } from './supabase';
import { notifyGoogleAppsScript } from './api';

// Fetch event details
export const getEvent = async (eventId) => {
    const { data, error } = await supabase
        .from('events')
        .select('event_name, admin_email, interview_admin_emails, interview_cc_emails')
        .eq('event_id', eventId)
        .single();
    if (error) throw error;
    return data;
};

/**
 * Mentor Booking Library
 * Handles all database operations for the mentor booking module
 */

// ------------------------------
// Mentors CRUD
// ------------------------------

export const getMentors = async (eventId) => {
    // Step 1: Fetch mentors
    const { data: mentors, error: mentorsError } = await supabase
        .from('mentors')
        .select('*')
        .eq('event_id', eventId)
        .order('name');
    if (mentorsError) throw mentorsError;
    
    // Step 2: If there are mentors with master_id, fetch master experts
    const masterIds = mentors.map(m => m.master_id).filter(Boolean);
    let masterExperts = [];
    if (masterIds.length > 0) {
        const { data, error: masterError } = await supabase
            .from('master_experts')
            .select('*')
            .in('id', masterIds);
        if (!masterError && data) {
            masterExperts = data;
        }
    }
    
    // Step 3: Create a map of master_id -> master_expert
    const masterMap = new Map(masterExperts.map(me => [me.id, me]));
    
    // Step 4: Merge data
    return mentors.map(mentor => ({
        ...mentor,
        photo_url: mentor.photo_url || (masterMap.get(mentor.master_id)?.photo_url)
    }));
};

export const getMentorById = async (id) => {
    const { data: mentor, error: mentorError } = await supabase
        .from('mentors')
        .select('*')
        .eq('id', id)
        .single();
    if (mentorError) throw mentorError;
    
    // If there's a master_id, fetch the master expert
    if (mentor.master_id) {
        const { data: master, error: masterError } = await supabase
            .from('master_experts')
            .select('*')
            .eq('id', mentor.master_id)
            .single();
        if (!masterError && master) {
            return {
                ...mentor,
                photo_url: mentor.photo_url || master.photo_url
            };
        }
    }
    
    return mentor;
};

export const createMentor = async (mentorData) => {
    const { data, error } = await supabase
        .from('mentors')
        .insert([mentorData])
        .select();
    if (error) throw error;
    return data[0];
};

export const updateMentor = async (id, updates) => {
    const { data, error } = await supabase
        .from('mentors')
        .update(updates)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
};

export const deleteMentor = async (id) => {
    const { error } = await supabase
        .from('mentors')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
};

// ------------------------------
// Slots CRUD
// ------------------------------

export const getSlots = async (eventId, mentorId = null) => {
    let query = supabase
        .from('mentor_slots')
        .select('*, mentors(*)')
        .eq('event_id', eventId)
        .order('start_time');
    
    if (mentorId) {
        query = query.eq('mentor_id', mentorId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const getAvailableSlots = async (eventId, mentorId = null) => {
    let query = supabase
        .from('mentor_slots')
        .select('*, mentors(*)')
        .eq('event_id', eventId)
        .eq('is_available', true)
        .gt('start_time', new Date().toISOString())
        .order('start_time');
    
    if (mentorId) {
        query = query.eq('mentor_id', mentorId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const createSlot = async (slotData) => {
    const { data, error } = await supabase
        .from('mentor_slots')
        .insert([slotData])
        .select();
    if (error) throw error;
    return data[0];
};

export const updateSlot = async (id, updates) => {
    const { data, error } = await supabase
        .from('mentor_slots')
        .update(updates)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
};

export const deleteSlot = async (id) => {
    const { error } = await supabase
        .from('mentor_slots')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
};

// ------------------------------
// Bookings CRUD
// ------------------------------

export const getBookings = async (eventId, mentorId = null) => {
    let query = supabase
        .from('bookings')
        .select('*, mentor_slots(*), mentors(*)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
    
    if (mentorId) {
        query = query.eq('mentor_id', mentorId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const createBooking = async (bookingData) => {
    // First, check if slot is still available
    const { data: slot, error: slotError } = await supabase
        .from('mentor_slots')
        .select('*, mentors(*)')
        .eq('id', bookingData.slot_id)
        .single();
    
    if (slotError) throw slotError;
    if (!slot.is_available) throw new Error('Slot is no longer available');

    // Create booking with start_time, end_time, mentor_name, mentor_email
    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert([{
            ...bookingData,
            start_time: slot.start_time,
            end_time: slot.end_time,
            mentor_name: slot.mentors.name,
            mentor_email: slot.mentors.email
        }])
        .select();
    
    if (bookingError) throw bookingError;

    // Mark slot as unavailable
    await updateSlot(bookingData.slot_id, { is_available: false });

    // Notify Google Apps Script to process the booking
    try {
      console.log('[Mentor Booking] Notifying Google Apps Script via Edge Function...');
      
      let result = null;
      let retries = 3;
      let lastError = null;
      
      while (retries > 0 && !result) {
        try {
          result = await notifyGoogleAppsScript(booking[0].id, false);
          
          if (result.success) {
            console.log('[Mentor Booking] Google Apps Script notified successfully.');
          } else {
            console.error('[Mentor Booking] Google Apps Script returned error:', result.error);
          }
        } catch (notificationError) {
          lastError = notificationError;
          retries--;
          console.error(`[Mentor Booking] Error (retries left: ${retries}):`, notificationError);
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (!result && lastError) {
        console.error('[Mentor Booking] Final Error: Failed to notify Google Apps Script after retries:', lastError);
      }
    } catch (notificationError) {
      console.error('[Mentor Booking] Failed to notify Google Apps Script:', notificationError);
    }

    return booking[0];
};

export const deleteBooking = async (id) => {
    // First, get the booking to find the slot
    const { data: booking, error: getError } = await supabase
        .from('bookings')
        .select('slot_id')
        .eq('id', id)
        .single();
    
    if (getError) throw getError;

    // Delete booking
    const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', id);
    
    if (error) throw error;

    // Mark slot as available again
    await updateSlot(booking.slot_id, { is_available: true });

    return true;
};

// ------------------------------
// Day-by-Day Schedule Config
// ------------------------------

export const getMentorDayConfigs = async (eventId) => {
    const { data, error } = await supabase
        .from('mentor_day_config')
        .select('*')
        .eq('event_id', eventId)
        .order('day_number', { ascending: true });
    if (error) throw error;
    return data || [];
};

export const saveMentorDayConfig = async (config) => {
    const { id, event_id, day_number, day_date, session_start_time, session_end_time, slot_duration_minutes, break_between_slots_minutes } = config;
    const payload = {
        event_id,
        day_number,
        day_date: day_date || null,
        session_start_time,
        session_end_time,
        slot_duration_minutes,
        break_between_slots_minutes: break_between_slots_minutes ?? 0,
    };

    const { data, error } = await supabase
        .from('mentor_day_config')
        .upsert(payload, { onConflict: 'event_id,day_number' })
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const deleteMentorDayConfig = async (configId) => {
    const { error } = await supabase
        .from('mentor_day_config')
        .delete()
        .eq('id', configId);
    if (error) throw error;
    return true;
};

// ------------------------------
// Bulk Slots + Generation Engine
// ------------------------------

export const bulkCreateMentorSlots = async (slots) => {
    if (!slots || slots.length === 0) return [];
    const { data, error } = await supabase
        .from('mentor_slots')
        .insert(slots)
        .select();
    if (error) throw error;
    return data || [];
};

export const bulkDeleteMentorSlots = async (slotIds) => {
    if (!slotIds || slotIds.length === 0) return true;
    const { error } = await supabase
        .from('mentor_slots')
        .delete()
        .in('id', slotIds);
    if (error) throw error;
    return true;
};

const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
};

const minutesToTimeStr = (totalMinutes) => {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const combineDateAndTime = (dateStr, timeStr) => {
    const baseDate = new Date(dateStr + 'T00:00:00');
    const [hh, mm] = timeStr.split(':').map(Number);
    baseDate.setHours(hh, mm, 0, 0);
    return baseDate;
};

export const calculateDaySlotTimes = (config) => {
    const { session_start_time, session_end_time, slot_duration_minutes, break_between_slots_minutes = 0 } = config;

    const startMin = parseTimeToMinutes(session_start_time);
    const endMin = parseTimeToMinutes(session_end_time);

    const slots = [];
    if (endMin <= startMin || slot_duration_minutes <= 0) return slots;

    let cursor = startMin;
    while (cursor + slot_duration_minutes <= endMin) {
        const slotStartMin = cursor;
        const slotEndMin = cursor + slot_duration_minutes;
        slots.push({
            start_time: minutesToTimeStr(slotStartMin),
            end_time: minutesToTimeStr(slotEndMin),
            start_minutes: slotStartMin,
            end_minutes: slotEndMin,
        });
        cursor = slotEndMin + break_between_slots_minutes;
    }

    const totalMinutes = Math.max(0, endMin - startMin);
    return {
        slotTimes: slots,
        slotsCount: slots.length,
        totalMinutes,
        totalHours: (totalMinutes / 60).toFixed(1),
    };
};

export const buildMentorSlotsPayload = ({ config, mentorIds, eventId, dayDate = null }) => {
    if (!mentorIds || mentorIds.length === 0) return [];
    const { slotTimes } = calculateDaySlotTimes(config);
    const payload = [];

    for (const mentorId of mentorIds) {
        for (const slot of slotTimes) {
            let startISO;
            let endISO;
            if (dayDate) {
                startISO = combineDateAndTime(dayDate, slot.start_time).toISOString();
                endISO = combineDateAndTime(dayDate, slot.end_time).toISOString();
            } else {
                const today = new Date().toISOString().slice(0, 10);
                startISO = combineDateAndTime(today, slot.start_time).toISOString();
                endISO = combineDateAndTime(today, slot.end_time).toISOString();
            }
            payload.push({
                mentor_id: mentorId,
                event_id: eventId,
                start_time: startISO,
                end_time: endISO,
                is_available: true,
            });
        }
    }
    return payload;
};

export const detectMentorSlotConflicts = ({ existingSlots, newPayload, dayDate = null }) => {
    const conflicts = [];
    const existingByMentor = new Map();
    for (const s of existingSlots || []) {
        const mentorId = s.mentor_id;
        if (!existingByMentor.has(mentorId)) existingByMentor.set(mentorId, []);
        existingByMentor.get(mentorId).push(s);
    }

    for (const candidate of newPayload) {
        const mentorSlots = existingByMentor.get(candidate.mentor_id) || [];
        const candStart = new Date(candidate.start_time).getTime();
        const candEnd = new Date(candidate.end_time).getTime();
        for (const existing of mentorSlots) {
            const exStart = new Date(existing.start_time).getTime();
            const exEnd = new Date(existing.end_time).getTime();
            if (candStart < exEnd && candEnd > exStart) {
                conflicts.push({
                    mentor_id: candidate.mentor_id,
                    existing_slot_id: existing.id,
                    existing_start_time: existing.start_time,
                    existing_end_time: existing.end_time,
                    new_start_time: candidate.start_time,
                    new_end_time: candidate.end_time,
                    has_booking: !!existing.bookings || !existing.is_available ? true : false,
                });
            }
        }
    }
    return conflicts;
};

export const generateMentorSlotsForDay = async ({ config, mentorIds, eventId, dayDate = null, overwriteMode = 'skip' }) => {
    const { slotTimes } = calculateDaySlotTimes(config);
    if (slotTimes.length === 0) {
        throw new Error('No slots could be calculated: check start time, end time, and slot duration.');
    }
    if (!mentorIds || mentorIds.length === 0) {
        throw new Error('Please select at least one mentor before generating slots.');
    }

    const effectiveDate = dayDate || config.day_date;
    const existing = await getSlots(eventId);
    const payload = buildMentorSlotsPayload({ config, mentorIds, eventId, dayDate: effectiveDate });
    const conflicts = detectMentorSlotConflicts({ existingSlots: existing, newPayload: payload, dayDate: effectiveDate });

    let candidates = payload;

    if (overwriteMode === 'skip') {
        const conflictedSignatures = new Set(
            conflicts.map(c => `${c.mentor_id}|${c.new_start_time}|${c.new_end_time}`)
        );
        candidates = payload.filter(p => {
            const sig = `${p.mentor_id}|${p.start_time}|${p.end_time}`;
            return !conflictedSignatures.has(sig);
        });
    } else if (overwriteMode === 'replace_all_for_day') {
        const dayDateStart = effectiveDate ? new Date(effectiveDate + 'T00:00:00').getTime() : null;
        const dayDateEnd = effectiveDate ? new Date(effectiveDate + 'T23:59:59').getTime() : null;
        const slotIdsToDelete = [];
        for (const s of existing) {
            if (!mentorIds.includes(s.mentor_id)) continue;
            if (dayDateStart != null) {
                const t = new Date(s.start_time).getTime();
                if (t < dayDateStart || t > dayDateEnd) continue;
            }
            slotIdsToDelete.push(s.id);
        }
        if (slotIdsToDelete.length > 0) {
            await bulkDeleteMentorSlots(slotIdsToDelete);
        }
        candidates = payload;
    } else if (overwriteMode === 'replace_if_conflict') {
        const idsToDelete = conflicts.map(c => c.existing_slot_id);
        const dedup = [...new Set(idsToDelete)];
        if (dedup.length > 0) {
            await bulkDeleteMentorSlots(dedup);
        }
    }

    const created = candidates.length > 0 ? await bulkCreateMentorSlots(candidates) : [];

    return {
        created,
        skipped: payload.length - candidates.length,
        conflicts,
        totalSlotsRequested: payload.length,
        slotsPerMentor: slotTimes.length,
    };
};
