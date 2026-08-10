import { supabase } from './supabase';
import { notifyGoogleAppsScript } from './api';

// Fetch event details
export const getEvent = async (eventId) => {
    const { data, error } = await supabase
        .from('events')
        .select('event_name, admin_email, interview_admin_emails, interview_cc_emails, interview_email_template_subject, interview_email_template_body')
        .eq('event_id', eventId)
        .single();
    if (error) throw error;
    return data;
};

// ------------------------------
// Ather Team Members CRUD
// ------------------------------

export const getAtherTeamMembers = async (eventId) => {
    const { data: members, error: membersError } = await supabase
        .from('ather_team_members')
        .select('*')
        .eq('event_id', eventId)
        .order('name');
    if (membersError) throw membersError;
    return members;
};

export const getAtherTeamMemberById = async (id) => {
    const { data: member, error: memberError } = await supabase
        .from('ather_team_members')
        .select('*')
        .eq('id', id)
        .single();
    if (memberError) throw memberError;
    return member;
};

export const createAtherTeamMember = async (memberData) => {
    const { data, error } = await supabase
        .from('ather_team_members')
        .insert([memberData])
        .select();
    if (error) throw error;
    return data[0];
};

export const updateAtherTeamMember = async (id, updates) => {
    const { data, error } = await supabase
        .from('ather_team_members')
        .update(updates)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
};

export const deleteAtherTeamMember = async (id) => {
    const { error } = await supabase
        .from('ather_team_members')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
};

// ------------------------------
// Ather Team Slots CRUD
// ------------------------------

export const getAtherTeamSlots = async (eventId, memberId = null) => {
    let query = supabase
        .from('ather_team_slots')
        .select('*, ather_team_members(*)')
        .eq('event_id', eventId)
        .order('start_time');
    
    if (memberId) {
        query = query.eq('ather_team_member_id', memberId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const getAvailableAtherTeamSlots = async (eventId, memberId = null) => {
    let query = supabase
        .from('ather_team_slots')
        .select('*, ather_team_members(*)')
        .eq('event_id', eventId)
        .eq('is_available', true)
        .gt('start_time', new Date().toISOString())
        .order('start_time');
    
    if (memberId) {
        query = query.eq('ather_team_member_id', memberId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const createAtherTeamSlot = async (slotData) => {
    const { data, error } = await supabase
        .from('ather_team_slots')
        .insert([slotData])
        .select();
    if (error) throw error;
    return data[0];
};

export const updateAtherTeamSlot = async (id, updates) => {
    const { data, error } = await supabase
        .from('ather_team_slots')
        .update(updates)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
};

export const deleteAtherTeamSlot = async (id) => {
    const { error } = await supabase
        .from('ather_team_slots')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
};

// ------------------------------
// Ather Team Bookings CRUD
// ------------------------------

export const getAtherTeamBookings = async (eventId, memberId = null) => {
    let query = supabase
        .from('ather_team_bookings')
        .select('*, ather_team_slots(*), ather_team_members(*)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
    
    if (memberId) {
        query = query.eq('ather_team_member_id', memberId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
};

export const createAtherTeamBooking = async (bookingData) => {
    console.log('[Booking Trace] Starting booking process with data:', bookingData);
    
    // First, check if slot is still available
    console.log('[Booking Trace] Step 1: Checking slot availability for ID:', bookingData.slot_id);
    const { data: slot, error: slotError } = await supabase
        .from('ather_team_slots')
        .select('*, ather_team_members(*)')
        .eq('id', bookingData.slot_id)
        .single();
    
    if (slotError) {
        console.error('[Booking Trace] Step 1 Error: Failed to fetch slot:', slotError);
        throw slotError;
    }
    console.log('[Booking Trace] Step 1 Success: Slot details retrieved:', slot);
    
    if (!slot.is_available) {
        console.warn('[Booking Trace] Step 1 Warning: Slot is not available.');
        throw new Error('Slot is no longer available');
    }

    // Create booking with start_time, end_time, mentor_name, mentor_email
    console.log('[Booking Trace] Step 2: Creating booking row in ather_team_bookings...');
    const { data: booking, error: bookingError } = await supabase
        .from('ather_team_bookings')
        .insert([{
            ...bookingData,
            start_time: slot.start_time,
            end_time: slot.end_time,
            mentor_name: slot.ather_team_members.name,
            mentor_email: slot.ather_team_members.email
        }])
        .select();
    
    if (bookingError) {
        console.error('[Booking Trace] Step 2 Error: Failed to create booking:', bookingError);
        throw bookingError;
    }
    console.log('[Booking Trace] Step 2 Success: Booking row created:', booking[0]);

    // Mark slot as unavailable
    console.log('[Booking Trace] Step 3: Marking slot as unavailable...');
    await updateAtherTeamSlot(bookingData.slot_id, { is_available: false });
    console.log('[Booking Trace] Step 3 Success: Slot marked as unavailable.');

    // Fetch event details for extra context (optional)
    try {
      await getEvent(bookingData.event_id);
      
      // Notify Google Apps Script via Edge Function to avoid CORS issues
      console.log('[Booking Trace] Step 4: Notifying Google Apps Script via Edge Function...');
      
      // Add retry logic
      let result = null;
      let retries = 3;
      let lastError = null;
      
      while (retries > 0 && !result) {
        try {
          result = await notifyGoogleAppsScript(booking[0].id, true);
          
          if (result.success) {
            console.log('[Booking Trace] Step 4 Success: Google Apps Script notified.');
          } else {
            console.error('[Booking Trace] Step 4 Error: Google Apps Script returned error:', result.error);
          }
        } catch (notificationError) {
          lastError = notificationError;
          retries--;
          console.error(`[Booking Trace] Step 4 Error (retries left: ${retries}):`, notificationError);
          if (retries > 0) {
            // Wait 1 second before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (!result && lastError) {
        console.error('[Booking Trace] Step 4 Final Error: Failed to notify Google Apps Script after retries:', lastError);
      }
    } catch (notificationError) {
      console.error('[Booking Trace] Step 4 Error: Failed to notify Google Apps Script:', notificationError);
      // Don't fail the whole booking because of this
    }

    return booking[0];
};

export const deleteAtherTeamBooking = async (id) => {
    // First, get the booking to find the slot
    const { data: booking, error: getError } = await supabase
        .from('ather_team_bookings')
        .select('slot_id')
        .eq('id', id)
        .single();
    
    if (getError) throw getError;

    // Delete booking
    const { error } = await supabase
        .from('ather_team_bookings')
        .delete()
        .eq('id', id);
    
    if (error) throw error;

    // Mark slot as available again
    await updateAtherTeamSlot(booking.slot_id, { is_available: true });

    return true;
};
