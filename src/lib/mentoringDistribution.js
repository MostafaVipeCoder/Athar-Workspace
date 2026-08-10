/**
 * mentoringDistribution.js
 * ========================
 * Smart algorithm for 1-1 Mentoring Distribution
 * Includes: Distribution generation, conflict validation, Supabase CRUD
 */

import { supabase } from './supabase';

// ============================================================
// CONFIG API
// ============================================================

/**
 * Fetch distribution config for a given event
 */
export const getDistributionConfig = async (eventId) => {
    const { data, error } = await supabase
        .from('mentoring_distribution_config')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
        ...data,
        unique_pairing: data.unique_pairing ?? true,
        mentor_availability: data.mentor_availability || {},
    };
};

/**
 * Save/Update distribution config
 */
export const saveDistributionConfig = async (eventId, config) => {
    const { data, error } = await supabase
        .from('mentoring_distribution_config')
        .upsert({
            event_id: eventId,
            ...config,
            unique_pairing: config.unique_pairing ?? true,
            mentor_availability: config.mentor_availability || {},
            updated_at: new Date().toISOString(),
        }, { onConflict: 'event_id' })
        .select()
        .single();

    if (error) throw error;
    return data;
};

// ============================================================
// SESSIONS API
// ============================================================

/**
 * Get all sessions for an event
 */
export const getDistributionSessions = async (eventId) => {
    const { data, error } = await supabase
        .from('mentoring_sessions')
        .select('*')
        .eq('event_id', eventId)
        .order('day_index', { ascending: true })
        .order('slot_index', { ascending: true })
        .order('mentor_name', { ascending: true });

    if (error) throw error;
    return data || [];
};

/**
 * Clear all sessions for an event
 */
export const clearDistributionSessions = async (eventId) => {
    const { error } = await supabase
        .from('mentoring_sessions')
        .delete()
        .eq('event_id', eventId);

    if (error) throw error;
};

/**
 * Save sessions array after generation
 */
export const saveDistributionSessions = async (sessions, eventId) => {
    if (!sessions.length) return [];

    const cleanSessions = sessions.map(s => ({
        event_id: s.event_id || eventId || '',
        day_index: s.day_index ?? 0,
        slot_index: s.slot_index ?? 0,
        mentor_id: s.mentor_id || null,
        mentor_name: s.mentor_name || null,
        company_id: s.company_id || null,
        company_name: s.company_name || null,
        is_break: !!s.is_break,
        has_conflict: !!s.has_conflict,
        conflict_reason: s.conflict_reason || null,
        slot_start_time: s.slot_start_time || null,
        slot_end_time: s.slot_end_time || null,
    }));

    const { data, error } = await supabase
        .from('mentoring_sessions')
        .insert(cleanSessions)
        .select();

    if (error) {
        console.error('[Supabase Error] saveDistributionSessions failed:', error);
        throw error;
    }
    return data;
};

/**
 * Update a single session
 */
export const updateSession = async (sessionId, updates) => {
    const { data, error } = await supabase
        .from('mentoring_sessions')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .select()
        .single();

    if (error) throw error;
    return data;
};

/**
 * Publish / Unpublish distribution
 */
export const publishDistribution = async (eventId, isPublished) => {
    return saveDistributionConfig(eventId, { is_published: isPublished });
};

// ============================================================
// CORE ALGORITHM & HELPERS
// ============================================================

/**
 * Check if a mentor is available on a given day index
 * @param {string} mentorId
 * @param {number} dayIndex (0-based)
 * @param {Object} availabilityConfig - { [mentorId]: 'all' | 'day_0' | 'day_1' | 'day_2' | 'excluded' | [0, 1] }
 */
