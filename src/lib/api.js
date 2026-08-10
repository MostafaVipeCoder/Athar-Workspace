import { supabase } from './supabase';
import { fetchAndParseGoogleSheet, fetchAndParseGenericGoogleSheet } from './excel';

// Notify via Edge Function to avoid CORS issues
export const notifyGoogleAppsScript = async (bookingId, isAtherTeam) => {
  try {
    const { data, error } = await supabase.functions.invoke('process-booking', {
      body: {
        booking_id: bookingId,
        is_ather_team: isAtherTeam
      }
    });

    if (error) {
      console.error('[notifyGoogleAppsScript] Error:', error);
      throw error;
    }

    return data;
  } catch (err) {
    console.error('[notifyGoogleAppsScript] Failed to notify:', err);
    throw err;
  }
};

// ==========================================
// CONFIG & BRANDING
// ==========================================
const SHARING_BASE_URL = 'https://athareg.com/share';
// If the user has a branded domain, they can set it here:
// const SHARING_BASE_URL = 'https://yourbrand.com/share';

export const getShareUrl = (eventId) => {
    return `${SHARING_BASE_URL}?id=${eventId}`;
};

// ==========================================
// IN-MEMORY CACHE FOR FAST NAVIGATION
// ==========================================
const apiCache = new Map();
export const clearApiCache = () => apiCache.clear();

// Monkey-patch Supabase to automatically clear cache on any mutation
const originalFrom = supabase.from.bind(supabase);
supabase.from = (table) => {
    const queryBuilder = originalFrom(table);
    ['insert', 'update', 'delete', 'upsert'].forEach(method => {
        if (typeof queryBuilder[method] === 'function') {
            const originalMethod = queryBuilder[method].bind(queryBuilder);
            queryBuilder[method] = (...args) => {
                clearApiCache();
                return originalMethod(...args);
            };
        }
    });
    return queryBuilder;
};

const withCache = (key, fetcher, ttl = 60000) => {
    const cached = apiCache.get(key);
    if (cached && (Date.now() - cached.timestamp < ttl)) {
        return Promise.resolve(cached.data);
    }
    if (cached && cached.promise) return cached.promise;
    
    const promise = fetcher().then(data => {
        apiCache.set(key, { data, timestamp: Date.now(), promise: null });
        return data;
    }).catch(e => {
        apiCache.delete(key);
        throw e;
    });
    
    apiCache.set(key, { promise, timestamp: 0 });
    return promise;
};

export const getEvents = () => withCache('events', async () => {
    console.log('[Supabase] Fetching all events');
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[Supabase Error] getEvents:', error);
        throw error;
    }
    return data;
});

export const getEvent = (eventId) => withCache(`event_${eventId}`, async () => {
    console.log(`[Supabase] Fetching event: ${eventId}`);
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', eventId)
        .single();

    if (error) {
        console.error(`[Supabase Error] getEvent (${eventId}):`, error);
        throw error;
    }
    return data;
});

export const getFullAgenda = (eventId) => withCache(`fullAgenda_${eventId}`, async () => {
    console.log(`[Supabase] Fetching full agenda for event: ${eventId}`);

    // Fetch event, experts, companies, and days ALL IN PARALLEL — eliminates waterfall
    const [
        { data: event, error: eventError },
        { data: expertsRaw, error: expertsError },
        { data: companies, error: companiesError },
        { data: days, error: daysError },
    ] = await Promise.all([
        supabase.from('events').select('*').eq('event_id', eventId).single(),
        supabase.from('experts').select('*, master:master_experts(*)').eq('event_id', eventId).order('sort_order', { ascending: true }),
        supabase.from('companies').select('*').eq('event_id', eventId),
        supabase.from('event_days').select('*').eq('event_id', eventId).order('day_number', { ascending: true }),
    ]);

    if (eventError) throw eventError;
    if (expertsError) throw expertsError;
    if (companiesError) throw companiesError;
    if (daysError) throw daysError;

    // Flatten experts
    const experts = (expertsRaw || []).map(exp => ({
        ...exp.master,
        ...exp,
        master: undefined
    }));

    // Slots depend on day IDs — only these wait for days to resolve
    const dayIds = days.map(d => d.day_id);
    let slots = [];
    if (dayIds.length > 0) {
        const { data: slotsData, error: slotsError } = await supabase
            .from('agenda_slots')
            .select('*')
            .in('day_id', dayIds)
            .order('sort_order', { ascending: true });
        if (slotsError) throw slotsError;
        slots = slotsData;
    }

    return {
        event,
        days: days.map(day => ({
            ...day,
            slots: slots.filter(s => s.day_id === day.day_id)
        })),
        experts,
        companies
    };
});

export const getExperts = (eventId) => withCache(`experts_${eventId}`, async () => {
    const { data, error } = await supabase
        .from('experts')
        .select('*, master:master_experts(*)')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });
    if (error) throw error; 
    
    return (data || []).map(exp => ({
        ...exp.master,
        ...exp,
        master: undefined
    }));
});

export const getCompanies = (eventId) => withCache(`companies_${eventId}`, async () => {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('event_id', eventId)
        .order('name', { ascending: true });
    if (error) throw error; return data;
});

export const getStartups = () => withCache('startups', async () => {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error; return data;
});

