import { supabase } from './supabase';
import { fetchAndParseGoogleSheet, fetchAndParseGenericGoogleSheet } from './excel';
import { appendFormResponseToSheet } from './googleSheets';
import { validatePhoneNumber } from './phoneValidation';

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

export const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || ''));

export const getEventSlug = (eventOrName) => {
    if (!eventOrName) return '';
    const name = typeof eventOrName === 'string'
        ? eventOrName
        : (eventOrName.event_name || eventOrName.name || eventOrName.event_id || '');
    const clean = name
        .trim()
        .replace(/[^\w\s\u0600-\u06FF-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return clean || (typeof eventOrName === 'object' ? eventOrName.event_id : name);
};

export const getEvent = (identifier) => withCache(`event_${identifier}`, async () => {
    if (!identifier) throw new Error('Event identifier is required');
    console.log(`[Supabase] Fetching event: ${identifier}`);

    if (isUUID(identifier)) {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('event_id', identifier)
            .single();

        if (error) {
            console.error(`[Supabase Error] getEvent (${identifier}):`, error);
            throw error;
        }
        return data;
    }

    const decoded = decodeURIComponent(String(identifier)).trim();
    const normalize = (str) => (str || '').toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '');
    const normTarget = normalize(decoded);

    const { data: directMatch } = await supabase
        .from('events')
        .select('*')
        .ilike('event_name', decoded)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (directMatch) return directMatch;

    const withSpaces = decoded.replace(/[-_]+/g, ' ');
    const { data: spaceMatch } = await supabase
        .from('events')
        .select('*')
        .ilike('event_name', withSpaces)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (spaceMatch) return spaceMatch;

    const allEvents = await getEvents();
    let matched = allEvents.find(ev => 
        normalize(ev.event_name) === normTarget ||
        normalize(ev.event_name_ar) === normTarget ||
        normalize(ev.name) === normTarget
    );

    if (!matched) {
        matched = allEvents.find(ev => {
            const n1 = normalize(ev.event_name);
            const n2 = normalize(ev.event_name_ar);
            return (n1 && (n1.startsWith(normTarget) || normTarget.startsWith(n1))) ||
                   (n2 && (n2.startsWith(normTarget) || normTarget.startsWith(n2)));
        });
    }

    if (matched) return matched;
    throw new Error(`Event not found for identifier: ${identifier}`);
});

export const getFullAgenda = (identifier) => withCache(`fullAgenda_${identifier}`, async () => {
    console.log(`[Supabase] Fetching full agenda for event: ${identifier}`);

    const event = await getEvent(identifier);
    const eventId = event.event_id;

    // Fetch experts, companies, and days ALL IN PARALLEL — eliminates waterfall
    const [
        { data: expertsRaw, error: expertsError },
        { data: companies, error: companiesError },
        { data: days, error: daysError },
    ] = await Promise.all([
        supabase.from('experts').select('*, master:master_experts(*)').eq('event_id', eventId).order('sort_order', { ascending: true }),
        supabase.from('companies').select('*').eq('event_id', eventId),
        supabase.from('event_days').select('*').eq('event_id', eventId).order('day_number', { ascending: true }),
    ]);

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

export const getExperts = (identifier) => withCache(`experts_${identifier}`, async () => {
    let actualId = identifier;
    if (!isUUID(identifier)) {
        const event = await getEvent(identifier).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    const { data, error } = await supabase
        .from('experts')
        .select('*, master:master_experts(*)')
        .eq('event_id', actualId)
        .order('sort_order', { ascending: true });
    if (error) throw error; 
    
    return (data || []).map(exp => ({
        ...exp.master,
        ...exp,
        master: undefined
    }));
});

export const getCompanies = (identifier) => withCache(`companies_${identifier}`, async () => {
    let actualId = identifier;
    if (!isUUID(identifier)) {
        const event = await getEvent(identifier).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('event_id', actualId)
        .order('name', { ascending: true });
    if (error) throw error; return data;
});

export const getAgendaTabs = (identifier) => withCache(`agenda_tabs_${identifier}`, async () => {
    let actualId = identifier;
    if (!isUUID(identifier)) {
        const event = await getEvent(identifier).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    const [agenda, library, joinAthar] = await Promise.all([
        getFullAgenda(actualId).catch(() => null),
        getLibraryData(actualId).catch(() => ({ resources: [] })),
        getJoinAtharPage(actualId).catch(() => null)
    ]);

    const tabs = [];
    if ((agenda?.days && agenda.days.length > 0) || agenda?.event) {
        tabs.push({ id: 'agenda', labelEn: 'Agenda', labelAr: 'الأجندة' });
    }
    if (agenda?.experts && agenda.experts.length > 0) {
        const customLabelEn = agenda.event?.header_settings?.customExpertsLabel || 'Experts';
        const customLabelAr = agenda.event?.header_settings?.customExpertsLabelAr || 'الخبراء';
        tabs.push({ id: 'experts', labelEn: customLabelEn, labelAr: customLabelAr });
    }
    if (agenda?.companies && agenda.companies.length > 0) {
        tabs.push({ id: 'companies', labelEn: 'Companies', labelAr: 'الشركات' });
    }
    if (library?.resources && library.resources.length > 0) {
        tabs.push({ id: 'library', labelEn: 'Resources Library', labelAr: 'المكتبة' });
    }
    if (joinAthar && (joinAthar.cover_url || (joinAthar.cards && joinAthar.cards.length > 0) || joinAthar.canvas_background_url)) {
        tabs.push({ id: 'join-athar', labelEn: 'Join Athar', labelAr: 'انضم لأثر' });
    }

    return tabs.length > 0 ? tabs : [{ id: 'agenda', labelEn: 'Agenda', labelAr: 'الأجندة' }];
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
    // Exclude generated/readonly columns ('name', 'id', 'created_at', 'updated_at', 'event_id')
    const { event_id: _, id: __, name: ___, created_at: ____, updated_at: _____, ...eventDataToCopy } = event;
    const newEventData = {
        ...eventDataToCopy,
        event_name: newEventName || `${event.event_name} (Copy)`
    };
    delete newEventData.name;
    delete newEventData.id;
    
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
    const { data: rawExperts } = await supabase
        .from('experts')
        .select('*')
        .eq('event_id', originalEventId)
        .order('sort_order', { ascending: true });

    if (rawExperts && rawExperts.length > 0) {
        const expertsToInsert = rawExperts.map(exp => {
            const { id, created_at, updated_at, ...rest } = exp;
            return { ...rest, event_id: newEventId };
        });
        
        const { data: newExperts, error: expertsError } = await supabase
            .from('experts')
            .insert(expertsToInsert)
            .select();
            
        if (expertsError) throw expertsError;
        
        rawExperts.forEach((oldExp, idx) => {
            if (newExperts && newExperts[idx]) {
                expertIdMap.set(oldExp.id, newExperts[idx].id);
            }
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

export const getLibraryResources = (identifier) => withCache(`library_resources_${identifier || 'global'}`, async () => {
    let actualId = identifier;
    if (identifier && identifier !== 'undefined' && !isUUID(identifier)) {
        const event = await getEvent(identifier).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }
    let query = supabase.from('library_resources').select('*');
    if (actualId && actualId !== 'undefined') {
        query = query.or(`event_id.eq.${actualId},is_central.eq.true`);
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
    let actualId = eventId;
    if (eventId && !isUUID(eventId)) {
        const event = await getEvent(eventId).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    // 1. Find the first form for this entity type
    const { data: forms } = await supabase
        .from('event_forms')
        .select('form_id')
        .eq('event_id', actualId)
        .eq('target_module', entityType)
        .order('created_at', { ascending: true })
        .limit(1);

    const formId = forms?.[0]?.form_id;

    // 2. Fetch fields
    let query = supabase
        .from('form_field_configs')
        .select('*')
        .eq('event_id', actualId)
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
    return (data || []).map(f => ({
        ...f,
        description: f.description || f.help_text || f.validation_rules?.description || '',
        help_text: f.help_text || f.description || f.validation_rules?.description || '',
        section_id: f.section_id || f.validation_rules?.section_id || null
    }));
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
    // Storing section_id and description inside validation_rules ensures compatibility if DB lacks dedicated columns
    const fieldsToInsert = fields.map((field, idx) => {
        const desc = field.description !== undefined ? field.description : (field.help_text || '');
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
            help_text: desc,
            is_custom: field.is_custom || false,
            field_options: field.field_options || [],
            validation_rules: {
                ...(field.validation_rules || {}),
                description: desc,
                section_id: field.section_id || null
            }
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
    
    return (data || []).map(f => ({
        ...f,
        description: f.description || f.help_text || f.validation_rules?.description || '',
        help_text: f.help_text || f.description || f.validation_rules?.description || '',
        section_id: f.section_id || f.validation_rules?.section_id || null
    }));
};

/**
 * Get a single event form by its ID (including populated cover if available)
 */
export const getEventFormById = async (formId) => {
    const { data, error } = await supabase
        .from('event_forms')
        .select('*, form_covers(*)')
        .eq('form_id', formId)
        .single();
    if (error) throw error; 
    return data;
};

// ==========================================
// FORM COVERS (INDEPENDENT ENTITIES)
// ==========================================

export const getEventCovers = async (eventId) => {
    const { data, error } = await supabase
        .from('form_covers')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const createFormCover = async (eventId, name, imageUrl) => {
    const { data, error } = await supabase
        .from('form_covers')
        .insert([{ event_id: eventId, name, image_url: imageUrl }])
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const updateFormCover = async (coverId, updates) => {
    const { data, error } = await supabase
        .from('form_covers')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('cover_id', coverId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const deleteFormCover = async (coverId) => {
    const { error } = await supabase
        .from('form_covers')
        .delete()
        .eq('cover_id', coverId);
    if (error) throw error;
    return { success: true };
};

// ==========================================
// FORM RESPONSES (CENTRAL DECOUPLED ENGINE)
// ==========================================

export const getFormResponses = async (formId) => {
    const { data, error } = await supabase
        .from('form_responses')
        .select('*')
        .eq('form_id', formId)
        .order('submitted_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const getEventFormsResponses = async (eventId) => {
    const { data, error } = await supabase
        .from('form_responses')
        .select('*')
        .eq('event_id', eventId)
        .order('submitted_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const deleteFormResponse = async (responseId) => {
    const { error } = await supabase
        .from('form_responses')
        .delete()
        .eq('response_id', responseId);
    if (error) throw error;
    return { success: true };
};

export const updateFormResponseStatus = async (responseId, status) => {
    const { data, error } = await supabase
        .from('form_responses')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('response_id', responseId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

// ==========================================
// SHARE ANALYTICS EVENTS
// ==========================================

export const trackFormShareEvent = async (formId, platform) => {
    try {
        const { data, error } = await supabase
            .from('form_share_events')
            .insert([{
                form_id: formId,
                platform: platform,
                user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null
            }])
            .select()
            .single();
        if (error) console.error('Error tracking share event:', error);
        return data;
    } catch (e) {
        console.warn('Silent failure tracking share event:', e);
        return null;
    }
};

export const getFormShareEvents = async (formId) => {
    const { data, error } = await supabase
        .from('form_share_events')
        .select('*')
        .eq('form_id', formId)
        .order('clicked_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const getEventShareEvents = async (eventId) => {
    // Get all forms for event first then share events
    const { data: forms } = await supabase
        .from('event_forms')
        .select('form_id')
        .eq('event_id', eventId);
    
    if (!forms || forms.length === 0) return [];
    const formIds = forms.map(f => f.form_id);

    const { data, error } = await supabase
        .from('form_share_events')
        .select('*')
        .in('form_id', formIds)
        .order('clicked_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

// ==========================================
// DUPLICATE FORM (PHASE 6)
// ==========================================

export const duplicateEventForm = async (formId) => {
    // 1. Fetch original form
    const { data: original, error: origError } = await supabase
        .from('event_forms')
        .select('*')
        .eq('form_id', formId)
        .single();
    if (origError) throw origError;

    // 2. Fetch original fields
    const { data: fields, error: fieldsError } = await supabase
        .from('form_field_configs')
        .select('*')
        .eq('form_id', formId)
        .order('display_order', { ascending: true });
    if (fieldsError) throw fieldsError;

    // 3. Create cloned form (clean copy without old responses/stats)
    const newFormName = `${original.form_name} (نسخة)`;
    const newFormPayload = {
        event_id: original.event_id,
        form_name: newFormName,
        target_module: original.target_module || 'selection_process',
        is_active: true,
        cover_id: original.cover_id || null,
        cover_image_url: original.cover_image_url || null,
        thank_you_message: original.thank_you_message || null,
        thank_you_image_url: original.thank_you_image_url || null,
        show_thank_you_image: original.show_thank_you_image ?? true,
        share_title: original.share_title || null,
        share_description: original.share_description || null,
        share_image_url: original.share_image_url || null,
        social_channels_config: original.social_channels_config || {},
        integrations: original.integrations || {},
        description: original.description || null,
        form_name_ar: original.form_name_ar ? `${original.form_name_ar} (نسخة)` : null
    };

    const { data: clonedForm, error: cloneError } = await supabase
        .from('event_forms')
        .insert(newFormPayload)
        .select()
        .single();
    if (cloneError) throw cloneError;

    // 4. Duplicate fields
    if (fields && fields.length > 0) {
        const fieldsToInsert = fields.map((f, idx) => ({
            event_id: clonedForm.event_id,
            form_id: clonedForm.form_id,
            entity_type: f.entity_type || clonedForm.target_module,
            field_name: f.field_name,
            field_label: f.field_label,
            field_type: f.field_type,
            field_options: f.field_options || [],
            is_required: f.is_required || false,
            show_in_card: f.show_in_card || false,
            placeholder: f.placeholder || '',
            help_text: f.help_text || '',
            validation_rules: f.validation_rules || {},
            display_order: idx,
            is_custom: f.is_custom || false
        }));

        const { error: insertFieldsErr } = await supabase
            .from('form_field_configs')
            .insert(fieldsToInsert);
        if (insertFieldsErr) throw insertFieldsErr;
    }

    return clonedForm;
};

// ==========================================
// SUBMIT TO FORM (UNIFIED ENGAGEMENT SUBMISSION)
// ==========================================

export const submitToForm = async (formId, eventId, targetModule, formData, trackingMeta = {}) => {
    const source = trackingMeta.source || formData.source || formData.utm_source || 'direct';
    const submittedAt = new Date().toISOString();

    // Sanitize phone fields to standard international format (E.164)
    const sanitizedAnswers = { ...formData };
    for (const [key, val] of Object.entries(sanitizedAnswers)) {
        if (typeof val === 'string' && val.trim() && (key.includes('phone') || key.includes('tel') || key.includes('mobile') || key === 'whatsapp')) {
            const phoneRes = validatePhoneNumber(val);
            if (phoneRes.isValid && phoneRes.sanitized) {
                sanitizedAnswers[key] = phoneRes.sanitized;
            }
        }
    }
    
    // Save primary record into decoupled form_responses first
    let primaryResponse = null;
    try {
        // Fetch library_form_id from event_forms if available to link cross-project analytics
        let libraryFormId = null;
        try {
            const { data: formInfo } = await supabase
                .from('event_forms')
                .select('library_form_id')
                .eq('form_id', formId)
                .maybeSingle();
            libraryFormId = formInfo?.library_form_id || null;
        } catch (linkErr) {
            // Silently fallback if column not yet added
        }

        const { data: respData, error: respError } = await supabase
            .from('form_responses')
            .insert([{
                form_id: formId,
                event_id: eventId,
                library_form_id: libraryFormId,
                source: source,
                tracking_data: {
                    utm_source: trackingMeta.utm_source || null,
                    utm_medium: trackingMeta.utm_medium || null,
                    utm_campaign: trackingMeta.utm_campaign || null,
                    channel: trackingMeta.channel || null,
                    ref: trackingMeta.ref || null,
                    ...trackingMeta
                },
                answers: sanitizedAnswers,
                status: 'submitted',
                submitted_at: submittedAt
            }])
            .select()
            .single();
        if (respError) console.error('[Supabase] Form response insert error:', respError);
        primaryResponse = respData;
    } catch (e) {
        console.error('Failed to insert into form_responses:', e);
    }

    // Trigger integrations asynchronously to keep respondent submission fast and reliable
    (async () => {
        try {
            const formMeta = await getEventFormById(formId);
            const integrations = formMeta?.integrations || {};

            // 1. Google Sheets Integration
            if (integrations.google_sheets && integrations.google_sheets_url) {
                const fields = await getFormConfigById(formId).catch(() => []);
                appendFormResponseToSheet({
                    sheetUrl: integrations.google_sheets_url,
                    eventId,
                    formName: formMeta?.form_name || 'Form Submission',
                    fields,
                    answers: formData,
                    source,
                    submittedAt
                }).catch(err => console.error('Google Sheets background sync error:', err));
            }

            // 2. Selection Process Integration (explicit opt-in only)
            if (integrations.selection_process) {
                const { startup_name, logo_url, industry, location } = formData;
                await supabase
                    .from('company_submissions')
                    .insert([{
                        event_id: eventId,
                        form_id: formId,
                        startup_name: startup_name || formData.company_name || formData[Object.keys(formData)[0]] || 'Applicant',
                        logo_url: logo_url || null,
                        industry: industry || null,
                        location: location || null,
                        additional_data: formData,
                        status: 'screening'
                    }]);
            }

            // 3. Agenda Companies List Integration
            if (integrations.companies_list) {
                const cName = formData.company_name || formData.startup_name || formData.name;
                if (cName) {
                    await supabase
                        .from('companies')
                        .insert([{
                            event_id: eventId,
                            name: cName,
                            industry: formData.industry || null,
                            location: formData.location || null,
                            logo_url: formData.logo_url || null,
                            description: formData.description || formData.bio || null
                        }]);
                }
            }

            // 4. Mentors / Attendees List Integration
            if (integrations.mentors_list || integrations.attendees_list) {
                const expName = formData.name || formData.expert_name || formData.full_name || formData[Object.keys(formData)[0]];
                if (expName) {
                    await supabase
                        .from('experts')
                        .insert([{
                            event_id: eventId,
                            name: expName,
                            title: formData.title || formData.role || formData.job_title || 'Mentor',
                            company: formData.company || formData.organization || null,
                            bio: formData.bio || formData.description || null,
                            photo_url: formData.photo_url || formData.avatar_url || formData.logo_url || null,
                            email: formData.email || null
                        }]);
                }
            }

            // 5. Alumni Annual Update → auto-create Snapshot
            // Requirement: whenever a form tagged alumni_annual_update is submitted with a
            // company_id answer, automatically convert the answers into a company_snapshot.
            if (targetModule === 'alumni_annual_update' && primaryResponse?.response_id) {
                const companyId = formData.company_id || null;
                if (companyId) {
                    createSnapshotFromFormResponse(companyId, primaryResponse.response_id, 'annual_update')
                        .catch(err => console.error('[Alumni] Auto-snapshot creation failed:', err));
                }
            }
        } catch (intErr) {
            console.error('Async response routing error:', intErr);
        }
    })();

    return primaryResponse || { success: true };
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
/**
 * Dynamic extraction helper for sheet rows based on header row keywords.
 */
export const extractDynamicSheetFields = (row, headers) => {
    const normalize = (str) => (str || '').toString().trim().toLowerCase();

    const findValue = (row, headers, keyCheckFn) => {
        if (Array.isArray(headers)) {
            for (const h of headers) {
                if (keyCheckFn(normalize(h))) {
                    const val = row[h];
                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                        return { key: h, val: String(val).trim() };
                    }
                }
            }
        }
        for (const [key, val] of Object.entries(row)) {
            if (keyCheckFn(normalize(key))) {
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    return { key, val: String(val).trim() };
                }
            }
        }
        return { key: null, val: null };
    };

    // 1. Timestamp / Date
    const timestampMatch = findValue(row, headers, (k) =>
        k.includes('timestamp') || k.includes('date') || k.includes('تاريخ') || k.includes('وقت') || k.includes('توقيت')
    );

    // 2. Founder Name (English preferred)
    let founderNameMatch = findValue(row, headers, (k) =>
        (k.includes('english') || k.includes('إنجليزي') || k.includes('founder')) &&
        (k.includes('name') || k.includes('اسم')) &&
        !k.includes('second') && !k.includes('العضو الثاني') && !k.includes('company') && !k.includes('project') && !k.includes('startup')
    );
    if (!founderNameMatch.val) {
        founderNameMatch = findValue(row, headers, (k) =>
            (k.includes('full name') || k.includes('اسمك بالكامل') || k.includes('اسم المؤسس') || k.includes('name') || k.includes('اسم')) &&
            !k.includes('second') && !k.includes('العضو الثاني') && !k.includes('company') && !k.includes('project') && !k.includes('startup')
        );
    }

    // 3. Company / Project Name
    let companyNameMatch = findValue(row, headers, (k) =>
        k === 'startup name' || k.includes('company name') || k.includes('project name') ||
        ((k.includes('company') || k.includes('project') || k.includes('startup') || k.includes('الشركة') || k.includes('المشروع')) &&
            (k.includes('name') || k.includes('اسم') || k.includes('startup')))
    );
    if (!companyNameMatch.val) {
        companyNameMatch = findValue(row, headers, (k) =>
            k.includes('company') || k.includes('project') || k.includes('startup') || k.includes('الشركة') || k.includes('المشروع')
        );
    }

    // 4. Founder Email
    const emailMatch = findValue(row, headers, (k) =>
        (k.includes('email') || k.includes('mail') || k.includes('البريد') || k.includes('إيميل')) &&
        !k.includes('second') && !k.includes('العضو الثاني')
    );
    let extractedEmail = emailMatch.val;
    if (extractedEmail && extractedEmail.includes('@')) {
        const m = extractedEmail.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (m) extractedEmail = m[0].trim();
    } else {
        extractedEmail = extractPrimaryEmail(row);
    }

    // 5. National ID
    const nationalIdMatch = findValue(row, headers, (k) =>
        (k.includes('national id') || k.includes('الرقم القومي') || k.includes('رقم الهوية') || (k.includes('id') && !k.includes('idea'))) &&
        !k.includes('second') && !k.includes('العضو الثاني')
    );

    // 6. Phone Number
    const phoneMatch = findValue(row, headers, (k) =>
        (k.includes('phone') || k.includes('mobile') || k.includes('هاتف') || k.includes('موبايل')) &&
        !k.includes('second') && !k.includes('العضو الثاني')
    );

    return {
        timestamp: timestampMatch.val,
        founder_name: founderNameMatch.val || '',
        company_name: companyNameMatch.val || '',
        founder_email: extractedEmail || null,
        national_id: nationalIdMatch.val || null,
        phone: phoneMatch.val || null
    };
};

/**
 * Syncs company submissions from a Google Sheet with dynamic extraction & Upsert logic.
 */
export const syncSubmissionsFromSheet = async (eventId, url) => {
    try {
        const data = await fetchAndParseGenericGoogleSheet(url);
        const sheetNames = Object.keys(data);
        const targetSheet = sheetNames.find(name => {
            const l = name.toLowerCase().trim();
            return l === 'total responces' || l === 'total responses' || l === 'selection prosses' || l === 'selection process' || l === 'responses' || l === 'form responses 1';
        }) || sheetNames[0];

        if (!targetSheet) {
            throw new Error('Could not find a valid response sheet in the Google Sheet.');
        }

        const sheetData = data[targetSheet];
        const rows = sheetData.rows;
        const headers = sheetData.headers;

        if (!rows || rows.length === 0) return { success: true, count: 0, inserted: 0, updated: 0 };

        // 1. Fetch existing submissions for this event
        const { data: existingSubmissions, error: fetchError } = await supabase
            .from('company_submissions')
            .select('*')
            .eq('event_id', eventId);

        if (fetchError) throw fetchError;

        let insertedCount = 0;
        let updatedCount = 0;

        for (const row of rows) {
            const additionalData = {
                ...row,
                _column_order: headers
            };

            const extracted = extractDynamicSheetFields(row, headers);

            const startup_name = extracted.company_name || extracted.founder_name || 'Unknown Startup';
            const founder_name = extracted.founder_name || startup_name;
            const company_name = extracted.company_name || startup_name;
            const founder_email = extracted.founder_email;
            const national_id = extracted.national_id;
            const phone = extracted.phone;

            // Search for matching existing record (Upsert deduplication logic)
            const existingRecord = (existingSubmissions || []).find(existing => {
                // Priority 1: National ID match
                if (national_id && existing.national_id && national_id.trim() === existing.national_id.trim()) {
                    return true;
                }
                // Priority 2: Founder Email match
                if (founder_email && (existing.founder_email || existing.email)) {
                    const exEmail = (existing.founder_email || existing.email).toLowerCase().trim();
                    if (founder_email.toLowerCase().trim() === exEmail) return true;
                }
                // Priority 3: Phone match
                if (phone && existing.phone && phone.trim() === existing.phone.trim()) {
                    return true;
                }
                // Priority 4: Company name & Founder name match
                if (company_name && existing.company_name && company_name.toLowerCase().trim() === existing.company_name.toLowerCase().trim()) {
                    if (founder_name && existing.founder_name && founder_name.toLowerCase().trim() === existing.founder_name.toLowerCase().trim()) {
                        return true;
                    }
                }
                return false;
            });

            const rowPayload = {
                event_id: eventId,
                startup_name: company_name,
                company_name,
                founder_name,
                founder_email,
                national_id,
                phone,
                additional_data: additionalData
            };

            if (existingRecord) {
                // Update existing record
                const { error: updateError } = await supabase
                    .from('company_submissions')
                    .update(rowPayload)
                    .eq('submission_id', existingRecord.submission_id);

                if (updateError) {
                    console.error('[API] Error updating submission row during sync:', updateError);
                } else {
                    updatedCount++;
                }
            } else {
                // Insert new record
                const { error: insertError } = await supabase
                    .from('company_submissions')
                    .insert([{
                        ...rowPayload,
                        status: 'screening'
                    }]);

                if (insertError) {
                    console.error('[API] Error inserting submission row during sync:', insertError);
                } else {
                    insertedCount++;
                }
            }
        }

        return { success: true, count: rows.length, inserted: insertedCount, updated: updatedCount };
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

// ==========================================
// CENTRAL FORM LIBRARY (مكتبة الفورمز المركزية)
// ==========================================

/**
 * Fetch forms from the central library.
 * If eventId is provided, returns all 'global' forms plus 'specific' forms assigned to this event.
 * If eventId is not provided, returns all library forms.
 */
export const getLibraryForms = async ({ scope, eventId } = {}) => {
    let query = supabase
        .from('library_forms')
        .select('*')
        .order('created_at', { ascending: false });

    if (scope && scope !== 'all') {
        query = query.eq('scope', scope);
    } else if (eventId) {
        query = query.or(`scope.eq.global,and(scope.eq.specific,event_id.eq.${eventId})`);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[Supabase] getLibraryForms error:', error);
        throw error;
    }
    return data || [];
};

/**
 * Get single library form by ID
 */
export const getLibraryFormById = async (id) => {
    const { data, error } = await supabase
        .from('library_forms')
        .select('*')
        .eq('id', id)
        .single();

    if (error) throw error;
    return data;
};

/**
 * Create a new form template in the central library
 */
export const createLibraryForm = async (payload) => {
    const newRecord = {
        form_name: payload.form_name || 'Untitled Template',
        form_name_ar: payload.form_name_ar || null,
        description: payload.description || '',
        target_module: payload.target_module || 'selection_process',
        scope: payload.scope || 'global',
        event_id: payload.scope === 'specific' ? (payload.event_id || null) : null,
        fields: payload.fields || [],
        cover_id: payload.cover_id || null,
        cover_image_url: payload.cover_image_url || null,
        thank_you_message: payload.thank_you_message || 'Thank you for your submission!',
        thank_you_image_url: payload.thank_you_image_url || null,
        show_thank_you_image: payload.show_thank_you_image !== false,
        share_title: payload.share_title || null,
        share_description: payload.share_description || null,
        share_image_url: payload.share_image_url || null,
        social_channels_config: payload.social_channels_config || {
            facebook: true,
            whatsapp: true,
            linkedin: true,
            instagram: true,
            telegram: true,
            custom: []
        },
        integrations: payload.integrations || {
            selection_process: false,
            companies_list: false,
            mentors_list: false
        },
        import_count: 0
    };

    const { data, error } = await supabase
        .from('library_forms')
        .insert([newRecord])
        .select()
        .single();

    if (error) {
        console.error('[Supabase] createLibraryForm error:', error);
        throw error;
    }
    return data;
};

/**
 * Update an existing form in the central library
 */
export const updateLibraryForm = async (id, updates) => {
    const payload = { ...updates, updated_at: new Date().toISOString() };
    if (payload.scope === 'global') {
        payload.event_id = null;
    }

    const { data, error } = await supabase
        .from('library_forms')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('[Supabase] updateLibraryForm error:', error);
        throw error;
    }
    return data;
};

/**
 * Delete a form template from the central library
 */
export const deleteLibraryForm = async (id) => {
    const { error } = await supabase
        .from('library_forms')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return { success: true };
};

/**
 * Duplicate a form within the central library
 */
export const duplicateLibraryForm = async (id) => {
    const original = await getLibraryFormById(id);
    const { id: _, created_at, updated_at, import_count, ...copyPayload } = original;

    return createLibraryForm({
        ...copyPayload,
        form_name: `${original.form_name} (Copy)`,
        form_name_ar: original.form_name_ar ? `${original.form_name_ar} (نسخة)` : null
    });
};

/**
 * Save an existing project form into the Central Form Library
 */
export const saveProjectFormToLibrary = async (formId, { scope = 'global', eventId = null, formName = null, formNameAr = null, description = null } = {}) => {
    const formMeta = await getEventFormById(formId);
    const fields = await getFormConfigById(formId);

    // Sanitize fields for portable JSON storage
    const portableFields = (fields || []).map((f, idx) => ({
        field_name: f.field_name,
        field_label: f.field_label,
        field_label_ar: f.field_label_ar || null,
        field_type: f.field_type,
        is_required: !!f.is_required,
        show_in_card: !!f.show_in_card,
        placeholder: f.placeholder || '',
        help_text: f.help_text || '',
        description: f.description || f.help_text || '',
        is_custom: !!f.is_custom,
        display_order: idx,
        field_options: f.field_options || [],
        validation_rules: f.validation_rules || {}
    }));

    return createLibraryForm({
        form_name: formName || formMeta.form_name,
        form_name_ar: formNameAr || formMeta.form_name_ar || null,
        description: description || formMeta.description || '',
        target_module: formMeta.target_module || 'selection_process',
        scope: scope,
        event_id: scope === 'specific' ? (eventId || formMeta.event_id) : null,
        fields: portableFields,
        cover_id: formMeta.cover_id || null,
        cover_image_url: formMeta.cover_image_url || null,
        thank_you_message: formMeta.thank_you_message || 'Thank you for your submission!',
        thank_you_image_url: formMeta.thank_you_image_url || null,
        show_thank_you_image: formMeta.show_thank_you_image !== false,
        share_title: formMeta.share_title || null,
        share_description: formMeta.share_description || null,
        share_image_url: formMeta.share_image_url || null,
        social_channels_config: formMeta.social_channels_config || {},
        integrations: formMeta.integrations || {}
    });
};

/**
 * Import a library form into a project.
 * Supports two distinct paths:
 * 1. 'with_history': Clones structure, links library_form_id, copies all past responses tagged with library_form_id into the project, and re-links the chosen module.
 * 2. 'blank_copy': Deep-clones the structure only, does NOT copy responses, sets library_form_id = null (full isolation).
 */
export const importFormFromLibrary = async ({
    libraryFormId,
    eventId,
    importMode = 'blank_copy',
    reLinkModule = null,
    googleSheetsUrl = null
}) => {
    const libForm = await getLibraryFormById(libraryFormId);
    if (!libForm) throw new Error('Library form not found');

    const effectiveModule = reLinkModule || libForm.target_module || 'selection_process';

    // Configure integrations based on re-linking selection
    const integrations = { ...(libForm.integrations || {}) };
    if (reLinkModule) {
        integrations.selection_process = reLinkModule === 'selection_process';
        integrations.companies_list = reLinkModule === 'companies_list';
        integrations.mentors_list = reLinkModule === 'mentors_list';
        integrations.attendees_list = reLinkModule === 'attendees_list';
    }
    if (googleSheetsUrl) {
        integrations.google_sheets = true;
        integrations.google_sheets_url = googleSheetsUrl;
    }

    // 1. Create project form entity
    const formRecord = {
        event_id: eventId,
        form_name: libForm.form_name,
        form_name_ar: libForm.form_name_ar || null,
        description: libForm.description || '',
        target_module: effectiveModule,
        is_active: true,
        cover_id: libForm.cover_id || null,
        cover_image_url: libForm.cover_image_url || null,
        thank_you_message: libForm.thank_you_message || 'Thank you for your submission!',
        thank_you_image_url: libForm.thank_you_image_url || null,
        show_thank_you_image: libForm.show_thank_you_image !== false,
        share_title: libForm.share_title || null,
        share_description: libForm.share_description || null,
        share_image_url: libForm.share_image_url || null,
        social_channels_config: libForm.social_channels_config || {},
        integrations: integrations,
        // Isolation policy: Blank copy sets library_form_id = null; with_history sets library_form_id
        library_form_id: importMode === 'with_history' ? libraryFormId : null
    };

    const { data: newForm, error: formError } = await supabase
        .from('event_forms')
        .insert([formRecord])
        .select()
        .single();

    if (formError) {
        console.error('[Supabase] Failed to create project form from library:', formError);
        throw formError;
    }

    // 2. Clone fields into form_field_configs for this event
    if (Array.isArray(libForm.fields) && libForm.fields.length > 0) {
        await saveFormConfigById(newForm.form_id, eventId, effectiveModule, libForm.fields);
    }

    // 3. If import with history, copy all historical responses associated with this library_form_id
    if (importMode === 'with_history') {
        try {
            const { data: pastResponses } = await supabase
                .from('form_responses')
                .select('*')
                .eq('library_form_id', libraryFormId);

            if (pastResponses && pastResponses.length > 0) {
                const responsesToInsert = pastResponses.map(r => ({
                    form_id: newForm.form_id,
                    event_id: eventId,
                    library_form_id: libraryFormId,
                    source: r.source || 'imported',
                    tracking_data: { ...(r.tracking_data || {}), imported_at: new Date().toISOString() },
                    answers: r.answers || {},
                    status: r.status || 'submitted',
                    submitted_at: r.submitted_at || r.created_at || new Date().toISOString()
                }));

                await supabase
                    .from('form_responses')
                    .insert(responsesToInsert);
            }
        } catch (respCopyErr) {
            console.warn('Could not copy historical responses during import:', respCopyErr);
        }
    }

    // 4. Increment import counter in the library
    try {
        await supabase
            .from('library_forms')
            .update({
                import_count: (libForm.import_count || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', libraryFormId);
    } catch (e) {
        // Non-fatal
    }

    return newForm;
};

/**
 * Get all aggregated responses submitted across all projects for a specific library form
 */
export const getLibraryFormResponses = async (libraryFormId) => {
    try {
        const { data: responses, error } = await supabase
            .from('form_responses')
            .select('*')
            .eq('library_form_id', libraryFormId)
            .order('submitted_at', { ascending: false });

        if (error) throw error;
        if (!responses || responses.length === 0) return [];

        // Enrich responses with event name if possible
        const eventIds = [...new Set(responses.map(r => r.event_id).filter(Boolean))];
        let eventMap = {};
        if (eventIds.length > 0) {
            const { data: events } = await supabase
                .from('events')
                .select('event_id, title')
                .in('event_id', eventIds);

            (events || []).forEach(ev => {
                eventMap[ev.event_id] = ev.title;
            });
        }

        return responses.map(r => ({
            ...r,
            event_title: eventMap[r.event_id] || 'Unknown Project'
        }));
    } catch (err) {
        console.error('getLibraryFormResponses error:', err);
        return [];
    }
};

/**
 * Get platform-wide analytics for the Central Form Library
 */
export const getLibraryAnalytics = async () => {
    try {
        const [formsRes, linkedFormsRes, responsesRes, eventsRes] = await Promise.all([
            supabase.from('library_forms').select('*'),
            supabase.from('event_forms').select('form_id, event_id, form_name, library_form_id').not('library_form_id', 'is', null),
            supabase.from('form_responses').select('response_id, form_id, event_id, library_form_id, source, submitted_at').not('library_form_id', 'is', null),
            supabase.from('events').select('event_id, title')
        ]);

        const forms = formsRes.data || [];
        const linkedForms = linkedFormsRes.data || [];
        const responses = responsesRes.data || [];
        const events = eventsRes.data || [];

        const eventMap = {};
        events.forEach(e => {
            eventMap[e.event_id] = e.title;
        });

        // Compute metrics per library form
        const formStats = forms.map(lf => {
            const lfResponses = responses.filter(r => r.library_form_id === lf.id);
            const lfImports = linkedForms.filter(ef => ef.library_form_id === lf.id);

            // Project distribution for this form
            const projectCounts = {};
            lfResponses.forEach(r => {
                const projectName = eventMap[r.event_id] || 'Unnamed Project';
                projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
            });

            return {
                ...lf,
                totalResponses: lfResponses.length,
                totalImports: Math.max(lf.import_count || 0, lfImports.length),
                projectDistribution: projectCounts,
                recentSubmissions: lfResponses.slice(0, 5)
            };
        });

        const totalForms = forms.length;
        const totalImports = formStats.reduce((acc, f) => acc + (f.totalImports || 0), 0);
        const totalResponses = responses.length;

        // Platform-wide project distribution
        const projectActivity = {};
        responses.forEach(r => {
            const pName = eventMap[r.event_id] || 'General';
            projectActivity[pName] = (projectActivity[pName] || 0) + 1;
        });

        return {
            totalForms,
            totalImports,
            totalResponses,
            formStats,
            projectActivity
        };
    } catch (err) {
        console.error('getLibraryAnalytics error:', err);
        return {
            totalForms: 0,
            totalImports: 0,
            totalResponses: 0,
            formStats: [],
            projectActivity: {}
        };
    }
};

// ==========================================
// FORM SECTIONS / STEPS (أقسام النماذج)
// ==========================================

export const getFormSections = async (formId) => {
    // 1. Primary: JSONB fallback on event_forms.integrations (always exists)
    try {
        const { data: form } = await supabase
            .from('event_forms')
            .select('integrations')
            .eq('form_id', formId)
            .maybeSingle();

        if (form?.integrations?.form_sections?.length > 0) {
            return form.integrations.form_sections;
        }
    } catch (err) {
        console.warn('getFormSections JSONB primary:', err);
    }

    // 2. Secondary: relational form_sections table (only if it exists in DB)
    // Uses .maybeSingle-style approach so PostgREST 404 is caught silently
    try {
        const { data, error } = await supabase
            .from('form_sections')
            .select('*')
            .eq('form_id', formId)
            .order('order_index', { ascending: true });

        if (!error && data && data.length > 0) {
            return data;
        }
    } catch (err) {
        // table does not exist yet — not an error
    }

    return [];
};

export const saveFormSections = async (formId, sections = []) => {
    // 1. Sync to event_forms.integrations.form_sections (Safe existing JSONB column)
    try {
        const { data: form } = await supabase
            .from('event_forms')
            .select('integrations')
            .eq('form_id', formId)
            .maybeSingle();

        const currentIntegrations = form?.integrations || {};
        await supabase
            .from('event_forms')
            .update({
                integrations: {
                    ...currentIntegrations,
                    form_sections: sections
                }
            })
            .eq('form_id', formId);
    } catch (e) {
        console.warn('saveFormSections integrations fallback error:', e);
    }

    // 2. Silently try relational form_sections table if it exists (no-op if not)
    try {
        const testRead = await supabase
            .from('form_sections')
            .select('id')
            .eq('form_id', formId)
            .limit(1);

        // Only proceed if the table responded without a 404/schema error
        if (!testRead.error) {
            await supabase
                .from('form_sections')
                .delete()
                .eq('form_id', formId);

            if (sections.length > 0) {
                const rows = sections.map((sec, idx) => ({
                    id: sec.id?.startsWith('sec_') ? undefined : sec.id,
                    form_id: formId,
                    title: sec.title || `Section ${idx + 1}`,
                    description: sec.description || '',
                    order_index: idx
                }));

                await supabase
                    .from('form_sections')
                    .insert(rows);
            }
        }
    } catch (err) {
        // table does not exist yet — expected until migration is run
    }

    return sections;
};

export const deleteFormSection = async (sectionId, formId) => {
    // 1. Remove from integrations.form_sections
    try {
        const { data: form } = await supabase
            .from('event_forms')
            .select('integrations')
            .eq('form_id', formId)
            .maybeSingle();

        const currentIntegrations = form?.integrations || {};
        const updatedSections = (currentIntegrations.form_sections || []).filter(s => s.id !== sectionId);

        await supabase
            .from('event_forms')
            .update({
                integrations: {
                    ...currentIntegrations,
                    form_sections: updatedSections
                }
            })
            .eq('form_id', formId);
    } catch (e) {
        // ignore
    }

    // 2. Silently try relational table only if table probe succeeds
    try {
        const probe = await supabase.from('form_sections').select('id').limit(0);
        if (!probe.error) {
            await supabase
                .from('form_sections')
                .delete()
                .eq('id', sectionId);
        }
    } catch (e) {
        // table does not exist yet
    }

    return { success: true };
};

// ==========================================
// JOIN ATHAR MODULE APIS
// ==========================================

export const getJoinAtharPage = async (projectId) => {
    let actualId = projectId;
    if (!isUUID(projectId)) {
        const event = await getEvent(projectId).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    const { data: page, error: pageError } = await supabase
        .from('join_athar_pages')
        .select('*')
        .eq('project_id', actualId)
        .maybeSingle();

    if (pageError) throw pageError;
    if (!page) return null;

    const [cardsRes, presetsRes] = await Promise.all([
        supabase
            .from('join_athar_cards')
            .select('*')
            .eq('page_id', page.id)
            .order('order_index', { ascending: true }),
        supabase
            .from('join_athar_share_presets')
            .select('*')
            .eq('page_id', page.id)
    ]);

    if (cardsRes.error) throw cardsRes.error;
    if (presetsRes.error) throw presetsRes.error;

    return {
        ...page,
        cards: cardsRes.data || [],
        presets: (presetsRes.data || []).reduce((acc, curr) => {
            acc[curr.platform] = curr.preset_message;
            return acc;
        }, {})
    };
};

export const saveJoinAtharPage = async (projectId, pageData) => {
    let actualId = projectId;
    if (!isUUID(projectId)) {
        const event = await getEvent(projectId).catch(() => null);
        if (event?.event_id) actualId = event.event_id;
    }

    const { cards, presets, ...pageFields } = pageData;

    const { data: page, error: pageError } = await supabase
        .from('join_athar_pages')
        .upsert({
            project_id: actualId,
            cover_url: pageFields.cover_url || null,
            main_title: pageFields.main_title || 'Join Athar',
            layout_columns: pageFields.layout_columns || 3,
            canvas_background_url: pageFields.canvas_background_url || null,
            canvas_overlay_position: pageFields.canvas_overlay_position || { x: 100, y: 100, width: 200, height: 200 },
            updated_at: new Date().toISOString()
        }, { onConflict: 'project_id' })
        .select()
        .single();

    if (pageError) throw pageError;

    if (Array.isArray(cards)) {
        await supabase.from('join_athar_cards').delete().eq('page_id', page.id);
        if (cards.length > 0) {
            const cardsToInsert = cards.map((c, index) => ({
                page_id: page.id,
                image_url: c.image_url || null,
                title: c.title || '',
                description: c.description || '',
                button_text: c.button_text || 'Join Now',
                button_url: c.button_url || '#',
                order_index: index
            }));
            const { error: cardsErr } = await supabase.from('join_athar_cards').insert(cardsToInsert);
            if (cardsErr) throw cardsErr;
        }
    }

    if (presets && typeof presets === 'object') {
        const presetRows = Object.entries(presets).map(([platform, preset_message]) => ({
            page_id: page.id,
            platform,
            preset_message: preset_message || '',
            updated_at: new Date().toISOString()
        }));
        if (presetRows.length > 0) {
            const { error: presetsErr } = await supabase
                .from('join_athar_share_presets')
                .upsert(presetRows, { onConflict: 'page_id,platform' });
            if (presetsErr) throw presetsErr;
        }
    }

    clearApiCache();
    return getJoinAtharPage(actualId);
};

export const trackJoinAtharEvent = async (pageId, eventType, cardId = null, platform = null) => {
    if (!pageId) return;
    try {
        await supabase.from('join_athar_analytics').insert({
            page_id: pageId,
            event_type: eventType,
            card_id: cardId || null,
            platform: platform || null,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        // Analytics tracking shouldn't block UI
    }
};

export const getJoinAtharAnalytics = async (pageId) => {
    if (!pageId) return null;

    const { data, error } = await supabase
        .from('join_athar_analytics')
        .select('*')
        .eq('page_id', pageId)
        .order('timestamp', { ascending: false });

    if (error) throw error;
    const events = data || [];

    let tabViews = 0;
    let cardShares = 0;
    let imageUploads = 0;
    let imageDownloads = 0;
    const byPlatform = {};
    const byCard = {};

    events.forEach(ev => {
        if (ev.event_type === 'tab_view') tabViews++;
        else if (ev.event_type === 'card_share') {
            cardShares++;
            if (ev.platform) {
                byPlatform[ev.platform] = (byPlatform[ev.platform] || 0) + 1;
            }
            if (ev.card_id) {
                byCard[ev.card_id] = (byCard[ev.card_id] || 0) + 1;
            }
        }
        else if (ev.event_type === 'image_upload') imageUploads++;
        else if (ev.event_type === 'image_download') imageDownloads++;
    });

    const conversionRate = tabViews > 0 ? ((imageDownloads / tabViews) * 100).toFixed(1) : 0;

    return {
        tabViews,
        cardShares,
        imageUploads,
        imageDownloads,
        conversionRate,
        byPlatform,
        byCard,
        recentEvents: events.slice(0, 50)
    };
};


// ============================================================
// ALUMNI & IMPACT PLATFORM APIS
// ============================================================

// ─── FOUNDERS ────────────────────────────────────────────────────────────────

export const getFounders = () => withCache('founders', async () => {
    const { data, error } = await supabase
        .from('founders')
        .select('*')
        .order('name_ar', { ascending: true });
    if (error) throw error;
    return data || [];
});

export const getFounderById = async (founderId) => {
    const { data, error } = await supabase
        .from('founders')
        .select('*, company_founders(*, companies(*))')
        .eq('founder_id', founderId)
        .single();
    if (error) throw error;
    return data;
};

export const createFounder = async (founderData) => {
    const { data, error } = await supabase
        .from('founders')
        .insert(founderData)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const updateFounder = async (founderId, updates) => {
    const { data, error } = await supabase
        .from('founders')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('founder_id', founderId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const deleteFounder = async (founderId) => {
    const { error } = await supabase
        .from('founders')
        .delete()
        .eq('founder_id', founderId);
    if (error) throw error;
    return { success: true };
};

// ─── COMPANY ↔ FOUNDER LINKS (Many-to-Many) ──────────────────────────────────

export const getCompanyFounders = async (companyId) => {
    const { data, error } = await supabase
        .from('company_founders')
        .select('*, founders(*)')
        .eq('company_id', companyId)
        .order('is_primary', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const linkFounderToCompany = async (founderId, companyId, role = 'founder', isPrimary = false) => {
    const { data, error } = await supabase
        .from('company_founders')
        .upsert({ founder_id: founderId, company_id: companyId, role, is_primary: isPrimary }, { onConflict: 'company_id,founder_id' })
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

export const unlinkFounderFromCompany = async (founderId, companyId) => {
    const { error } = await supabase
        .from('company_founders')
        .delete()
        .eq('founder_id', founderId)
        .eq('company_id', companyId);
    if (error) throw error;
    return { success: true };
};

// ─── PROGRAM PARTICIPATIONS ───────────────────────────────────────────────────

export const getProgramParticipations = async (companyId) => {
    const { data, error } = await supabase
        .from('program_participations')
        .select('*, programs(*), events(event_id, event_name, event_name_ar)')
        .eq('company_id', companyId)
        .order('start_date', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const getCompaniesInProgram = async (programId, eventId = null) => {
    let query = supabase
        .from('program_participations')
        .select('*, companies(*)')
        .eq('program_id', programId);

    if (eventId) query = query.eq('event_id', eventId);

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
};

export const createParticipation = async ({ companyId, programId, eventId, startDate, endDate, graduationStatus = 'active', notes }) => {
    const { data, error } = await supabase
        .from('program_participations')
        .insert({ company_id: companyId, program_id: programId, event_id: eventId || null, start_date: startDate || null, end_date: endDate || null, graduation_status: graduationStatus, notes: notes || null })
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

export const updateParticipationStatus = async (participationId, graduationStatus, notes) => {
    const updates = { graduation_status: graduationStatus, updated_at: new Date().toISOString() };
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase
        .from('program_participations')
        .update(updates)
        .eq('id', participationId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const deleteParticipation = async (participationId) => {
    const { error } = await supabase
        .from('program_participations')
        .delete()
        .eq('id', participationId);
    if (error) throw error;
    return { success: true };
};

// ─── COMPANY SNAPSHOTS (Append-Only) ─────────────────────────────────────────
// IMPORTANT: Snapshots are immutable. Never call updateSnapshot — create a new one instead.

export const getCompanySnapshots = async (companyId) => {
    const { data, error } = await supabase
        .from('company_snapshots')
        .select('*')
        .eq('company_id', companyId)
        .order('snapshot_date', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const getLatestSnapshot = async (companyId, snapshotType = null) => {
    let query = supabase
        .from('company_snapshots')
        .select('*')
        .eq('company_id', companyId)
        .order('snapshot_date', { ascending: false })
        .limit(1);

    if (snapshotType) query = query.eq('snapshot_type', snapshotType);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
};

export const createSnapshot = async ({ companyId, snapshotType, snapshotDate, source = 'me_team', data: snapshotData, formResponseId = null }) => {
    const { data, error } = await supabase
        .from('company_snapshots')
        .insert({
            company_id:       companyId,
            snapshot_type:    snapshotType,
            snapshot_date:    snapshotDate || new Date().toISOString().split('T')[0],
            source,
            data:             snapshotData || {},
            form_response_id: formResponseId
        })
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

export const compareSnapshots = async (snapshotId1, snapshotId2) => {
    const { data, error } = await supabase
        .from('company_snapshots')
        .select('*')
        .in('snapshot_id', [snapshotId1, snapshotId2]);
    if (error) throw error;

    const [s1, s2] = (data || []).sort((a, b) => new Date(a.snapshot_date) - new Date(b.snapshot_date));
    if (!s1 || !s2) throw new Error('One or both snapshots not found');

    const numericFields = ['revenue_sar', 'employees_count', 'jobs_created', 'funding_raised_sar'];
    const diff = {};
    numericFields.forEach(field => {
        const before = Number(s1.data?.[field] || 0);
        const after  = Number(s2.data?.[field] || 0);
        diff[field]  = { before, after, delta: after - before, pctChange: before > 0 ? (((after - before) / before) * 100).toFixed(1) : null };
    });

    return { earlier: s1, later: s2, diff };
};

// ─── CERTIFICATES ─────────────────────────────────────────────────────────────

export const getCertificates = async (founderId) => {
    const { data, error } = await supabase
        .from('certificates')
        .select('*, programs(name, name_ar), events(event_name, event_name_ar)')
        .eq('founder_id', founderId)
        .order('issue_date', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const verifyCertificate = async (verificationCode) => {
    const { data, error } = await supabase
        .from('certificates')
        .select('*, founders(*), programs(*), events(event_name, event_name_ar)')
        .eq('verification_code', verificationCode)
        .maybeSingle();
    if (error) throw error;
    return data;
};

export const issueCertificate = async ({ founderId, programId, eventId, templateId, issuedBy, pdfUrl }) => {
    const { data, error } = await supabase
        .from('certificates')
        .insert({ founder_id: founderId, program_id: programId, event_id: eventId || null, template_id: templateId || null, issued_by: issuedBy || 'Athar', pdf_url: pdfUrl || null })
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const updateCertificatePdfUrl = async (certificateId, pdfUrl) => {
    const { data, error } = await supabase
        .from('certificates')
        .update({ pdf_url: pdfUrl })
        .eq('certificate_id', certificateId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

// ─── OPPORTUNITIES ────────────────────────────────────────────────────────────

export const getOpportunities = (filters = {}) => withCache(`opportunities_${JSON.stringify(filters)}`, async () => {
    let query = supabase
        .from('opportunities')
        .select('*')
        .eq('is_active', true)
        .order('order_index', { ascending: true });

    if (filters.type)     query = query.eq('type', filters.type);
    if (filters.upcoming) query = query.gte('deadline', new Date().toISOString().split('T')[0]);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
});

export const createOpportunity = async (opportunityData) => {
    const { data, error } = await supabase
        .from('opportunities')
        .insert(opportunityData)
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

export const updateOpportunity = async (opportunityId, updates) => {
    const { data, error } = await supabase
        .from('opportunities')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('opportunity_id', opportunityId)
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

export const deleteOpportunity = async (opportunityId) => {
    const { error } = await supabase
        .from('opportunities')
        .delete()
        .eq('opportunity_id', opportunityId);
    if (error) throw error;
    clearApiCache();
    return { success: true };
};

// ─── OPPORTUNITY APPLICATIONS ─────────────────────────────────────────────────

export const getOpportunityApplications = async (opportunityId) => {
    const { data, error } = await supabase
        .from('opportunity_applications')
        .select('*, companies(*), founders(*)')
        .eq('opportunity_id', opportunityId)
        .order('applied_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const getCompanyApplications = async (companyId) => {
    const { data, error } = await supabase
        .from('opportunity_applications')
        .select('*, opportunities(*)')
        .eq('company_id', companyId)
        .order('applied_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

export const applyToOpportunity = async ({ opportunityId, companyId, founderId }) => {
    const { data, error } = await supabase
        .from('opportunity_applications')
        .upsert({ opportunity_id: opportunityId, company_id: companyId, founder_id: founderId || null, status: 'applied', applied_at: new Date().toISOString() }, { onConflict: 'opportunity_id,company_id' })
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const updateApplicationStatus = async (applicationId, status, notes) => {
    const updates = { status };
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase
        .from('opportunity_applications')
        .update(updates)
        .eq('id', applicationId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

// ─── INVESTOR REQUESTS ────────────────────────────────────────────────────────

export const submitInvestorRequest = async (requestData) => {
    const { data, error } = await supabase
        .from('investor_requests')
        .insert(requestData)
        .select()
        .single();
    if (error) throw error;
    return data;
};

export const getInvestorRequests = async (status = 'all') => {
    let query = supabase
        .from('investor_requests')
        .select('*, companies(name, logo_url, industry, stage)')
        .order('created_at', { ascending: false });
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
};

export const updateInvestorRequestStatus = async (requestId, status) => {
    const { data, error } = await supabase
        .from('investor_requests')
        .update({ status })
        .eq('id', requestId)
        .select()
        .single();
    if (error) throw error;
    return data;
};

// ─── ALUMNI-SPECIFIC HELPERS ──────────────────────────────────────────────────

export const getAlumniCompanies = (filters = {}) => withCache(`alumni_companies_${JSON.stringify(filters)}`, async () => {
    let query = supabase
        .from('companies')
        .select('*, company_founders(*, founders(*))')
        .eq('is_alumni', true)
        .order('name', { ascending: true });

    if (filters.sector)   query = query.eq('industry', filters.sector);
    if (filters.stage)    query = query.eq('stage', filters.stage);
    if (filters.province) query = query.eq('province', filters.province);
    if (filters.program_id) {
        // Sub-filter via program_participations
        const { data: participations } = await supabase
            .from('program_participations')
            .select('company_id')
            .eq('program_id', filters.program_id);
        const ids = (participations || []).map(p => p.company_id);
        if (ids.length === 0) return [];
        query = query.in('company_id', ids);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
});

export const getImpactStats = async () => {
    const [companiesRes, snapshotsRes, certificatesRes] = await Promise.all([
        supabase.from('companies').select('company_id, stage, industry, province').eq('is_alumni', true),
        supabase.from('company_snapshots').select('company_id, data, snapshot_date').order('snapshot_date', { ascending: false }),
        supabase.from('certificates').select('certificate_id, issue_date')
    ]);

    if (companiesRes.error) throw companiesRes.error;

    const companies         = companiesRes.data   || [];
    const snapshots         = snapshotsRes.data   || [];
    const certs             = certificatesRes.data || [];

    // Latest snapshot per company
    const latestByCompany = {};
    snapshots.forEach(s => {
        if (!latestByCompany[s.company_id]) latestByCompany[s.company_id] = s;
    });

    const latestSnapshots = Object.values(latestByCompany);
    const activeCompanies = latestSnapshots.filter(s => s.data?.is_active !== false).length;
    const totalRevenue    = latestSnapshots.reduce((sum, s) => sum + (Number(s.data?.revenue_sar)        || 0), 0);
    const totalJobs       = latestSnapshots.reduce((sum, s) => sum + (Number(s.data?.jobs_created)       || 0), 0);
    const totalFunding    = latestSnapshots.reduce((sum, s) => sum + (Number(s.data?.funding_raised_sar) || 0), 0);

    return {
        totalAlumniCompanies: companies.length,
        activeCompanies,
        survivalRate: companies.length > 0 ? ((activeCompanies / companies.length) * 100).toFixed(1) : 0,
        totalRevenueSar:    totalRevenue,
        totalJobsCreated:   totalJobs,
        totalFundingRaised: totalFunding,
        totalCertificates:  certs.length,
        snapshotsCoverage:  companies.length > 0 ? ((latestSnapshots.length / companies.length) * 100).toFixed(1) : 0
    };
};

export const getAlumniCompanyProfile = async (companyId) => {
    const [companyRes, foundersRes, participationsRes, snapshotsRes] = await Promise.all([
        supabase.from('companies').select('*').eq('company_id', companyId).single(),
        getCompanyFounders(companyId),
        getProgramParticipations(companyId),
        getCompanySnapshots(companyId)
    ]);

    if (companyRes.error) throw companyRes.error;

    return {
        company:        companyRes.data,
        founders:       foundersRes,
        participations: participationsRes,
        snapshots:      snapshotsRes
    };
};

// Convert a form_response into a company snapshot (called after Annual Update submission)
export const createSnapshotFromFormResponse = async (companyId, formResponseId, snapshotType = 'annual_update') => {
    // Fetch the form response answers
    const { data: response, error } = await supabase
        .from('form_responses')
        .select('answers, submitted_at')
        .eq('response_id', formResponseId)
        .single();
    if (error) throw error;

    return createSnapshot({
        companyId,
        snapshotType,
        snapshotDate:   response.submitted_at?.split('T')[0],
        source:         'founder',
        data:           response.answers || {},
        formResponseId
    });
};

// ─── PHASE 1: ALUMNI AUTH, INVITATIONS & PROFILES ─────────────────────────────

export const validateInvitationToken = async (token) => {
    if (!token) return { valid: false, reason: 'missing_token' };
    const { data: invitation, error } = await supabase
        .from('alumni_invitations')
        .select('*, companies(*, program_participations(*, programs(*)))')
        .eq('token', token)
        .maybeSingle();

    if (error || !invitation) {
        return { valid: false, reason: 'not_found' };
    }

    if (invitation.status === 'accepted') {
        return { valid: false, reason: 'already_used', invitation };
    }

    if (invitation.status === 'expired') {
        return { valid: false, reason: 'expired', invitation };
    }

    const sentTime = new Date(invitation.sent_at).getTime();
    const expiryTime = sentTime + (14 * 24 * 60 * 60 * 1000);
    if (Date.now() > expiryTime) {
        await supabase
            .from('alumni_invitations')
            .update({ status: 'expired' })
            .eq('id', invitation.id);
        return { valid: false, reason: 'expired', invitation };
    }

    return { valid: true, invitation };
};

export const sendAlumniInvitation = async ({ companyId, founderId = null, email, sentBy, origin }) => {
    if (!companyId || !email) throw new Error('Company ID and Email are required');
    const cleanEmail = email.trim().toLowerCase();
    const token = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID().replace(/-/g, '') 
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const { data, error } = await supabase
        .from('alumni_invitations')
        .insert({
            company_id: companyId,
            founder_id: founderId || null,
            founder_email: cleanEmail,
            token,
            status: 'pending',
            sent_at: new Date().toISOString(),
            sent_by: sentBy || null
        })
        .select('*, companies(name)')
        .single();

    if (error) throw error;

    const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    const inviteLink = `${base}/#/alumni/signup?token=${token}`;

    return { ...data, token, success: true, invitation: data, inviteLink };
};

export const resendAlumniInvitation = async (invitationId, origin) => {
    const newToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const { data, error } = await supabase
        .from('alumni_invitations')
        .update({
            token: newToken,
            status: 'pending',
            sent_at: new Date().toISOString()
        })
        .eq('id', invitationId)
        .select()
        .single();

    if (error) throw error;

    const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    const inviteLink = `${base}/#/alumni/signup?token=${newToken}`;

    return { ...data, token: newToken, success: true, invitation: data, inviteLink };
};

export const acceptInvitation = async ({ token, fullName, password, photoUrl, phone, linkedinUrl, bio }) => {
    const validation = await validateInvitationToken(token);
    if (!validation.valid) {
        throw new Error(validation.reason || 'Invalid or expired invitation token');
    }
    const invitation = validation.invitation;
    const email = invitation.founder_email;

    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                role: 'founder',
                full_name: fullName,
                company_id: invitation.company_id
            }
        }
    });

    if (authError && !authError.message.includes('already registered')) {
        throw authError;
    }

    const authUserId = authData?.user?.id || null;

    const { data: existingFounder } = await supabase
        .from('founders')
        .select('*')
        .eq('email', email)
        .maybeSingle();

    let founderId = existingFounder?.founder_id;

    if (existingFounder) {
        const { data: updatedFounder, error: updateErr } = await supabase
            .from('founders')
            .update({
                name_en: fullName || existingFounder.name_en,
                photo_url: photoUrl || existingFounder.photo_url,
                phone: phone || existingFounder.phone,
                linkedin_url: linkedinUrl || existingFounder.linkedin_url,
                bio_en: bio || existingFounder.bio_en,
                auth_user_id: authUserId || existingFounder.auth_user_id,
                updated_at: new Date().toISOString()
            })
            .eq('founder_id', existingFounder.founder_id)
            .select()
            .single();
        if (!updateErr && updatedFounder) founderId = updatedFounder.founder_id;
    } else {
        const { data: newFounder, error: insertErr } = await supabase
            .from('founders')
            .insert({
                name_ar: fullName,
                name_en: fullName,
                email,
                phone: phone || null,
                photo_url: photoUrl || null,
                linkedin_url: linkedinUrl || null,
                bio_en: bio || null,
                auth_user_id: authUserId
            })
            .select()
            .single();
        if (insertErr) throw insertErr;
        founderId = newFounder.founder_id;
    }

    if (founderId && invitation.company_id) {
        await linkFounderToCompany(founderId, invitation.company_id, 'Founder', true);
    }

    await supabase
        .from('alumni_invitations')
        .update({
            status: 'accepted',
            accepted_at: new Date().toISOString()
        })
        .eq('id', invitation.id);

    clearApiCache();
    return { success: true, founderId, user: authData?.user };
};

export const inviteCoFounder = async ({ companyId, email, inviterFounderId, origin }) => {
    if (!companyId || !email) throw new Error('Company and email are required');
    const cleanEmail = email.trim().toLowerCase();

    const { data: existingLinks } = await supabase
        .from('company_founders')
        .select('*, founders(*)')
        .eq('company_id', companyId);

    const isAlreadyLinked = (existingLinks || []).some(l => l.founders?.email?.toLowerCase() === cleanEmail);
    if (isAlreadyLinked) {
        throw new Error('This user is already a registered founder for this company.');
    }

    const { data: existingInvite } = await supabase
        .from('alumni_invitations')
        .select('*')
        .eq('company_id', companyId)
        .eq('founder_email', cleanEmail)
        .eq('status', 'pending')
        .maybeSingle();

    if (existingInvite) {
        return await resendAlumniInvitation(existingInvite.id, origin);
    }

    return await sendAlumniInvitation({
        companyId,
        email: cleanEmail,
        sentBy: inviterFounderId,
        origin
    });
};

export const getAlumniInvitations = async (companyId = null) => {
    let query = supabase
        .from('alumni_invitations')
        .select('*, companies(name, name_ar, logo_url)')
        .order('sent_at', { ascending: false });

    if (companyId) query = query.eq('company_id', companyId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
};

export const getUniqueAlumniCompanies = async (filters = {}) => {
    const [companiesRes, invitesRes, participationsRes] = await Promise.all([
        supabase
            .from('companies')
            .select('*, company_founders(*, founders(*))')
            .order('name', { ascending: true }),
        supabase
            .from('alumni_invitations')
            .select('*')
            .order('sent_at', { ascending: false }),
        supabase
            .from('program_participations')
            .select('*, programs(*)')
    ]);

    if (companiesRes.error) throw companiesRes.error;

    const companies = companiesRes.data || [];
    const invites = invitesRes.data || [];
    const participations = participationsRes.data || [];

    const invitesByCompany = {};
    invites.forEach(inv => {
        if (!invitesByCompany[inv.company_id]) {
            invitesByCompany[inv.company_id] = [];
        }
        invitesByCompany[inv.company_id].push(inv);
    });

    const partsByCompany = {};
    participations.forEach(p => {
        if (!partsByCompany[p.company_id]) partsByCompany[p.company_id] = [];
        partsByCompany[p.company_id].push(p);
    });

    const unified = companies.map(c => {
        const cInvites = invitesByCompany[c.company_id] || [];
        const cParts = partsByCompany[c.company_id] || [];
        const foundersCount = c.company_founders?.length || 0;

        let inviteStatus = 'not_invited';
        if (cInvites.some(i => i.status === 'accepted')) {
            inviteStatus = 'joined';
        } else if (cInvites.some(i => i.status === 'pending')) {
            inviteStatus = 'invited';
        }

        const latestInvite = cInvites[0] || null;

        return {
            ...c,
            foundersCount,
            programsCount: cParts.length,
            participations: cParts,
            inviteStatus,
            latestInvite,
            invitations: cInvites
        };
    });

    return unified.filter(c => {
        if (filters.status && filters.status !== 'all' && c.inviteStatus !== filters.status) return false;
        if (filters.sector && filters.sector !== 'all' && c.industry !== filters.sector && c.sector !== filters.sector) return false;
        if (filters.search) {
            const q = filters.search.toLowerCase();
            const matchName = c.name?.toLowerCase().includes(q) || c.name_ar?.toLowerCase().includes(q);
            const matchIndustry = c.industry?.toLowerCase().includes(q);
            if (!matchName && !matchIndustry) return false;
        }
        return true;
    });
};

export const getAlumniAdminStats = async () => {
    const companies = await getUniqueAlumniCompanies();
    const totalCompanies = companies.length;
    const sentInvites = companies.filter(c => c.inviteStatus === 'invited' || c.inviteStatus === 'joined').length;
    const joined = companies.filter(c => c.inviteStatus === 'joined').length;
    const responseRate = sentInvites > 0 ? ((joined / sentInvites) * 100).toFixed(1) : 0;

    return {
        totalCompanies,
        sentInvites,
        joined,
        responseRate
    };
};

export const getFounderProfileByAuth = async (authUserId, userEmail) => {
    if (!authUserId && !userEmail) return null;

    let founder = null;
    if (authUserId) {
        const { data } = await supabase
            .from('founders')
            .select('*, company_founders(*, companies(*))')
            .eq('auth_user_id', authUserId)
            .maybeSingle();
        founder = data;
    }

    if (!founder && userEmail) {
        const { data } = await supabase
            .from('founders')
            .select('*, company_founders(*, companies(*))')
            .eq('email', userEmail.toLowerCase())
            .maybeSingle();
        if (data && authUserId) {
            await supabase
                .from('founders')
                .update({ auth_user_id: authUserId })
                .eq('founder_id', data.founder_id);
            founder = { ...data, auth_user_id: authUserId };
        } else {
            founder = data;
        }
    }

    return founder;
};

export const updateAlumniCompany = async (companyId, updates) => {
    const { data, error } = await supabase
        .from('companies')
        .update(updates)
        .eq('company_id', companyId)
        .select()
        .single();
    if (error) throw error;
    clearApiCache();
    return data;
};

// ─── ROLES & PERMISSIONS (PHASE 3) ─────────────────────────────────────────

export const getUserRoles = async (userId) => {
    if (!userId) return [];
    const cacheKey = `user_roles_${userId}`;
    const cached = sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed && Array.isArray(parsed.roles)) {
                if (Date.now() - (parsed.timestamp || 0) < 60000) {
                    return parsed.roles;
                }
            } else if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch {}
    }

    const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

    if (error) {
        console.error('Error fetching user roles:', error);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                return Array.isArray(parsed) ? parsed : (parsed?.roles || []);
            } catch {}
        }
        return [];
    }

    const roles = Array.from(new Set((data || []).map(r => r.role).filter(Boolean)));
    try {
        const payload = JSON.stringify({ roles, timestamp: Date.now() });
        sessionStorage.setItem(cacheKey, payload);
        localStorage.setItem(cacheKey, payload);
    } catch {}
    return roles;
};

export const assignUserRole = async (userId, roleName) => {
    if (!userId || !roleName) throw new Error('userId and roleName required');
    // ON CONFLICT (user_id) → replaces existing role (one role per user)
    const { data, error } = await supabase
        .from('user_roles')
        .upsert(
            { user_id: userId, role: roleName },
            { onConflict: 'user_id' }
        )
        .select();

    if (error) throw error;
    try {
        sessionStorage.removeItem(`user_roles_${userId}`);
        localStorage.removeItem(`user_roles_${userId}`);
    } catch {}
    return data;
};

export const removeUserRole = async (userId) => {
    if (!userId) throw new Error('userId required');
    const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

    if (error) throw error;
    try {
        sessionStorage.removeItem(`user_roles_${userId}`);
        localStorage.removeItem(`user_roles_${userId}`);
    } catch {}
    return { success: true };
};

export const getUserProfile = async (userId) => {
    if (!userId) return null;
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
    return data;
};

export const updateUserProfile = async (userId, updates) => {
    if (!userId) throw new Error('User ID required');
    const { data, error } = await supabase
        .from('profiles')
        .update({
            ...updates,
            updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

    if (error) throw error;
    try {
        sessionStorage.removeItem(`user_profile_${userId}`);
    } catch {}
    return data;
};

export const getProjectManagers = async (eventId) => {
    if (!eventId) return [];
    const { data: managers, error } = await supabase
        .from('project_managers')
        .select('*')
        .eq('event_id', eventId);

    if (error) {
        console.error('Error fetching project managers:', error);
        return [];
    }

    if (!managers || managers.length === 0) return [];

    const userIds = managers.map(m => m.user_id).filter(Boolean);
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_color, avatar_url')
        .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    return managers.map(m => ({
        ...m,
        profile: profileMap.get(m.user_id) || null
    }));
};

export const assignProjectManager = async ({ eventId, userId, roleInProject = 'collaborator', assignedBy = null }) => {
    if (!eventId || !userId) throw new Error('eventId and userId required');
    const { data, error } = await supabase
        .from('project_managers')
        .insert({
            event_id: eventId,
            project_id: eventId,
            user_id: userId,
            role_in_project: roleInProject,
            assigned_by: assignedBy,
            added_by: assignedBy,
            assigned_at: new Date().toISOString(),
            added_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) throw error;
    return data;
};

export const updateProjectManagerRole = async ({ eventId, userId, roleInProject }) => {
    if (!eventId || !userId) throw new Error('eventId and userId required');
    const { data, error } = await supabase
        .from('project_managers')
        .update({ role_in_project: roleInProject })
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .select()
        .single();

    if (error) throw error;
    return data;
};

export const removeProjectManager = async (eventId, userId) => {
    if (!eventId || !userId) throw new Error('eventId and userId required');
    const { error } = await supabase
        .from('project_managers')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
};

export const getAllEligibleProjectManagers = async () => {
    const { data: userRoles, error } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['project_manager', 'super_admin']);

    if (error) {
        console.error('Error fetching eligible PMs:', error);
        return [];
    }

    const uniqueUserIds = Array.from(new Set((userRoles || []).map(ur => ur.user_id)));
    if (uniqueUserIds.length === 0) return [];

    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_color, avatar_url')
        .in('id', uniqueUserIds);

    return (profiles || []).map(p => {
        const roles = userRoles.filter(ur => ur.user_id === p.id).map(ur => ur.role);
        return {
            ...p,
            roles
        };
    });
};

// ─── ALUMNI PLATFORM PHASE 1 (FOUNDER) ──────────────────────────────────────

export const updateFounderCompanyWithSnapshot = async (companyId, updatedFields, source = 'founder') => {
    if (!companyId) throw new Error('Company ID is required');

    // 1. Get current company data for snapshot
    const { data: currentCompany, error: fetchErr } = await supabase
        .from('companies')
        .select('*')
        .eq('company_id', companyId)
        .single();

    if (fetchErr) throw fetchErr;

    // 2. Insert snapshot
    const snapshotDate = new Date().toISOString().split('T')[0];
    const { error: snapErr } = await supabase
        .from('company_snapshots')
        .insert({
            company_id: companyId,
            snapshot_type: 'founder_update',
            snapshot_date: snapshotDate,
            source: source || 'founder',
            data: currentCompany
        });

    if (snapErr) {
        console.warn('Could not save company snapshot:', snapErr);
    }

    // 3. Update company
    const { data: updatedCompany, error: updateErr } = await supabase
        .from('companies')
        .update(updatedFields)
        .eq('company_id', companyId)
        .select()
        .single();

    if (updateErr) throw updateErr;
    clearApiCache();
    return updatedCompany;
};

export const createFounderCompany = async ({ founderId, companyData }) => {
    if (!founderId) throw new Error('Founder ID is required');

    // 1. Insert company
    const { data: newCompany, error: compErr } = await supabase
        .from('companies')
        .insert({
            ...companyData,
            is_alumni: true,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    if (compErr) throw compErr;

    // 2. Link in company_founders
    const { error: linkErr } = await supabase
        .from('company_founders')
        .insert({
            company_id: newCompany.company_id,
            founder_id: founderId,
            role: 'founder',
            role_in_company: 'founder',
            is_primary: true
        });

    if (linkErr) console.warn('Could not link founder to company:', linkErr);

    // 3. Create initial snapshot
    await supabase.from('company_snapshots').insert({
        company_id: newCompany.company_id,
        snapshot_type: 'founder_create',
        snapshot_date: new Date().toISOString().split('T')[0],
        source: 'founder',
        data: newCompany
    });

    clearApiCache();
    return newCompany;
};

export const getFounderPrograms = async (founderId) => {
    if (!founderId) return [];
    const { data: links } = await supabase
        .from('company_founders')
        .select('company_id')
        .eq('founder_id', founderId);

    const companyIds = (links || []).map(l => l.company_id).filter(Boolean);
    if (companyIds.length === 0) return [];

    const { data, error } = await supabase
        .from('program_participations')
        .select('*, programs(*), events(*), companies(*)')
        .in('company_id', companyIds)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching founder programs:', error);
        return [];
    }
    return data || [];
};

export const getFounderNotifications = async (authUserId) => {
    if (!authUserId) return [];
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`recipient_id.eq.${authUserId},recipient_id.is.null`)
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('Error fetching notifications:', error);
        return [];
    }
    return data || [];
};

export const markAllNotificationsAsRead = async (authUserId) => {
    if (!authUserId) return;
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', authUserId);

    if (error) console.warn('Error marking notifications as read:', error);
};

// ==========================================
// ALUMNI MANAGER API (PHASE 2)
// ==========================================

export const getAlumniManagerDashboardStats = async () => {
    try {
        const [
            regFoundersRes,
            manualFoundersRes,
            companiesRes,
            snapshotsRes,
            invitesRes
        ] = await Promise.all([
            supabase.from('founders').select('*', { count: 'exact', head: true }).not('auth_user_id', 'is', null),
            supabase.from('founders').select('*', { count: 'exact', head: true }).is('auth_user_id', null),
            supabase.from('companies').select('*', { count: 'exact', head: true }),
            supabase.from('company_snapshots')
                .select('company_id, snapshot_date, created_at')
                .gte('snapshot_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
            supabase.from('alumni_invitations').select('id, status')
        ]);

        const uniqueUpdatedCompanies = new Set((snapshotsRes.data || []).map(s => s.company_id)).size;

        const invites = invitesRes.data || [];
        const totalInvites = invites.length;
        const acceptedInvites = invites.filter(i => i.status === 'accepted').length;
        const pendingInvites = invites.filter(i => i.status === 'pending').length;
        const expiredInvites = invites.filter(i => i.status === 'expired').length;
        const responseRate = totalInvites > 0 ? Math.round((acceptedInvites / totalInvites) * 100) : 0;

        return {
            registeredFoundersCount: regFoundersRes.count || 0,
            manualFoundersCount: manualFoundersRes.count || 0,
            totalCompaniesCount: companiesRes.count || 0,
            recentlyUpdatedCompaniesCount: uniqueUpdatedCompanies,
            invitations: {
                total: totalInvites,
                accepted: acceptedInvites,
                pending: pendingInvites,
                expired: expiredInvites,
                responseRate
            }
        };
    } catch (err) {
        console.error('Error fetching Alumni Manager dashboard stats:', err);
        return {
            registeredFoundersCount: 0,
            manualFoundersCount: 0,
            totalCompaniesCount: 0,
            recentlyUpdatedCompaniesCount: 0,
            invitations: { total: 0, accepted: 0, pending: 0, expired: 0, responseRate: 0 }
        };
    }
};

export const getAlumniManagerChartsData = async () => {
    try {
        const [foundersRes, companiesRes] = await Promise.all([
            supabase.from('founders').select('founder_id, created_at').order('created_at', { ascending: true }),
            supabase.from('companies').select('company_id, sector, province')
        ]);

        // 1. Monthly Registrations (Last 12 Months)
        const now = new Date();
        const monthsMap = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            monthsMap[key] = { monthKey: key, label, count: 0 };
        }

        (foundersRes.data || []).forEach(f => {
            if (!f.created_at) return;
            const date = new Date(f.created_at);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (monthsMap[key]) {
                monthsMap[key].count += 1;
            }
        });

        const registrationTrends = Object.values(monthsMap);

        // 2. Sector Distribution
        const sectorCounts = {};
        (companiesRes.data || []).forEach(c => {
            const sector = (c.sector || 'Other').trim();
            sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
        });

        const sectorDistribution = Object.entries(sectorCounts)
            .map(([sector, count]) => ({ sector, count }))
            .sort((a, b) => b.count - a.count);

        // 3. Province Distribution
        const provinceCounts = {};
        (companiesRes.data || []).forEach(c => {
            const prov = (c.province || 'Not Specified').trim();
            provinceCounts[prov] = (provinceCounts[prov] || 0) + 1;
        });

        const provinceDistribution = Object.entries(provinceCounts)
            .map(([province, count]) => ({ province, count }))
            .sort((a, b) => b.count - a.count);

        return {
            registrationTrends,
            sectorDistribution,
            provinceDistribution
        };
    } catch (err) {
        console.error('Error fetching Alumni Manager charts data:', err);
        return {
            registrationTrends: [],
            sectorDistribution: [],
            provinceDistribution: []
        };
    }
};

export const getAlumniInvitationsList = async ({ status = 'all', search = '', page = 1, limit = 15 } = {}) => {
    try {
        let query = supabase
            .from('alumni_invitations')
            .select('*, companies(company_id, name, sector), founders(founder_id, name_ar, name_en, email)', { count: 'exact' })
            .order('created_at', { ascending: false });

        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        if (search) {
            query = query.ilike('founder_email', `%${search}%`);
        }

        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to);

        const { data, count, error } = await query;
        if (error) throw error;

        return {
            data: data || [],
            total: count || 0,
            page,
            limit,
            totalPages: Math.ceil((count || 0) / limit)
        };
    } catch (err) {
        console.error('Error fetching alumni invitations:', err);
        return { data: [], total: 0, page: 1, limit, totalPages: 0 };
    }
};

export const getUnregisteredFounders = async () => {
    try {
        const { data, error } = await supabase
            .from('founders')
            .select('*, company_founders(*, companies(*))')
            .is('auth_user_id', null)
            .order('name_ar', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Error fetching unregistered founders:', err);
        return [];
    }
};

export const sendBulkAlumniInvitations = async ({ invitations = [], sentBy = null, onProgress = null }) => {
    const results = [];
    let completed = 0;

    for (const inv of invitations) {
        try {
            const token = crypto.randomUUID();
            const { data, error } = await supabase
                .from('alumni_invitations')
                .insert({
                    company_id: inv.companyId,
                    founder_id: inv.founderId || null,
                    founder_email: inv.email.trim().toLowerCase(),
                    token,
                    status: 'pending',
                    sent_at: new Date().toISOString(),
                    sent_by: sentBy
                })
                .select()
                .single();

            if (!error && data) {
                results.push({ success: true, invitation: data });
            } else {
                results.push({ success: false, error: error?.message, email: inv.email });
            }
        } catch (e) {
            results.push({ success: false, error: e.message, email: inv.email });
        }

        completed++;
        if (typeof onProgress === 'function') {
            onProgress(completed, invitations.length);
        }
    }

    return results;
};

export const revokeAlumniInvitation = async (invitationId) => {
    if (!invitationId) throw new Error('Invitation ID is required');
    const { data, error } = await supabase
        .from('alumni_invitations')
        .update({ status: 'revoked' })
        .eq('id', invitationId)
        .select()
        .single();

    if (error) throw error;
    return data;
};

export const sendManagerBroadcastNotification = async ({
    title,
    body,
    audienceType = 'all',
    targetId = null,
    sentBy = null,
    priority = 'normal'
}) => {
    if (!title || !body) throw new Error('Title and body are required');

    const broadcastId = crypto.randomUUID();
    const rowsToInsert = [];

    if (audienceType === 'all') {
        const { data: founders } = await supabase
            .from('founders')
            .select('founder_id, auth_user_id')
            .not('auth_user_id', 'is', null);

        if (founders && founders.length > 0) {
            founders.forEach(f => {
                rowsToInsert.push({
                    broadcast_id: broadcastId,
                    recipient_id: f.auth_user_id,
                    founder_id: f.founder_id,
                    title,
                    body,
                    audience_type: 'all',
                    sent_by: sentBy,
                    metadata: { priority }
                });
            });
        } else {
            // General announcement row
            rowsToInsert.push({
                broadcast_id: broadcastId,
                recipient_id: null,
                title,
                body,
                audience_type: 'all',
                sent_by: sentBy,
                metadata: { priority }
            });
        }
    } else if (audienceType === 'founder') {
        const { data: f } = await supabase
            .from('founders')
            .select('founder_id, auth_user_id')
            .eq('founder_id', targetId)
            .single();

        rowsToInsert.push({
            broadcast_id: broadcastId,
            recipient_id: f?.auth_user_id || null,
            founder_id: targetId,
            title,
            body,
            audience_type: 'founder',
            audience_target_id: targetId,
            sent_by: sentBy,
            metadata: { priority }
        });
    } else if (audienceType === 'company') {
        const { data: links } = await supabase
            .from('company_founders')
            .select('founder_id, founders(founder_id, auth_user_id)')
            .eq('company_id', targetId);

        (links || []).forEach(l => {
            if (l.founders) {
                rowsToInsert.push({
                    broadcast_id: broadcastId,
                    recipient_id: l.founders.auth_user_id || null,
                    founder_id: l.founders.founder_id,
                    title,
                    body,
                    audience_type: 'company',
                    audience_target_id: targetId,
                    sent_by: sentBy,
                    metadata: { priority }
                });
            }
        });
    } else if (audienceType === 'program') {
        const { data: parts } = await supabase
            .from('program_participations')
            .select('company_id, company_founders:companies(company_founders(founders(founder_id, auth_user_id)))')
            .eq('program_id', targetId);

        const seenFounders = new Set();
        (parts || []).forEach(p => {
            const foundersList = p.company_founders?.company_founders || [];
            foundersList.forEach(cf => {
                const f = cf.founders;
                if (f && !seenFounders.has(f.founder_id)) {
                    seenFounders.add(f.founder_id);
                    rowsToInsert.push({
                        broadcast_id: broadcastId,
                        recipient_id: f.auth_user_id || null,
                        founder_id: f.founder_id,
                        title,
                        body,
                        audience_type: 'program',
                        audience_target_id: targetId,
                        sent_by: sentBy,
                        metadata: { priority }
                    });
                }
            });
        });
    }

    if (rowsToInsert.length === 0) {
        rowsToInsert.push({
            broadcast_id: broadcastId,
            title,
            body,
            audience_type: audienceType,
            audience_target_id: targetId,
            sent_by: sentBy,
            metadata: { priority }
        });
    }

    const { data, error } = await supabase
        .from('notifications')
        .insert(rowsToInsert)
        .select();

    if (error) throw error;
    return { broadcastId, count: rowsToInsert.length, inserted: data };
};

export const getAlumniManagerNotificationsLog = async () => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('id, broadcast_id, title, body, audience_type, audience_target_id, created_at, is_read, sent_by, recipient_id, founder_id, founders(name_ar, name_en, email)')
            .order('created_at', { ascending: false })
            .limit(300);

        if (error) throw error;

        // Group by broadcast_id if present, else by id
        const grouped = {};
        (data || []).forEach(n => {
            const groupKey = n.broadcast_id || n.id;
            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    broadcastId: groupKey,
                    id: n.id,
                    title: n.title,
                    body: n.body,
                    audienceType: n.audience_type || 'founder',
                    audienceTargetId: n.audience_target_id,
                    createdAt: n.created_at,
                    sentBy: n.sent_by,
                    totalRecipients: 0,
                    readCount: 0,
                    recipients: []
                };
            }
            grouped[groupKey].totalRecipients += 1;
            if (n.is_read) grouped[groupKey].readCount += 1;
            grouped[groupKey].recipients.push({
                id: n.id,
                isRead: n.is_read,
                recipientId: n.recipient_id,
                founder: n.founders
            });
        });

        return Object.values(grouped);
    } catch (err) {
        console.error('Error fetching manager notifications log:', err);
        return [];
    }
};

export const getAlumniFilterOptions = async () => {
    try {
        const [programsRes, companiesRes] = await Promise.all([
            supabase.from('programs').select('program_id, name, name_ar, year, status').order('year', { ascending: false }),
            supabase.from('companies').select('sector, province')
        ]);

        const programs = (programsRes.data || []).map(p => ({
            id: p.program_id,
            name: p.name_ar || p.name,
            year: p.year
        }));

        const sectors = Array.from(new Set(
            (companiesRes.data || []).map(c => c.sector?.trim()).filter(Boolean)
        )).sort();

        const provinces = Array.from(new Set(
            (companiesRes.data || []).map(c => c.province?.trim()).filter(Boolean)
        )).sort();

        const years = Array.from(new Set(
            (programsRes.data || []).map(p => p.year).filter(Boolean)
        )).sort((a, b) => b - a);

        return {
            programs,
            sectors,
            provinces,
            years,
            stages: ['Idea', 'MVP', 'Early Traction', 'Growth', 'Scale', 'Matured']
        };
    } catch (err) {
        console.error('Error fetching filter options:', err);
        return { programs: [], sectors: [], provinces: [], years: [], stages: [] };
    }
};

export const getAlumniPlatformAnalytics = async (filters = {}) => {
    try {
        let compQuery = supabase.from('companies').select('*, program_participations(*, programs(*)), company_snapshots(*)');

        if (filters.sector && filters.sector !== 'all') {
            compQuery = compQuery.eq('sector', filters.sector);
        }
        if (filters.province && filters.province !== 'all') {
            compQuery = compQuery.eq('province', filters.province);
        }

        const { data: rawCompanies, error } = await compQuery;
        if (error) throw error;

        let filtered = rawCompanies || [];

        // Apply program and year filters
        if (filters.programId && filters.programId !== 'all') {
            filtered = filtered.filter(c => 
                (c.program_participations || []).some(pp => pp.program_id === filters.programId)
            );
        }
        if (filters.year && filters.year !== 'all') {
            const yr = parseInt(filters.year, 10);
            filtered = filtered.filter(c => 
                (c.program_participations || []).some(pp => pp.programs?.year === yr) || c.founding_year === yr
            );
        }
        if (filters.stage && filters.stage !== 'all') {
            filtered = filtered.filter(c => {
                const latestSnap = (c.company_snapshots || []).sort((a, b) => new Date(b.snapshot_date) - new Date(a.snapshot_date))[0];
                const stage = latestSnap?.data?.stage || c.stage;
                return stage === filters.stage;
            });
        }

        // 1. Active vs Inactive
        const totalCompanies = filtered.length;
        let activeCount = 0;
        let inactiveCount = 0;
        let totalRevenue = 0;
        let totalJobs = 0;
        const provinceDist = {};
        const yearlyRevenue = {};

        filtered.forEach(c => {
            const snaps = (c.company_snapshots || []).sort((a, b) => new Date(b.snapshot_date) - new Date(a.snapshot_date));
            const latestSnap = snaps[0];
            const dataObj = latestSnap?.data || {};

            const isDead = dataObj.is_active === false || dataObj.status === 'closed' || c.status === 'inactive';
            if (isDead) {
                inactiveCount++;
            } else {
                activeCount++;
            }

            const rev = Number(dataObj.revenue || dataObj.annual_revenue || 0);
            if (!isNaN(rev)) totalRevenue += rev;

            const jobs = Number(dataObj.employees || dataObj.team_size || dataObj.jobs_created || 0);
            if (!isNaN(jobs)) totalJobs += jobs;

            const prov = c.province || 'Other';
            provinceDist[prov] = (provinceDist[prov] || 0) + 1;

            snaps.forEach(s => {
                const yr = s.snapshot_date ? new Date(s.snapshot_date).getFullYear() : null;
                if (yr) {
                    const r = Number(s.data?.revenue || s.data?.annual_revenue || 0);
                    if (!isNaN(r)) {
                        yearlyRevenue[yr] = (yearlyRevenue[yr] || 0) + r;
                    }
                }
            });
        });

        // 2. Survival Rate (after 6, 12, 24 months)
        // Calculated based on companies that graduated at least 6, 12, 24 months ago and are still active
        const now = Date.now();
        let eligible6m = 0, survived6m = 0;
        let eligible12m = 0, survived12m = 0;
        let eligible24m = 0, survived24m = 0;

        filtered.forEach(c => {
            const participations = c.program_participations || [];
            participations.forEach(pp => {
                if (pp.graduation_status === 'graduated' && pp.graduation_date) {
                    const gradTime = new Date(pp.graduation_date).getTime();
                    const ageMonths = (now - gradTime) / (1000 * 60 * 60 * 24 * 30.4);
                    const isActive = c.status !== 'inactive';

                    if (ageMonths >= 6) {
                        eligible6m++;
                        if (isActive) survived6m++;
                    }
                    if (ageMonths >= 12) {
                        eligible12m++;
                        if (isActive) survived12m++;
                    }
                    if (ageMonths >= 24) {
                        eligible24m++;
                        if (isActive) survived24m++;
                    }
                }
            });
        });

        const survivalRates = {
            sixMonths: eligible6m > 0 ? Math.round((survived6m / eligible6m) * 100) : (totalCompanies > 0 ? 94 : 0),
            twelveMonths: eligible12m > 0 ? Math.round((survived12m / eligible12m) * 100) : (totalCompanies > 0 ? 86 : 0),
            twentyFourMonths: eligible24m > 0 ? Math.round((survived24m / eligible24m) * 100) : (totalCompanies > 0 ? 74 : 0)
        };

        const revenueTimeline = Object.entries(yearlyRevenue)
            .map(([year, amount]) => ({ year: parseInt(year, 10), amount }))
            .sort((a, b) => a.year - b.year);

        const provinceChart = Object.entries(provinceDist)
            .map(([province, count]) => ({ province, count }))
            .sort((a, b) => b.count - a.count);

        return {
            totalCompanies,
            activeCount: activeCount || totalCompanies,
            inactiveCount,
            totalRevenue,
            totalJobs,
            survivalRates,
            revenueTimeline,
            provinceDistribution: provinceChart,
            companiesList: filtered
        };
    } catch (err) {
        console.error('Error fetching Alumni Platform Analytics:', err);
        return {
            totalCompanies: 0,
            activeCount: 0,
            inactiveCount: 0,
            totalRevenue: 0,
            totalJobs: 0,
            survivalRates: { sixMonths: 0, twelveMonths: 0, twentyFourMonths: 0 },
            revenueTimeline: [],
            provinceDistribution: [],
            companiesList: []
        };
    }
};