export const isMentorAvailableOnDay = (mentorId, dayIndex, availabilityConfig = {}) => {
    const avail = availabilityConfig[mentorId];
    if (avail === undefined || avail === null || avail === 'all') return true;
    if (avail === 'excluded' || avail === 'none') return false;
    if (Array.isArray(avail)) return avail.includes(dayIndex);
    if (typeof avail === 'string' && avail.startsWith('day_')) {
        const d = parseInt(avail.replace('day_', ''), 10);
        return d === dayIndex;
    }
    return true;
};

/**
 * Calculate start/end time for a slot
 */
export const calculateSlotTime = (startTime, slotIndex, slotDurationMinutes, breakSlots = []) => {
    const [h, m] = startTime.split(':').map(Number);
    let totalMinutes = h * 60 + m;

    for (const br of breakSlots) {
        if (slotIndex > br.after_slot) {
            totalMinutes += (br.duration_minutes || 0);
        }
    }

    totalMinutes += slotIndex * slotDurationMinutes;

    const startH = Math.floor(totalMinutes / 60) % 24;
    const startM = totalMinutes % 60;
    const endTotal = totalMinutes + slotDurationMinutes;
    const endH = Math.floor(endTotal / 60) % 24;
    const endM = endTotal % 60;

    const fmt = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    return {
        start: fmt(startH, startM),
        end: fmt(endH, endM),
    };
};

/**
 * Calculate slots per day
 */
export const calcSlotsPerDay = (totalRoundMinutes, slotDurationMinutes) => {
    return Math.floor(totalRoundMinutes / slotDurationMinutes);
};

/**
 * Generate distribution with unique pairing constraint and mentor availability support
 */
export const generateDistribution = (config, mentors, companies) => {
    const {
        start_time,
        num_days,
        total_round_minutes,
        slot_duration_minutes,
        break_slots = [],
        unique_pairing = true,
        mentor_availability = {},
    } = config;
    const event_id = config.event_id || config.eventId;

    const slotsPerDay = calcSlotsPerDay(total_round_minutes, slot_duration_minutes);
    const sessions = [];

    // Track total meetings between each mentor and company across ALL days
    // mentorMeetCount[mentorId][companyId] = count
    const mentorMeetCount = {};
    mentors.forEach(m => {
        mentorMeetCount[m.id] = {};
        companies.forEach(c => { mentorMeetCount[m.id][c.id] = 0; });
    });

    // Track sessions per company in each (day, slot) to prevent time conflicts
    // occupiedSlots[dayIndex][slotIndex][companyId] = mentorId | null
    const occupiedSlots = {};
    for (let day = 0; day < num_days; day++) {
        occupiedSlots[day] = {};
        for (let slot = 0; slot < slotsPerDay; slot++) {
            occupiedSlots[day][slot] = {};
        }
    }

    for (let day = 0; day < num_days; day++) {
        // Filter mentors available on this day
        const availableMentorsToday = mentors.filter(m => isMentorAvailableOnDay(m.id, day, mentor_availability));

        // Track companies met by each mentor TODAY (to prevent repeat meeting in same round/day)
        const metInRound = {};
        availableMentorsToday.forEach(m => { metInRound[m.id] = new Set(); });

        for (let slot = 0; slot < slotsPerDay; slot++) {
            const { start, end } = calculateSlotTime(start_time, slot, slot_duration_minutes, break_slots);

            for (const mentor of availableMentorsToday) {
                // Find available companies
                const availableCompanies = companies.filter(c => {
                    const notSeenMentorThisRound = !metInRound[mentor.id].has(c.id);
                    const noTimeConflict = !occupiedSlots[day][slot][c.id];
                    const notSeenAcrossAllDays = !unique_pairing || (mentorMeetCount[mentor.id]?.[c.id] || 0) === 0;

                    return notSeenMentorThisRound && noTimeConflict && notSeenAcrossAllDays;
                });

                if (availableCompanies.length === 0) {
                    const hasMetBeforeInEvent = unique_pairing && companies.some(c => (mentorMeetCount[mentor.id]?.[c.id] || 0) > 0);
                    const isUniquePairingLimit = unique_pairing && hasMetBeforeInEvent;
                    const conflictReason = isUniquePairingLimit
                        ? 'Unique Pairing limit: All available startups have already met this mentor'
                        : 'No available startup: time conflict or already assigned';

                    sessions.push({
                        event_id,
                        day_index: day,
                        slot_index: slot,
                        mentor_id: mentor.id,
                        mentor_name: mentor.name,
                        company_id: null,
                        company_name: null,
                        is_break: false,
                        has_conflict: !isUniquePairingLimit,
                        is_warning: isUniquePairingLimit,
                        conflict_reason: conflictReason,
                        slot_start_time: start,
                        slot_end_time: end,
                    });
                    continue;
                }

                // Choose company with lowest total meetings overall, with random tiebreaker
                const totalMeetings = (c) => Object.values(mentorMeetCount).reduce((sum, mm) => sum + (mm[c.id] || 0), 0);

                const sorted = [...availableCompanies].sort((a, b) => {
                    const diff = totalMeetings(a) - totalMeetings(b);
                    if (diff !== 0) return diff;
                    return Math.random() - 0.5;
                });

                const chosen = sorted[0];

                sessions.push({
                    event_id,
                    day_index: day,
                    slot_index: slot,
                    mentor_id: mentor.id,
                    mentor_name: mentor.name,
                    company_id: chosen.id,
                    company_name: chosen.name,
                    is_break: false,
                    has_conflict: false,
                    conflict_reason: null,
                    slot_start_time: start,
                    slot_end_time: end,
                });

                // Update trackers
                metInRound[mentor.id].add(chosen.id);
                occupiedSlots[day][slot][chosen.id] = mentor.id;
                mentorMeetCount[mentor.id][chosen.id] = (mentorMeetCount[mentor.id][chosen.id] || 0) + 1;
            }
        }
    }

    return sessions;
};