export const createEvent = async (eventData) => {
    console.log('[Supabase] Creating event:', eventData.event_name);
    const { data, error } = await supabase
        .from('events')
        .insert({
            event_name: eventData.event_name,
            header_image_url: eventData.header_image_url || '',
            background_image_url: eventData.background_image_url || '',
            footer_image_url: eventData.footer_image_url || '',
            header_height: eventData.header_height || '16rem',
            experts_color: eventData.experts_color || '#9333ea',
            startups_color: eventData.startups_color || '#059669',
            header_settings: eventData.header_settings || {},
            show_day_names: eventData.show_day_names ?? true
        })
        .select()
        .single();

    if (error) {
        console.error('[Supabase Error] createEvent details:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }
    return data;
};

export const updateEvent = async (eventId, updates) => {
    const { data, error } = await supabase
        .from('events')
        .update(updates)
        .eq('event_id', eventId)
        .select()
        .single();
    if (error) throw error; return data;
};

export const deleteEvent = async (eventId) => {
    const { error } = await supabase
        .from('events')
        .delete()
        .eq('event_id', eventId);
    if (error) throw error; return { success: true };
};

export const duplicateEvent = async (originalEventId, newEventName) => {
    console.log(`[Supabase] Duplicating event: ${originalEventId} -> ${newEventName}`);

    // 1. Fetch full original event structure
    const fullAgenda = await getFullAgenda(originalEventId);
    const { event, days, experts, companies } = fullAgenda;

    // 2. Insert new event
    const { event_id: _, created_at: __, updated_at: ___, ...eventDataToCopy } = event;
    const newEventData = {
        ...eventDataToCopy,
        event_name: newEventName || `${event.event_name} (Copy)`
    };
    
    const { data: newEvent, error: eventError } = await supabase
        .from('events')
        .insert(newEventData)
        .select()
        .single();
        
    if (eventError) {
        console.error('[Supabase Error] Duplicating event:', eventError);
        throw eventError;
    }
    const newEventId = newEvent.event_id;

    // 3. Duplicate Experts
    const expertIdMap = new Map(); // old_id -> new_id
    if (experts && experts.length > 0) {
        const expertsToInsert = experts.map(exp => {
            const { id, created_at, updated_at, ...rest } = exp;
            return { ...rest, event_id: newEventId };
        });
        
        const { data: newExperts, error: expertsError } = await supabase
            .from('experts')
            .insert(expertsToInsert)
            .select();
            
        if (expertsError) throw expertsError;
        
        // Match old experts to new ones assuming order matches
        experts.forEach((oldExp, idx) => {
            expertIdMap.set(oldExp.id, newExperts[idx].id);
        });
    }

    // 4. Duplicate Companies
    const companyIdMap = new Map(); // old_id -> new_id
    if (companies && companies.length > 0) {
        const companiesToInsert = companies.map(comp => {
            const { company_id, created_at, updated_at, ...rest } = comp;
            return { ...rest, event_id: newEventId };
        });
        
        const { data: newCompanies, error: companiesError } = await supabase
            .from('companies')
            .insert(companiesToInsert)
            .select();
            
        if (companiesError) throw companiesError;
        
        companies.forEach((oldComp, idx) => {
            companyIdMap.set(oldComp.company_id, newCompanies[idx].company_id);
        });
    }

    // 5. Duplicate Days and Slots
    if (days && days.length > 0) {
        for (const oldDay of days) {
            const { day_id, created_at, updated_at, slots, ...dayDataToCopy } = oldDay;
            const newDayData = {
                ...dayDataToCopy,
                event_id: newEventId
            };
            
            const { data: newDay, error: dayError } = await supabase
                .from('event_days')
                .insert(newDayData)
                .select()
                .single();
                
            if (dayError) throw dayError;
            
            if (slots && slots.length > 0) {
                const slotsToInsert = slots.map(slot => {
                    const { slot_id, created_at, updated_at, day_id: old_day_id, ...slotDataToCopy } = slot;
                    
                    // Update referenced experts and companies if they exist in the slot
                    const new_expert_ids = slot.expert_ids ? slot.expert_ids.map(oldId => expertIdMap.get(oldId) || oldId) : [];
                    const new_company_ids = slot.company_ids ? slot.company_ids.map(oldId => companyIdMap.get(oldId) || oldId) : [];
                    
                    return {
                        ...slotDataToCopy,
                        day_id: newDay.day_id,
                        expert_ids: new_expert_ids,
                        company_ids: new_company_ids
                    };
                });
                
                const { error: slotsError } = await supabase
                    .from('agenda_slots')
                    .insert(slotsToInsert);
                    
                if (slotsError) throw slotsError;
            }
        }
    }
    
    // Attempt to clone library resources if any (Optional step, robust to failure)
    try {
        const { data: resources } = await supabase.from('library_resources').select('*').eq('event_id', originalEventId);
        if (resources && resources.length > 0) {
            const resourcesToInsert = resources.map(res => {
                const { id, created_at, updated_at, ...rest } = res;
                return { ...rest, event_id: newEventId };
            });
            await supabase.from('library_resources').insert(resourcesToInsert);
        }
    } catch (err) {
        console.warn('Failed to duplicate library resources:', err);
    }
    
    // Attempt to clone forms and fields if any (Optional step, robust to failure)
    try {
        const { data: forms } = await supabase.from('event_forms').select('*').eq('event_id', originalEventId);
        if (forms && forms.length > 0) {
            for (const oldForm of forms) {
                const { form_id, created_at, updated_at, ...formToCopy } = oldForm;
                const { data: newForm, error: formError } = await supabase
                    .from('event_forms')
                    .insert({ ...formToCopy, event_id: newEventId })
                    .select()
                    .single();
                
                if (!formError && newForm) {
                    const { data: fields } = await supabase.from('form_field_configs').select('*').eq('form_id', oldForm.form_id);
                    if (fields && fields.length > 0) {
                        const fieldsToInsert = fields.map(field => {
                            const { id, created_at, updated_at, form_id: _, ...fieldToCopy } = field;
                            return { ...fieldToCopy, form_id: newForm.form_id };
                        });
                        await supabase.from('form_field_configs').insert(fieldsToInsert);
                    }
                }
            }
        }
    } catch (err) {
        console.warn('Failed to duplicate event forms:', err);
    }
    
    clearApiCache();
    return newEvent;
};

// ==========================================
// EXPERTS & COMPANIES
// ==========================================

export const getMasterExperts = () => withCache('master_experts', async () => {
    const { data, error } = await supabase
        .from('master_experts')
        .select('*')
        .order('name', { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) return [];

    // Fetch all event links for these experts in one query
    const masterIds = data.map(e => e.id);
    const { data: expertLinks } = await supabase
        .from('experts')
        .select('master_id, event_id, events(event_id, event_name)')
        .in('master_id', masterIds);

    // Build a map of master_id -> [events]
    const eventsByMaster = {};
    (expertLinks || []).forEach(link => {
        if (!link.master_id || !link.events) return;
        if (!eventsByMaster[link.master_id]) eventsByMaster[link.master_id] = [];
        // Avoid duplicate events
        const alreadyAdded = eventsByMaster[link.master_id].some(e => e.event_id === link.events.event_id);
        if (!alreadyAdded) eventsByMaster[link.master_id].push(link.events);
    });

    return data.map(expert => ({
        ...expert,
        linked_events: eventsByMaster[expert.id] || []
    }));
});

export const updateMasterExpert = async (id, data) => {
    // Strip virtual/computed fields that are NOT real DB columns
    // linked_events is computed in getMasterExperts and must never be sent to Supabase
    const {
        linked_events,  // virtual – computed field, not a DB column
        id: _id,        // never update primary key
        ...dbData       // only real columns go to Supabase
    } = data;

    // 1. Update the master record
    const { data: updated, error } = await supabase
        .from('master_experts')
        .update(dbData)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;

    // 2. Synchronize all local expert records that reference this master
    // We only sync the profile fields, not sort_order or event_id
    const { name, name_ar, title, title_ar, company, company_ar, bio, bio_ar, linkedin_url, photo_url } = updated;
    const syncData = { name, name_ar, title, title_ar, company, company_ar, bio, bio_ar, linkedin_url, photo_url };
    
    await supabase
        .from('experts')
        .update(syncData)
        .eq('master_id', id);

    return updated;
};

export const deleteMasterExpert = async (id) => {
    // Step 1: Detach all event-specific experts linked to this master.
    // We set master_id = null instead of deleting them so event data is preserved.
    const { error: detachError } = await supabase
        .from('experts')
        .update({ master_id: null })
        .eq('master_id', id);
    if (detachError) throw detachError;

    // Step 2: Now safe to delete the master record (no FK constraint violation)
    const { error } = await supabase
        .from('master_experts')
        .delete()
        .eq('id', id);
    if (error) throw error;

    return { success: true };
};

export const createExpert = async (expertData) => {
    const { 
        name, name_ar, title, title_ar, company, company_ar, 
        bio, bio_ar, linkedin_url, photo_url, event_id, sort_order 
    } = expertData;
    let { master_id } = expertData;

    // 1. If no master_id, find or create in hub
    if (!master_id) {
        // Try to find by name first to avoid duplicates
        const { data: existingMaster } = await supabase
            .from('master_experts')
            .select('*')
            .eq('name', name)
            .maybeSingle();

        if (existingMaster) {
            master_id = existingMaster.id;
            // Update the master with any new info provided to keep it fresh
            const updateData = { name, name_ar, title, title_ar, company, company_ar, bio, bio_ar, linkedin_url, photo_url };
            await updateMasterExpert(master_id, updateData);
        } else {
            const { data: newMaster, error: masterError } = await supabase
                .from('master_experts')
                .insert({ name, name_ar, title, title_ar, company, company_ar, bio, bio_ar, linkedin_url, photo_url })
                .select()
                .single();
            
            if (masterError) throw masterError;
            master_id = newMaster.id;
        }
    }

    // Fetch the latest master data to ensure local record is perfectly in sync
    const { data: masterData } = await supabase
        .from('master_experts')
        .select('*')
        .eq('id', master_id)
        .single();

    // 2. Insert local expert (populated with master data for redundancy/searchability)
    const { data, error } = await supabase
        .from('experts')
        .insert({ 
            event_id, 
            master_id, 
            sort_order,
            name: masterData.name,
            name_ar: masterData.name_ar,
            title: masterData.title,
            title_ar: masterData.title_ar,
            company: masterData.company,
            company_ar: masterData.company_ar,
            bio: masterData.bio,
            bio_ar: masterData.bio_ar,
            linkedin_url: masterData.linkedin_url,
            photo_url: masterData.photo_url
        })
        .select('*, master:master_experts(*)')
        .single();

    if (error) throw error; 
    
    return {
        ...data.master,
        ...data,
        master: undefined
    };
};

export const updateExpert = async (expertId, expertData) => {
    const { 
        name, name_ar, title, title_ar, company, company_ar, 
        bio, bio_ar, linkedin_url, photo_url, master_id, sort_order,
        display_config, event_id,
        // strip virtual/non-column fields
        linked_events: _le,
        id: _id,
        expert_id: _eid,
        ...rest
    } = expertData;

    // Build the payload for the local experts record
    // Always update all profile fields directly (handles experts with no master_id too)
    const localPayload = {
        name, name_ar, title, title_ar,
        company, company_ar,
        bio, bio_ar,
        linkedin_url, photo_url,
        ...(sort_order !== undefined && { sort_order }),
    };

    // 1. Update local expert record
    // Use maybeSingle() to avoid PGRST116 crash when row doesn't exist
    const { data: localExpert, error: localError } = await supabase
        .from('experts')
        .update(localPayload)
        .eq('expert_id', expertId)
        .select()
        .maybeSingle();
    if (localError) throw localError;

    // 2. If linked to a master, sync profile data to master + all other linked events
    if (master_id) {
        try {
            await updateMasterExpert(master_id, { 
                name, name_ar, title, title_ar, 
                company, company_ar, 
                bio, bio_ar, 
                linkedin_url, photo_url 
            });
        } catch (masterErr) {
            // Non-fatal: local record was updated, log the master sync failure
            console.warn('[updateExpert] Master sync failed (non-fatal):', masterErr);
        }
    }

    return localExpert;
};

export const deleteExpert = async (expertId) => {
    const { error } = await supabase
        .from('experts')
        .delete()
        .eq('expert_id', expertId);
    if (error) throw error; return { success: true };
};

export const createCompany = async (companyData) => {
    const { data, error } = await supabase
        .from('companies')
        .insert(companyData)
        .select()
        .single();
    if (error) throw error; return data;
};

export const updateCompany = async (companyId, updates) => {
    const { data, error } = await supabase
        .from('companies')
        .update(updates)
        .eq('company_id', companyId)
        .select()
        .single();
    if (error) throw error; return data;
};

export const deleteCompany = async (companyId) => {
    const { error } = await supabase
        .from('companies')
        .delete()
        .eq('company_id', companyId);
    if (error) throw error; return { success: true };
};

// ==========================================
// DAY APIs
// ==========================================

export const getEventDays = async (eventId) => {
    const { data, error } = await supabase
        .from('event_days')
        .select('*')
        .eq('event_id', eventId)
        .order('day_number', { ascending: true });
    if (error) throw error; return data;
};

export const createDay = async (dayData) => {
    const { data, error } = await supabase
        .from('event_days')
        .insert({
            event_id: dayData.event_id,
            day_number: dayData.day_number,
            day_name: dayData.day_name,
            day_name_ar: dayData.day_name_ar,
            day_date: dayData.day_date
        })
        .select()
        .single();
    if (error) throw error; return data;
};

export const updateDay = async (dayId, updates) => {
    console.log(`[Supabase] Updating day ${dayId}:`, updates);
    const { data, error } = await supabase
        .from('event_days')
        .update(updates)
        .eq('day_id', dayId)
        .select()
        .single();

    if (error) {
        console.error(`[Supabase Error] updateDay (${dayId}) details:`, {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }
    return data;
};

export const deleteDay = async (dayId) => {
    const { error } = await supabase
        .from('event_days')
        .delete()
        .eq('day_id', dayId);
    if (error) throw error; return { success: true };
};

// ==========================================
// SLOT APIs
// ==========================================

export const getAgendaSlots = async (dayId) => {
    const { data, error } = await supabase
        .from('agenda_slots')
        .select('*')
        .eq('day_id', dayId)
        .order('sort_order', { ascending: true });
    if (error) throw error; return data;
};

export const createSlot = async (slotData) => {
    const { data, error } = await supabase
        .from('agenda_slots')
        .insert({
            day_id: slotData.day_id,
            start_time: slotData.start_time,
            end_time: slotData.end_time,
            slot_title: slotData.slot_title,
            slot_title_ar: slotData.slot_title_ar,
            presenter_name: slotData.presenter_name || '',
            presenter_name_ar: slotData.presenter_name_ar || '',
            bullet_points: slotData.bullet_points || [],
            bullet_points_ar: slotData.bullet_points_ar || [],
            sort_order: slotData.sort_order || 999
        })
        .select()
        .single();
    if (error) throw error; return data;
};

export const updateSlot = async (slotId, updates) => {
    const { data, error } = await supabase
        .from('agenda_slots')
        .update(updates)
        .eq('slot_id', slotId)
        .select()
        .single();
    if (error) throw error; return data;
};

export const deleteSlot = async (slotId) => {
    const { error } = await supabase
        .from('agenda_slots')
        .delete()
        .eq('slot_id', slotId);
    if (error) throw error; return { success: true };
};
// ==========================================
// STORAGE APIs
// ==========================================

export const uploadImage = async (file, path = 'covers') => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
    
    // Sanitize path: remove spaces and ensure clean segment joining
    const sanitizedPath = path.split('/').map(part => part.trim()).filter(Boolean).join('/');
    const filePath = `${sanitizedPath}/${fileName}`;

    console.log(`[Supabase Storage] Uploading: ${filePath}`);

    const { error: uploadError } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file);

    if (uploadError) {
        console.error('[Supabase Storage Error] Upload:', uploadError);
        throw uploadError;
    }

    const { data } = supabase.storage
        .from('event-assets')
        .getPublicUrl(filePath);

    return data.publicUrl;
};

// ==========================================
// LIBRARY (مكتبة) APIs
// ==========================================

export const getLibraryResources = (eventId) => withCache(`library_resources_${eventId || 'global'}`, async () => {
    let query = supabase.from('library_resources').select('*');
    if (eventId && eventId !== 'undefined') {
        query = query.or(`event_id.eq.${eventId},is_central.eq.true`);
    } else {
        query = query.eq('is_central', true);
    }
    const { data, error } = await query.order('sort_order', { ascending: true });
    if (error) throw error; return data;
});

export const createLibraryResource = async (resourceData) => {
    const { data, error } = await supabase
        .from('library_resources')
        .insert(resourceData)
        .select()
        .single();
    if (error) throw error; return data;
};

export const updateLibraryResource = async (resourceId, updates) => {
    const { data, error } = await supabase
        .from('library_resources')
        .update(updates)
        .eq('resource_id', resourceId)
        .select()
        .single();
    if (error) throw error; return data;
};

export const deleteLibraryResource = async (resourceId) => {
    const { error } = await supabase
        .from('library_resources')
        .delete()
        .eq('resource_id', resourceId);
    if (error) throw error; return { success: true };
};

export const getLibraryData = (eventId) => withCache(`library_data_${eventId}`, async () => {
    const resources = await getLibraryResources(eventId);
    return { resources };
});

/**
 * Bulk imports agenda data (days and slots) for an event.
 * Supports previewOnly mode to return a diff before applying changes.
 */
export const importAgendaData = async (eventId, data, previewOnly = false) => {
    const { experts: sheetExperts, companies: sheetCompanies } = data;
    console.log(`[Supabase] Differential Sync ${previewOnly ? 'PREVIEW' : 'START'} for event: ${eventId}`);

    const stats = {
        days: { added: 0, updated: 0, skipped: 0 },
        slots: { added: 0, updated: 0, skipped: 0 },
        experts: { added: 0, updated: 0, skipped: 0 },
        companies: { added: 0, updated: 0, skipped: 0 }
    };

    const changes = {
        experts: { toAdd: [], toUpdate: [] },
        companies: { toAdd: [], toUpdate: [] },
        slots: { toAdd: [], toUpdate: [] }
    };

    // Helper to normalize strings for comparison
    const normalize = (str) => (str || '').toString().trim().toLowerCase();

    try {
        // --- 1. SYNC EXPERTS ---
        const { data: existingExperts } = await supabase.from('experts').select('*').eq('event_id', eventId);
        if (sheetExperts) {
            for (const sExpert of sheetExperts) {
                const existing = existingExperts?.find(e => normalize(e.name) === normalize(sExpert.name));
                const expertData = {
                    title: (sExpert.title || '').trim(),
                    bio: (sExpert.bio || '').trim(),
                    company: (sExpert.company || '').trim(),
                    linkedin_url: (sExpert.linkedin_url || '').trim(),
                    photo_url: (sExpert.photo_url || '').trim()
                };

                if (existing) {
                    const hasChanged = 
                        normalize(existing.title) !== normalize(expertData.title) ||
                        normalize(existing.bio) !== normalize(expertData.bio) ||
                        normalize(existing.company) !== normalize(expertData.company) ||
                        normalize(existing.linkedin_url) !== normalize(expertData.linkedin_url) ||
                        normalize(existing.photo_url) !== normalize(expertData.photo_url);

                    if (hasChanged) {
                        if (previewOnly) {
                            changes.experts.toUpdate.push({ name: sExpert.name, from: existing, to: expertData });
                        } else {
                            await supabase.from('experts').update({
                                ...expertData,
                                photo_url: sExpert.photo_url || existing.photo_url
                            }).eq('expert_id', existing.expert_id);
                        }
                        stats.experts.updated++;
                    } else {
                        stats.experts.skipped++;
                    }
                } else {
                    if (previewOnly) {
                        changes.experts.toAdd.push({ name: sExpert.name, ...expertData });
                    } else {
                        await supabase.from('experts').insert([{ 
                            event_id: eventId, 
                            name: sExpert.name.trim(), 
                            ...expertData,
                            photo_url: sExpert.photo_url || '',
                            sort_order: (existingExperts?.length || 0) + stats.experts.added + 1
                        }]);
                    }
                    stats.experts.added++;
                }
            }
        }

        // --- 4. SYNC COMPANIES ---
        const { data: existingCompanies } = await supabase.from('companies').select('*').eq('event_id', eventId);
        if (sheetCompanies) {
            for (const sCompany of sheetCompanies) {
                const existing = existingCompanies?.find(c => normalize(c.name) === normalize(sCompany.name));
                const companyData = {
                    founder: (sCompany.founder || '').trim(),
                    role: (sCompany.role || '').trim(),
                    location: (sCompany.location || '').trim(),
                    governorate: (sCompany.governorate || sCompany.location || '').trim(),
                    industry: (sCompany.industry || '').trim(),
                    description: (sCompany.description || '').trim(),
                    website_url: (sCompany.website_url || '').trim(),
                    links: Array.isArray(sCompany.links) ? sCompany.links : [],
                    stage: (sCompany.stage || '').trim(),
                    logo_url: (sCompany.logo_url || '').trim()
                };

                if (existing) {
                    const hasChanged =
                        normalize(existing.founder) !== normalize(companyData.founder) ||
                        normalize(existing.role) !== normalize(companyData.role) ||
                        normalize(existing.location) !== normalize(companyData.location) ||
                        normalize(existing.industry) !== normalize(companyData.industry) ||
                        normalize(existing.description) !== normalize(companyData.description) ||
                        normalize(existing.website_url) !== normalize(companyData.website_url) ||
                        normalize(existing.stage) !== normalize(companyData.stage) ||
                        normalize(existing.logo_url) !== normalize(companyData.logo_url);

                    if (hasChanged) {
                        if (previewOnly) {
                            changes.companies.toUpdate.push({ name: sCompany.name, from: existing, to: companyData });
                        } else {
                            await supabase.from('companies').update(companyData).eq('company_id', existing.company_id);
                        }
                        stats.companies.updated++;
                    } else {
                        stats.companies.skipped++;
                    }
                } else {
                    if (previewOnly) {
                        changes.companies.toAdd.push({ name: sCompany.name, ...companyData });
                    } else {
                        await supabase.from('companies').insert([{ 
                            event_id: eventId, 
                            name: sCompany.name.trim(), 
                            ...companyData,
                            sort_order: (existingCompanies?.length || 0) + stats.companies.added + 1
                        }]);
                    }
                    stats.companies.added++;
                }
            }
        }

        return { success: true, stats, changes };
    } catch (error) {
        console.error('[Supabase Error] Sync Operation:', error);
        throw error;
    }
};

/**
 * Syncs an event's data from its configured Google Sheet.
 */
export const syncEventFromCloud = async (eventId, previewOnly = false) => {
    try {
        const event = await getEvent(eventId);
        if (!event.gsheets_url) {
            throw new Error('Google Sheets URL not configured for this event.');
        }

        const data = await fetchAndParseGoogleSheet(event.gsheets_url);
        return await importAgendaData(eventId, data, previewOnly);
    } catch (error) {
        console.error('[Supabase] syncEventFromCloud failed:', error);
        throw error;
    }
};

// ==========================================
// REGISTRATION PORTALS APIs
// ==========================================

/**
 * Get form field configuration for an event
 * @param {string} eventId - Event ID
 * @param {string} entityType - 'company' or 'expert'
 */
export const getFormConfig = async (eventId, entityType) => {
    // 1. Find the first form for this entity type
    const { data: forms } = await supabase
        .from('event_forms')
        .select('form_id')
        .eq('event_id', eventId)
        .eq('target_module', entityType)
        .order('created_at', { ascending: true })
        .limit(1);

    const formId = forms?.[0]?.form_id;

    // 2. Fetch fields
    let query = supabase
        .from('form_field_configs')
        .select('*')
        .eq('event_id', eventId)
        .eq('entity_type', entityType);
    
    if (formId) {
        query = query.eq('form_id', formId);
    }

    const { data, error } = await query.order('display_order', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
        return getDefaultFormConfig(entityType);
    }

    return data;
};

/**
 * Save form field configuration for an event
 * @param {string} eventId - Event ID
 * @param {string} entityType - 'company' or 'expert'
 * @param {Array} fields - Array of field configurations
 */
export const saveFormConfig = async (eventId, entityType, fields) => {
    // 1. Find or create the "Main" form for this entity type
    let { data: forms } = await supabase
        .from('event_forms')
        .select('form_id')
        .eq('event_id', eventId)
        .eq('target_module', entityType)
        .order('created_at', { ascending: true })
        .limit(1);

    let formId = forms?.[0]?.form_id;

    if (!formId) {
        // Create a default form if none exists
        const { data: newForm } = await supabase
            .from('event_forms')
            .insert({ 
                event_id: eventId, 
                form_name: `Default ${entityType === 'expert' ? 'Expert' : 'Startup'} Form`, 
                target_module: entityType 
            })
            .select()
            .single();
        formId = newForm?.form_id;
    }

    // 2. Delete existing config for THIS SPECIFIC FORM only
    const deleteQuery = supabase
        .from('form_field_configs')
        .delete()
        .eq('event_id', eventId)
        .eq('entity_type', entityType);
    
    if (formId) {
        await deleteQuery.eq('form_id', formId);
    } else {
        await deleteQuery; // Fallback for legacy
    }

    // 3. Insert new config
    const fieldsWithMetadata = fields.map((field, idx) => ({
        ...field,
        event_id: eventId,
        entity_type: entityType,
        form_id: formId,
        display_order: idx
    }));

    const { data, error } = await supabase
        .from('form_field_configs')
        .insert(fieldsWithMetadata)
        .select();

    if (error) throw error; return data;
};

/**
 * Submit company registration
 * @param {string} eventId - Event ID
 * @param {Object} formData - Form data from the portal
 */
export const submitCompanyRegistration = async (eventId, formData) => {
    // Extract core fields
    const { startup_name, logo_url, industry, location, ...additionalData } = formData;

    const submission = {
        event_id: eventId,
        startup_name,
        logo_url: logo_url || null,
        industry: industry || null,
        location: location || null,
        additional_data: additionalData,
        status: 'screening'
    };

    const { data, error } = await supabase
        .from('company_submissions')
        .insert([submission])
        .select()
        .single();

    if (error) throw error; return data;
};

/**
 * Submit expert registration
 * @param {string} eventId - Event ID
 * @param {Object} formData - Form data from the portal
 */
export const submitExpertRegistration = async (eventId, formData) => {
    // Extract core fields
    const { expert_name, photo_url, title, company, bio, ...additionalData } = formData;

    const submission = {
        event_id: eventId,
        expert_name,
        photo_url: photo_url || null,
        title: title || null,
        company: company || null,
        bio: bio || null,
        additional_data: additionalData,
        status: 'pending'
    };

    const { data, error } = await supabase
        .from('expert_submissions')
        .insert([submission])
        .select()
        .single();

    if (error) throw error; return data;
};

/**
 * Get submissions for an event
 * @param {string} eventId - Event ID
 * @param {string} entityType - 'company' or 'expert'
 * @param {string} status - Filter by status ('pending', 'approved', 'rejected', or 'all')
 */
export const getSubmissions = async (eventId, entityType, status = 'all') => {
    const table = entityType === 'company' ? 'company_submissions' : 'expert_submissions';

    let query = supabase
        .from(table)
        .select('*')
        .eq('event_id', eventId)
        .order('submitted_at', { ascending: false });

    if (status !== 'all') {
        query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error; return data;
};

/**
 * Approve a submission and copy to companies/experts table
 * @param {string} submissionId - Submission ID
 * @param {string} entityType - 'company' or 'expert'
 */
export const approveSubmission = async (submissionId, entityType) => {
    const submissionsTable = entityType === 'company' ? 'company_submissions' : 'expert_submissions';
    const targetTable = entityType === 'company' ? 'companies' : 'experts';

    // Get submission
    const { data: submission, error: fetchError } = await supabase
        .from(submissionsTable)
        .select('*')
        .eq('submission_id', submissionId)
        .single();

    if (fetchError) throw fetchError;

    // Prepare data for target table
    let targetData;
    if (entityType === 'company') {
        targetData = {
            event_id: submission.event_id,
            name: submission.startup_name,
            logo_url: submission.logo_url,
            industry: submission.industry,
            location: submission.location,
            ...submission.additional_data
        };
    } else {
        targetData = {
            event_id: submission.event_id,
            name: submission.expert_name,
            photo_url: submission.photo_url,
            title: submission.title,
            company: submission.company,
            bio: submission.bio,
            ...submission.additional_data
        };
    }

    // Insert into target table
    if (entityType === 'expert') {
        // Use the centralized createExpert to ensure master linking and sync
        await createExpert({
            name: submission.expert_name,
            photo_url: submission.photo_url,
            title: submission.title,
            company: submission.company,
            bio: submission.bio,
            event_id: submission.event_id,
            ...submission.additional_data
        });
    } else {
        const { error: insertError } = await supabase
            .from(targetTable)
            .insert([targetData]);
        if (insertError) throw insertError;
    }

    // Update submission status
    const { data: updated, error: updateError } = await supabase
        .from(submissionsTable)
        .update({
            status: 'approved',
            reviewed_at: new Date().toISOString()
        })
        .eq('submission_id', submissionId)
        .select()
        .single();

    if (updateError) throw updateError;
    return updated;
};

/**
 * Reject a submission
 * @param {string} submissionId - Submission ID
 * @param {string} entityType - 'company' or 'expert'
 * @param {string} reason - Rejection reason
 */
export const rejectSubmission = async (submissionId, entityType, reason) => {
    const table = entityType === 'company' ? 'company_submissions' : 'expert_submissions';

    const { data, error } = await supabase
        .from(table)
        .update({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            rejection_reason: reason
        })
        .eq('submission_id', submissionId)
        .select()
        .single();

    if (error) throw error; return data;
};

/**
 * Get default form configuration
 * @param {string} entityType - 'company' or 'expert'
 */
const getDefaultFormConfig = (entityType) => {
    if (entityType === 'company') {
        return [
            {
                field_name: 'startup_name',
                field_label: 'Company Name',
                field_type: 'text',
                is_required: true,
                show_in_card: true,
                display_order: 0,
                placeholder: 'Enter company name'
            },
            {
                field_name: 'logo_url',
                field_label: 'Company Logo',
                field_type: 'file',
                is_required: false,
                show_in_card: true,
                display_order: 1,
                help_text: 'Upload your company logo (JPG, PNG)'
            },
            {
                field_name: 'industry',
                field_label: 'Industry',
                field_type: 'text',
                is_required: false,
                show_in_card: true,
                display_order: 2,
                placeholder: 'e.g., SaaS, E-commerce, FinTech'
            },
            {
                field_name: 'location',
                field_label: 'Location',
                field_type: 'text',
                is_required: false,
                show_in_card: true,
                display_order: 3,
                placeholder: 'e.g., Cairo, Dubai, Remote'
            }
        ];
    } else if (entityType === 'expert') {
        return [
            {
                field_name: 'expert_name',
                field_label: 'Full Name',
                field_type: 'text',
                is_required: true,
                show_in_card: true,
                display_order: 0,
                placeholder: 'Enter your full name'
            },
            {
                field_name: 'photo_url',
                field_label: 'Photo',
                field_type: 'file',
                is_required: false,
                show_in_card: true,
                display_order: 1,
                help_text: 'Upload a professional photo'
            },
            {
                field_name: 'title',
                field_label: 'Job Title',
                field_type: 'text',
                is_required: false,
                show_in_card: true,
                display_order: 2,
                placeholder: 'e.g., CEO, CTO, Founder'
            },
            {
                field_name: 'company',
                field_label: 'Company',
                field_type: 'text',
                is_required: false,
                show_in_card: true,
                display_order: 3,
                placeholder: 'Company name'
            },
            {
                field_name: 'bio',
                field_label: 'Bio',
                field_type: 'textarea',
                is_required: false,
                show_in_card: true,
                display_order: 4,
                placeholder: 'Brief bio about yourself',
                validation_rules: { maxLength: 500 }
            }
        ];
    }
    // Return empty array for 'selection_process' or any other types
    return [];
};

// ==========================================
// MULTI-FORM APIs
// ==========================================

/**
 * Get all forms for an event
 */
export const getEventForms = async (eventId) => {
    const { data, error } = await supabase
        .from('event_forms')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
};

/**
 * Create a new form and seed it with default fields based on target_module
 */
export const createEventForm = async (eventId, formName, targetModule) => {
    // 1. Create the form record
    const { data: form, error: formError } = await supabase
        .from('event_forms')
        .insert({ event_id: eventId, form_name: formName, target_module: targetModule })
        .select()
        .single();
    if (formError) throw formError;

    // 2. Seed default fields (empty for selection_process)
    const defaultFields = getDefaultFormConfig(targetModule);
    if (defaultFields.length > 0) {
        const fieldsToInsert = defaultFields.map((field, idx) => ({
            ...field,
            event_id: eventId,
            entity_type: targetModule,
            form_id: form.form_id,
            display_order: idx,
        }));
        const { error: fieldError } = await supabase
            .from('form_field_configs')
            .insert(fieldsToInsert);
        if (fieldError) throw fieldError;
    }

    return form;
};

/**
 * Update form metadata (name, is_active)
 */
export const updateEventForm = async (formId, updates) => {
    const { data, error } = await supabase
        .from('event_forms')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('form_id', formId)
        .select()
        .single();
    if (error) throw error; return data;
};

/**
 * Delete a form and all its field configs (via CASCADE)
 */
export const deleteEventForm = async (formId) => {
    const { error } = await supabase
        .from('event_forms')
        .delete()
        .eq('form_id', formId);
    if (error) throw error; return { success: true };
};

/**
 * Get field configs for a specific form_id
 */
export const getFormConfigById = async (formId) => {
    const { data, error } = await supabase
        .from('form_field_configs')
        .select('*')
        .eq('form_id', formId)
        .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
};

/**
 * Save field configs for a specific form_id (replace all)
 */
export const saveFormConfigById = async (formId, eventId, targetModule, fields) => {
    // 1. Delete existing fields for this form
    const { error: deleteError } = await supabase
        .from('form_field_configs')
        .delete()
        .eq('form_id', formId);
    
    if (deleteError) {
        console.error('[Supabase] Error deleting old configs:', deleteError);
        throw deleteError;
    }

    if (!fields || fields.length === 0) return [];

    // 2. Clean and map fields for insertion
    // We remove config_id, created_at, updated_at to let DB generate them
    // and ensure all objects have the same keys to avoid PostgREST 400 errors
    const fieldsToInsert = fields.map((field, idx) => {
        const cleanedMetadata = {
            event_id: eventId,
            form_id: formId,
            entity_type: targetModule,
            display_order: idx,
            field_name: field.field_name,
            field_label: field.field_label,
            field_type: field.field_type,
            is_required: field.is_required || false,
            show_in_card: field.show_in_card || false,
            placeholder: field.placeholder || '',
            help_text: field.help_text || '',
            is_custom: field.is_custom || false,
            // Ensure JSON fields are handled correctly
            field_options: field.field_options || [],
            validation_rules: field.validation_rules || {}
        };
        return cleanedMetadata;
    });

    // 3. Perform the bulk insert
    const { data, error: insertError } = await supabase
        .from('form_field_configs')
        .insert(fieldsToInsert)
        .select();

    if (insertError) {
        console.error('[Supabase] Error inserting new configs:', insertError);
        throw insertError;
    }
    
    return data;
};

/**
 * Get a single event form by its ID
 */
export const getEventFormById = async (formId) => {
    const { data, error } = await supabase
        .from('event_forms')
        .select('*')
        .eq('form_id', formId)
        .single();
    if (error) throw error; return data;
};

/**
 * Submit data to the correct table based on target_module
 */
export const submitToForm = async (formId, eventId, targetModule, formData) => {
    if (targetModule === 'company') {
        const { startup_name, logo_url, industry, location, ...additionalData } = formData;
        const { data, error } = await supabase
            .from('company_submissions')
            .insert([{
                event_id: eventId,
                form_id: formId,
                startup_name: startup_name || formData[Object.keys(formData)[0]] || 'Unknown',
                logo_url: logo_url || null,
                industry: industry || null,
                location: location || null,
                additional_data: additionalData,
                status: 'screening'
            }])
            .select().single();
        if (error) throw error; return data;
    } else if (targetModule === 'expert') {
        const { expert_name, photo_url, title, company, bio, ...additionalData } = formData;
        const { data, error } = await supabase
            .from('expert_submissions')
            .insert([{
                event_id: eventId,
                form_id: formId,
                expert_name: expert_name || formData[Object.keys(formData)[0]] || 'Unknown',
                photo_url: photo_url || null,
                title: title || null,
                company: company || null,
                bio: bio || null,
                additional_data: additionalData,
                status: 'pending'
            }])
            .select().single();
        if (error) throw error; return data;
    } else if (targetModule === 'selection_process') {
        // For selection_process, all fields go into company_submissions additional_data
        const { data, error } = await supabase
            .from('company_submissions')
            .insert([{
                event_id: eventId,
                form_id: formId,
                startup_name: formData[Object.keys(formData)[0]] || 'Applicant',
                additional_data: formData,
                status: 'screening'
            }])
            .select().single();
        if (error) throw error; return data;
    }
    throw new Error(`Unknown target_module: ${targetModule}`);
};

export const extractPrimaryEmail = (additionalData) => {
    if (!additionalData || typeof additionalData !== 'object') return null;

    const columnOrder = additionalData._column_order;
    
    // 1. Try using column order to locate the email right after the founder's name
    if (Array.isArray(columnOrder)) {
        // Find index of founder name column
        const founderNameIdx = columnOrder.findIndex((header) => {
            const lower = header.toLowerCase();
            return (lower.includes('full name') || lower.includes('الاسم بالكامل') || lower.includes('اسمك بالكامل')) &&
                   !lower.includes('second') && !lower.includes('العضو الثاني');
        });

        if (founderNameIdx !== -1) {
            // Find the first email column after the founder name column
            for (let i = founderNameIdx + 1; i < columnOrder.length; i++) {
                const header = columnOrder[i];
                const lower = header.toLowerCase();
                if ((lower.includes('email') || lower.includes('البريد الإلكتروني') || lower.includes('البريد الالكتروني')) &&
                    !lower.includes('second') && !lower.includes('العضو الثاني')) {
                    const val = additionalData[header];
                    if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
                        const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                        if (match) return match[0].trim();
                    }
                }
            }
        }
    }

    // 2. Fallback: Search all keys, prioritizing keys containing "email" or "البريد الإلكتروني" and ignoring "second member"
    for (const [key, val] of Object.entries(additionalData)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('second') || lowerKey.includes('العضو الثاني')) {
            continue;
        }
        if (lowerKey.includes('email') || lowerKey.includes('البريد الإلكتروني') || lowerKey.includes('البريد الالكتروني') || lowerKey.includes('البريد')) {
            if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
                const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (match) return match[0].trim();
            }
        }
    }

    // 3. Last resort: Any email-like string in the object that is not a second member key
    for (const [key, val] of Object.entries(additionalData)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('second') || lowerKey.includes('العضو الثاني')) {
            continue;
        }
        if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) return match[0].trim();
        }
    }

    return null;
};