/**
 * Validate distribution sessions and return array of conflict objects
 */
export const validateDistribution = (sessions, uniquePairing = true) => {
    const conflicts = [];

    // 1. Time Conflicts
    const byDaySlotCompany = {};
    sessions.forEach(s => {
        if (!s.company_id || s.is_break) return;
        const key = `${s.day_index}-${s.slot_index}-${s.company_id}`;
        if (!byDaySlotCompany[key]) byDaySlotCompany[key] = [];
        byDaySlotCompany[key].push(s);
    });

    Object.entries(byDaySlotCompany).forEach(([, group]) => {
        if (group.length > 1) {
            conflicts.push({
                type: 'TIME_CONFLICT',
                severity: 'error',
                message: `Startup "${group[0].company_name}" is assigned to multiple mentors at the same time slot (Day ${group[0].day_index + 1}, Slot ${group[0].slot_index + 1})`,
                sessions: group,
            });
        }
    });

    // 2. Repeat Mentor-Company Meetings
    const byMentorCompany = {};
    sessions.forEach(s => {
        if (!s.company_id || !s.mentor_id || s.is_break) return;
        const key = uniquePairing
            ? `${s.mentor_id}-${s.company_id}`
            : `${s.day_index}-${s.mentor_id}-${s.company_id}`;
        if (!byMentorCompany[key]) byMentorCompany[key] = [];
        byMentorCompany[key].push(s);
    });

    Object.entries(byMentorCompany).forEach(([, group]) => {
        if (group.length > 1) {
            conflicts.push({
                type: 'REPEAT_MENTOR_COMPANY',
                severity: 'error',
                message: uniquePairing
                    ? `Startup "${group[0].company_name}" meets mentor "${group[0].mentor_name}" more than once across event days`
                    : `Startup "${group[0].company_name}" meets mentor "${group[0].mentor_name}" more than once on Day ${group[0].day_index + 1}`,
                sessions: group,
            });
        }
    });

    // 3. Unassigned Slots (Unique Pairing / Free Slots) -> Warnings
    sessions.forEach(s => {
        if (!s.company_id && !s.is_break && s.conflict_reason) {
            conflicts.push({
                type: 'NOTICE_UNIQUE_PAIRING',
                is_warning: true,
                severity: 'warning',
                message: `Unassigned slot on Day ${s.day_index + 1}, Slot ${s.slot_index + 1} (${s.mentor_name}): ${s.conflict_reason}`,
                sessions: [s],
            });
        }
    });

    return conflicts;
};

/**
 * Convert sessions array to display matrix
 * matrix[dayIndex][slotIndex][mentorId] = session
 */
export const buildMatrix = (sessions, mentors, slotsPerDay, numDays) => {
    const matrix = {};

    for (let day = 0; day < numDays; day++) {
        matrix[day] = {};
        for (let slot = 0; slot < slotsPerDay; slot++) {
            matrix[day][slot] = {};
            mentors.forEach(m => { matrix[day][slot][m.id] = null; });
        }
    }

    sessions.forEach(s => {
        if (matrix[s.day_index] && matrix[s.day_index][s.slot_index] !== undefined) {
            matrix[s.day_index][s.slot_index][s.mentor_id] = s;
        }
    });

    return matrix;
};

/**
 * Get current active slot index based on time
 */
export const getCurrentSlotIndex = (config, dayIndex = 0) => {
    if (!config) return null;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const [sh, sm] = config.start_time.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const slotsPerDay = calcSlotsPerDay(config.total_round_minutes, config.slot_duration_minutes);

    for (let slot = 0; slot < slotsPerDay; slot++) {
        const slotStart = startMinutes + slot * config.slot_duration_minutes;
        const slotEnd = slotStart + config.slot_duration_minutes;

        let offset = 0;
        for (const br of (config.break_slots || [])) {
            if (slot > br.after_slot) offset += (br.duration_minutes || 0);
        }

        if (nowMinutes >= (slotStart + offset) && nowMinutes < (slotEnd + offset)) {
            return slot;
        }
    }

    return null;
};

/**
 * Calculate seconds remaining until current slot ends
 */
export const getSecondsUntilSlotEnd = (config, slotIndex) => {
    if (!config || slotIndex === null) return null;

    const now = new Date();
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    const [sh, sm] = config.start_time.split(':').map(Number);
    const startSeconds = sh * 3600 + sm * 60;

    let offset = 0;
    for (const br of (config.break_slots || [])) {
        if (slotIndex > br.after_slot) offset += (br.duration_minutes || 0) * 60;
    }

    const slotEndSeconds = startSeconds + (slotIndex + 1) * config.slot_duration_minutes * 60 + offset;

    return Math.max(0, slotEndSeconds - nowSeconds);
};

// ============================================================
// PER-DAY CONFIG (Flexible Day-by-Day Schedule)
// ============================================================

export const DEFAULT_PER_DAY_CONFIG = {
    session_start_time: '09:00',
    slot_duration_minutes: 20,
    break_between_slots_minutes: 5,
    total_round_minutes: 300,
    session_end_time: '17:00',
};

/**
 * Fetch all per-day configs for an event
 */
export const getDayConfigs = async (eventId) => {
    const { data, error } = await supabase
        .from('mentoring_distribution_day_config')
        .select('*')
        .eq('event_id', eventId)
        .order('day_index', { ascending: true });

    if (error) throw error;
    return data || [];
};

/**
 * Save a single day config (upsert by event_id + day_index)
 */
export const saveDayConfig = async (eventId, dayIndex, cfg) => {
    const payload = {
        event_id: eventId,
        day_index: dayIndex,
        day_date: cfg.day_date || null,
        session_start_time: cfg.session_start_time || DEFAULT_PER_DAY_CONFIG.session_start_time,
        session_end_time: cfg.session_end_time || null,
        total_round_minutes: cfg.total_round_minutes ?? null,
        slot_duration_minutes: cfg.slot_duration_minutes ?? null,
        break_between_slots_minutes: cfg.break_between_slots_minutes ?? 0,
        mentor_ids: cfg.mentor_ids || [],
    };

    const { data, error } = await supabase
        .from('mentoring_distribution_day_config')
        .upsert(payload, { onConflict: 'event_id,day_index' })
        .select()
        .single();

    if (error) throw error;
    return data;
};