/**
 * Syncs company submissions from a generic Google Sheet.
 */
export const syncSubmissionsFromSheet = async (eventId, url) => {
    try {
        const data = await fetchAndParseGenericGoogleSheet(url);
        const sheetNames = Object.keys(data);
        const targetSheet = sheetNames.find(name =>
            name.toLowerCase().trim() === 'total responces' ||
            name.toLowerCase().trim() === 'selection prosses' ||
            name.toLowerCase().trim() === 'selection process'
        );

        if (!targetSheet) {
            throw new Error('Could not find a sheet named "Total responces". Please ensure your Google Sheet has a tab with this exact name.');
        }

        const sheetData = data[targetSheet];
        const rows = sheetData.rows;
        const headers = sheetData.headers;

        if (!rows || rows.length === 0) return { success: true, count: 0 };

        // Helper for smart mapping
        const findField = (row, keywords) => {
            const entry = Object.entries(row).find(([key]) =>
                keywords.some(k => key.toLowerCase().includes(k.toLowerCase()))
            );
            return entry ? entry[1] : null;
        };

        // 1. Fetch existing submissions for this event to compare
        const { data: existingSubmissions, error: fetchError } = await supabase
            .from('company_submissions')
            .select('*')
            .eq('event_id', eventId);

        if (fetchError) throw fetchError;

        // 2. Helper to extract key fields for comparison from a submission database record
        const getSubmissionKeys = (sub) => {
            let email = sub.email || sub.contact_email;
            let startupName = sub.startup_name;
            let founderName = sub.founder_name || sub.startup_name;

            if (sub.additional_data && typeof sub.additional_data === 'object') {
                const extractedEmail = extractPrimaryEmail(sub.additional_data);
                if (extractedEmail) email = extractedEmail;

                for (const [key, val] of Object.entries(sub.additional_data)) {
                    const lowerKey = key.toLowerCase();
                    if ((lowerKey.includes('full name') || lowerKey.includes('اسمك بالكامل') || lowerKey.includes('founder name')) && typeof val === 'string' && val.trim()) {
                        founderName = val.trim();
                        break;
                    }
                }
            }

            return {
                email: email ? email.toLowerCase().trim() : null,
                startupName: startupName ? startupName.toLowerCase().trim() : null,
                founderName: founderName ? founderName.toLowerCase().trim() : null
            };
        };

        const existingKeysList = existingSubmissions.map(s => ({
            id: s.submission_id,
            keys: getSubmissionKeys(s)
        }));

        // 3. Process and diff incoming rows
        const toInsert = [];

        for (const row of rows) {
            let startup_name = null;
            const startupNameEntry = Object.entries(row).find(([key]) => 
                key.toLowerCase().includes('startup name') || 
                key.toLowerCase().includes('اسم الشركة')
            );
            if (startupNameEntry) {
                startup_name = startupNameEntry[1];
            } else {
                startup_name = findField(row, ['startup', 'company', 'name']);
            }
            startup_name = startup_name || 'Unknown Startup';
            const industry = findField(row, ['industry', 'sector']) || null;
            const location = findField(row, ['location', 'city', 'governorate', 'address']) || null;
            const logo_url = findField(row, ['logo']) || null;

            const additionalData = {
                ...row,
                _column_order: headers
            };

            // Extract incoming email and founder name from sheet row using extractPrimaryEmail helper
            const incomingEmail = extractPrimaryEmail(additionalData)?.toLowerCase() || null;
            let incomingFounderName = null;

            for (const [key, val] of Object.entries(row)) {
                const lowerKey = key.toLowerCase();
                if ((lowerKey.includes('full name') || lowerKey.includes('اسمك بالكامل') || lowerKey.includes('founder name')) && typeof val === 'string' && val.trim()) {
                    incomingFounderName = val.trim().toLowerCase();
                    break;
                }
            }

            const incomingStartupName = startup_name.toLowerCase().trim();

            // Match against existing records in database to check for duplication
            const isDuplicate = existingKeysList.some(existing => {
                if (incomingEmail && existing.keys.email && incomingEmail === existing.keys.email) {
                    return true;
                }
                if (incomingStartupName && existing.keys.startupName && incomingStartupName === existing.keys.startupName) {
                    return true;
                }
                if (incomingFounderName && existing.keys.founderName && incomingFounderName === existing.keys.founderName) {
                    return true;
                }
                return false;
            });

            if (!isDuplicate) {
                toInsert.push({
                    event_id: eventId,
                    startup_name,
                    logo_url,
                    industry,
                    location,
                    additional_data: additionalData,
                    status: 'screening'
                });
            }
        }

        let results = { success: true, count: rows.length, inserted: 0, deleted: 0 };

        // 4. Execute Insertion
        if (toInsert.length > 0) {
            const { error: insertError } = await supabase
                .from('company_submissions')
                .insert(toInsert);
            if (insertError) throw insertError;
            results.inserted = toInsert.length;
        }

        return results;
    } catch (error) {
        console.error('[API] syncSubmissionsFromSheet failed:', error);
        throw error;
    }
};

/**
 * Updates the status of a company submission.
 */
export const updateSubmissionStatus = async (submissionId, newStatus, additionalUpdates = {}) => {
    const { data, error } = await supabase
        .from('company_submissions')
        .update({
            status: newStatus,
            reviewed_at: (newStatus === 'approved' || newStatus === 'rejected') ? new Date().toISOString() : null,
            ...additionalUpdates
        })
        .eq('submission_id', submissionId)
        .select()
        .single();

    if (error) throw error; return data;
};

export const updateSlotsOrder = async (slots) => {
    console.log(`[Supabase] Updating ${slots.length} slots sort order (Revise Split Logic)`);
    
    // Separate new slots (to be inserted) from existing slots (to be updated/upserted)
    const newSlots = [];
    const existingSlots = [];

    slots.forEach(slot => {
        const cleaned = { ...slot };
        // Delete any UI-only metadata if it still exists
        delete cleaned.isOptimistic;

        if (!cleaned.slot_id || String(cleaned.slot_id).startsWith('temp-') || cleaned.slot_id === null) {
            delete cleaned.slot_id;
            newSlots.push(cleaned);
        } else {
            existingSlots.push(cleaned);
        }
    });

    try {
        let results = { inserted: [], upserted: [] };

        // 1. Handle New Slots (Insert)
        if (newSlots.length > 0) {
            const { data, error } = await supabase
                .from('agenda_slots')
                .insert(newSlots)
                .select();
            if (error) throw error;
            results.inserted = data;
        }

        // 2. Handle Existing Slots (Upsert)
        if (existingSlots.length > 0) {
            const { data, error } = await supabase
                .from('agenda_slots')
                .upsert(existingSlots)
                .select();
            if (error) throw error;
            results.upserted = data;
        }

        return results;
    } catch (error) {
        console.error('[Supabase Error] updateSlotsOrder Split Logic:', error);
        throw error;
    }
};