/**
 * Resolve effective config for a specific day, applying per-day overrides
 * and falling back to global config.
 */
export const resolveDayEffectiveConfig = (globalConfig, dayConfigs, dayIndex) => {
    const dayCfg = dayConfigs?.find(c => c.day_index === dayIndex);
    const slotDuration = (dayCfg?.slot_duration_minutes ?? null) !== null
        ? dayCfg.slot_duration_minutes
        : (globalConfig.slot_duration_minutes || 20);

    const startTime = (dayCfg?.session_start_time?.slice(0, 5)) || globalConfig.start_time || '09:00';

    let totalRoundMinutes = (dayCfg?.total_round_minutes ?? null) !== null
        ? dayCfg.total_round_minutes
        : (globalConfig.total_round_minutes || 300);

    if (!dayCfg?.total_round_minutes && dayCfg?.session_end_time) {
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = dayCfg.session_end_time.slice(0, 5).split(':').map(Number);
        totalRoundMinutes = (eh * 60 + em) - (sh * 60 + sm);
    }

    const breakBetween = (dayCfg?.break_between_slots_minutes ?? 0);

    const slots = Math.max(0, Math.floor(totalRoundMinutes / Math.max(slotDuration, 1)));

    return {
        start_time: startTime,
        slot_duration_minutes: slotDuration,
        total_round_minutes: totalRoundMinutes,
        break_between_slots_minutes: breakBetween,
        slots_per_day: slots,
        day_date: dayCfg?.day_date || null,
        mentor_ids: dayCfg?.mentor_ids || null,
        _hasOverride: !!dayCfg && (
            dayCfg.slot_duration_minutes !== null ||
            !!dayCfg.session_end_time ||
            dayCfg.total_round_minutes !== null ||
            dayCfg.session_start_time?.slice(0, 5) !== (globalConfig.start_time || '09:00')
        ),
    };
};

/**
 * Calculate slot start/end times array for a given effective config
 * (accounts for break_between_slots_minutes between every slot)
 */
export const calculateDaySlotTimes = (effectiveConfig) => {
    const {
        start_time,
        slot_duration_minutes,
        break_between_slots_minutes,
        slots_per_day,
    } = effectiveConfig;

    const [sh, sm] = start_time.split(':').map(Number);
    let cursor = sh * 60 + sm;
    const slotTimes = [];

    for (let i = 0; i < slots_per_day; i++) {
        const sH = Math.floor(cursor / 60) % 24;
        const sM = cursor % 60;
        const end = cursor + slot_duration_minutes;
        const eH = Math.floor(end / 60) % 24;
        const eM = end % 60;
        const fmt = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        slotTimes.push({
            slot_index: i,
            start_time: fmt(sH, sM),
            end_time: fmt(eH, eM),
        });
        cursor = end + (break_between_slots_minutes || 0);
    }

    return slotTimes;
};

/**
 * Extended Distribution generator with per-day flexible configs support.
 * If dayConfigs is provided, each day uses its own resolved effective config.
 * Otherwise it falls back to original global-only behavior.
 */