export const bulkUpdateExperts = async (updates) => {
    console.log('[Supabase] Bulk updating experts sort order:', updates.length);
    const sanitizedUpdates = updates
        .map(({ expert_id, id, sort_order }) => ({
            expert_id: expert_id || id,
            sort_order
        }))
        .filter(update => update.expert_id);

    if (sanitizedUpdates.length !== updates.length) {
        throw new Error('Some experts are missing expert_id, so sort order could not be saved.');
    }

    const results = await Promise.all(
        sanitizedUpdates.map(({ expert_id, sort_order }) =>
            supabase
                .from('experts')
                .update({ sort_order })
                .eq('expert_id', expert_id)
        )
    );

    const failedResult = results.find(result => result.error);
    if (failedResult?.error) throw failedResult.error;
};

export const bulkUpdateCompanies = async (updates) => {
    console.log('[Supabase] Bulk updating companies sort order:', updates.length);
    const sanitizedUpdates = updates.map(({ company_id, id, sort_order }) => ({
        company_id: company_id || id,
        sort_order
    }));

    const { error } = await supabase
        .from('companies')
        .upsert(sanitizedUpdates, { onConflict: 'company_id' });
    if (error) throw error;
};

// ==========================================
// PROGRAMS (Hierarchical container for events)
// ==========================================

export const getPrograms = () => withCache('programs', async () => {
    console.log('[Supabase] Fetching all programs');
    const { data, error } = await supabase
        .from('programs')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) {
        console.error('[Supabase Error] getPrograms:', error);
        throw error;
    }
    return data || [];
});

export const createProgram = async (name, description = '') => {
    console.log('[Supabase] Creating program:', name);
    const { data, error } = await supabase
        .from('programs')
        .insert({ name: name.trim(), description })
        .select()
        .single();
    if (error) {
        console.error('[Supabase Error] createProgram:', error);
        throw error;
    }
    return data;
};

export const updateProgram = async (programId, updates) => {
    const { data, error } = await supabase
        .from('programs')
        .update(updates)
        .eq('program_id', programId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const deleteProgram = async (programId) => {
    // Events with this program_id will have program_id set to NULL (ON DELETE SET NULL)
    const { error } = await supabase
        .from('programs')
        .delete()
        .eq('program_id', programId);
    if (error) throw error;
    return { success: true };
};

export const assignEventToProgram = async (eventId, programId) => {
    // programId can be null to unassign
    const { data, error } = await supabase
        .from('events')
        .update({ program_id: programId })
        .eq('event_id', eventId)
        .select()
        .single();
    if (error) throw error;
    return data;
};