export const generateDistributionFlexible = (globalConfig, dayConfigs, mentors, companies) => {
    const {
        break_slots = [],
        unique_pairing = true,
        mentor_availability = {},
        event_id,
    } = globalConfig;

    const numDays = globalConfig.num_days || 1;
    const sessions = [];

    const mentorMeetCount = {};
    mentors.forEach(m => {
        mentorMeetCount[m.id] = {};
        companies.forEach(c => { mentorMeetCount[m.id][c.id] = 0; });
    });

    const maxSlotsPerDay = [];
    for (let d = 0; d < numDays; d++) {
        const eff = resolveDayEffectiveConfig(globalConfig, dayConfigs, d);
        maxSlotsPerDay.push(eff.slots_per_day);
    }
    const overallMax = Math.max(...maxSlotsPerDay, 0);

    const occupiedSlots = {};
    for (let day = 0; day < numDays; day++) {
        occupiedSlots[day] = {};
        for (let slot = 0; slot < maxSlotsPerDay[day]; slot++) {
            occupiedSlots[day][slot] = {};
        }
    }

    for (let day = 0; day < numDays; day++) {
        const effConfig = resolveDayEffectiveConfig(globalConfig, dayConfigs, day);
        const slotTimes = calculateDaySlotTimes(effConfig);
        const slotsToday = effConfig.slots_per_day;

        const globalAvailable = mentors.filter(m => isMentorAvailableOnDay(m.id, day, mentor_availability));
        const dayMentorIds = effConfig.mentor_ids;
        const availableMentorsToday = dayMentorIds && dayMentorIds.length
            ? globalAvailable.filter(m => dayMentorIds.includes(m.id))
            : globalAvailable;

        const metInRound = {};
        availableMentorsToday.forEach(m => { metInRound[m.id] = new Set(); });

        for (let slot = 0; slot < slotsToday; slot++) {
            const timeInfo = slotTimes[slot] || { start_time: '00:00', end_time: '00:00' };
            const start = timeInfo.start_time;
            const end = timeInfo.end_time;

            for (const mentor of availableMentorsToday) {
                const availableCompanies = companies.filter(c => {
                    const notSeenMentorThisRound = !metInRound[mentor.id].has(c.id);
                    const noTimeConflict = !occupiedSlots[day][slot][c.id];
                    const notSeenAcrossAllDays = !unique_pairing || (mentorMeetCount[mentor.id]?.[c.id] || 0) === 0;
                    return notSeenMentorThisRound && noTimeConflict && notSeenAcrossAllDays;
                });

                if (availableCompanies.length === 0) {
                    const hasMetBeforeInEvent = unique_pairing && companies.some(c => (mentorMeetCount[mentor.id]?.[c.id] || 0) > 0);
                    const isUniquePairingLimit = unique_pairing && hasMetBeforeInEvent;
                    const conflictReason = isUniquePairingLimit
                        ? 'Unique Pairing limit: All available startups have already met this mentor'
                        : 'No available startup: time conflict or already assigned';

                    sessions.push({
                        event_id,
                        day_index: day,
                        slot_index: slot,
                        mentor_id: mentor.id,
                        mentor_name: mentor.name,
                        company_id: null,
                        company_name: null,
                        is_break: false,
                        has_conflict: !isUniquePairingLimit,
                        is_warning: isUniquePairingLimit,
                        conflict_reason: conflictReason,
                        slot_start_time: start,
                        slot_end_time: end,
                    });
                    continue;
                }

                const totalMeetings = (c) => Object.values(mentorMeetCount).reduce((sum, mm) => sum + (mm[c.id] || 0), 0);

                const sorted = [...availableCompanies].sort((a, b) => {
                    const diff = totalMeetings(a) - totalMeetings(b);
                    if (diff !== 0) return diff;
                    return Math.random() - 0.5;
                });

                const chosen = sorted[0];

                sessions.push({
                    event_id,
                    day_index: day,
                    slot_index: slot,
                    mentor_id: mentor.id,
                    mentor_name: mentor.name,
                    company_id: chosen.id,
                    company_name: chosen.name,
                    is_break: false,
                    has_conflict: false,
                    conflict_reason: null,
                    slot_start_time: start,
                    slot_end_time: end,
                });

                metInRound[mentor.id].add(chosen.id);
                occupiedSlots[day][slot][chosen.id] = mentor.id;
                mentorMeetCount[mentor.id][chosen.id] = (mentorMeetCount[mentor.id][chosen.id] || 0) + 1;
            }
        }
    }

    return sessions;
};
