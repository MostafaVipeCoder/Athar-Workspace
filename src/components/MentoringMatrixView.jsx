import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
    Grid3X3, Printer, AlertTriangle, Sun, AlertCircle, Calendar, CheckCircle2, 
    XCircle, Clock, Volume2, VolumeX, Play, Pause, Plus, Minus, RotateCcw 
} from 'lucide-react';
import {
    getDistributionConfig,
    getDistributionSessions,
    buildMatrix,
    isMentorAvailableOnDay,
    getDayConfigs,
    resolveDayEffectiveConfig,
    calculateDaySlotTimes,
} from '../lib/mentoringDistribution';
import { useMentoringTimer } from '../lib/useMentoringTimer';
import { supabase } from '../lib/supabase';

export default function MentoringMatrixView() {
    const { eventId } = useParams();
    const [config, setConfig] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [mentors, setMentors] = useState([]);
    const [dayConfigs, setDayConfigs] = useState([]);
    const [eventDays, setEventDays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeDay, setActiveDay] = useState(0);
    const [currentTime, setCurrentTime] = useState(new Date());

    const timeTo12Hour = (t) => {
        if (!t) return '';
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    const loadAll = useCallback(async () => {
        try {
            const [
                cfg,
                sess,
                { data: mentorData },
                dcs,
                edRes,
            ] = await Promise.all([
                getDistributionConfig(eventId),
                getDistributionSessions(eventId),
                supabase.from('experts').select('expert_id, name, title, photo_url').eq('event_id', eventId).order('sort_order', { ascending: true }),
                (async () => { try { return await getDayConfigs(eventId); } catch(e) { console.warn('day configs failed:', e.message); return []; } })(),
                (async () => { try { return await supabase.from('event_days').select('*').eq('event_id', eventId).order('day_number', { ascending: true }); } catch(e) { return { data: [] }; } })(),
            ]);
            setConfig(cfg);
            setSessions(sess);
            setMentors((mentorData || []).map(e => ({ id: e.expert_id, name: e.name, title: e.title, photo_url: e.photo_url })));
            setDayConfigs(dcs || []);
            setEventDays(edRes?.data || []);
        } catch (err) {
            console.error('Matrix view load error:', err);
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    useEffect(() => { loadAll(); }, [loadAll]);

    // ────────────────────────────────────────────────────────────
    // Per-day dynamic computation (NO EMPTY ROWS/COLUMNS)
    // NOTE: All hooks must be called BEFORE early returns (Rules of Hooks)
    // ────────────────────────────────────────────────────────────

    // Build effective config + slot times array for active day
    const activeEffectiveConfig = useMemo(() => (
        config ? resolveDayEffectiveConfig(config, dayConfigs, activeDay) : null
    ), [config, dayConfigs, activeDay]);

    const slotTimes = useMemo(() => (
        activeEffectiveConfig ? calculateDaySlotTimes(activeEffectiveConfig) : []
    ), [activeEffectiveConfig]);

    const activeSlotsPerDay = slotTimes.length;
    const activeDayMeta = eventDays[activeDay];
    const activeDayCfg = dayConfigs.find(c => c.day_index === activeDay);

    // Mentor availability (global Participants rules + optional per-day mentor_ids override)
    const isMentorAvailableOnActiveDay = (mentorId) => {
        // 1) Global Participants availability
        const globalOk = (() => {
            if (!config?.mentor_availability) return true;
            const avail = config.mentor_availability[mentorId];
            if (avail === 'excluded' || avail === 'none') return false;
            return isMentorAvailableOnDay(mentorId, activeDay, config.mentor_availability);
        })();
        if (!globalOk) return false;

        // 2) Per-day mentor_ids override (if set for this day)
        if (activeDayCfg?.mentor_ids && activeDayCfg.mentor_ids.length > 0) {
            return activeDayCfg.mentor_ids.includes(mentorId);
        }
        return true;
    };

    const activeMentors = useMemo(
        () => mentors.filter(m => isMentorAvailableOnActiveDay(m.id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mentors, dayConfigs, eventDays, activeDay, config]
    );

    // Build matrix with the day's actual slot count
    const matrix = useMemo(
        () => config ? buildMatrix(sessions, mentors, activeSlotsPerDay, Math.max(config.num_days, 1)) : {},
        [sessions, mentors, activeSlotsPerDay, config?.num_days]
    );

    const hasConflicts = sessions.some(s => s.has_conflict);

    // Current slot calculation for active day
    const computeCurrentSlotForActiveDay = useCallback(() => {
        if (!slotTimes.length) return null;
        const now = currentTime || new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        for (let i = 0; i < slotTimes.length; i++) {
            const st = slotTimes[i];
            const [sh, sm] = st.start_time.split(':').map(Number);
            const [eh, em] = st.end_time.split(':').map(Number);
            const startM = sh * 60 + sm;
            const endM = eh * 60 + em;
            if (nowMins >= startM && nowMins < endM) return i;
        }
        return null;
    }, [slotTimes, currentTime]);

    const [currentSlot, setCurrentSlot] = useState(null);

    useEffect(() => {
        const tick = setInterval(() => {
            const now = new Date();
            setCurrentTime(now);
            setCurrentSlot(computeCurrentSlotForActiveDay());
        }, 1000);
        return () => clearInterval(tick);
    }, [computeCurrentSlotForActiveDay]);

    const defaultSlotSeconds = (activeEffectiveConfig?.slot_duration_minutes || 20) * 60;

    const {
        secondsLeft,
        isPaused,
        isMuted,
        isAlertMode,
        adjustTime,
        togglePause,
        resetTimer,
        setExactSeconds,
        toggleMute,
    } = useMentoringTimer({
        eventId,
        initialSeconds: defaultSlotSeconds,
        dayIndex: activeDay,
        slotIndex: currentSlot || 0,
    });

    const prevSlotRef = useRef(null);
    useEffect(() => {
        if (currentSlot !== null && currentSlot !== prevSlotRef.current) {
            prevSlotRef.current = currentSlot;
            const st = slotTimes[currentSlot];
            if (st) {
                const [eh, em] = st.end_time.split(':').map(Number);
                const now = new Date();
                const nowS = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                const endS = eh * 3600 + em * 60;
                setExactSeconds(Math.max(0, endS - nowS));
            }
        }
    }, [currentSlot, slotTimes, setExactSeconds]);

    // Responsive sizing
    const mentorCount = activeMentors.length || 1;
    const isDense = mentorCount > 8;
    const isUltraDense = mentorCount > 14;

    const cellPadding = isUltraDense ? 'px-1 py-1' : isDense ? 'px-1.5 py-1.5' : 'px-3 py-2.5';
    const mentorFontSize = isUltraDense ? 'text-[10px]' : isDense ? 'text-xs' : 'text-sm';
    const startupFontSize = isUltraDense ? 'text-[9px]' : isDense ? 'text-[11px]' : 'text-xs';

    const hasActiveDayCustomConfig = !!activeDayCfg;

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center font-manrope">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-athar-blue/20 border-t-athar-blue mx-auto" />
                    <p className="mt-4 text-slate-500 font-bold">Loading Matrix Schedule...</p>
                </div>
            </div>
        );
    }

    if (!config) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center font-manrope">
                <div className="text-center p-8 max-w-sm">
                    <Grid3X3 size={48} className="text-slate-300 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-700 mb-2">Schedule Not Configured</h2>
                    <p className="text-slate-500 text-sm">Please wait for the administrator to set up the mentoring schedule.</p>
                </div>
            </div>
        );
    }

    if (!config.is_published) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center font-manrope">
                <div className="text-center p-8 max-w-sm">
                    <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-700 mb-2">Schedule Not Published Yet</h2>
                    <p className="text-slate-500 text-sm">The administrator is currently reviewing the distribution matrix.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-manrope text-slate-800 flex flex-col w-full max-w-full overflow-x-hidden relative pb-8">
            {/* Background Gradient */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-slate-50 to-slate-50" />

            {/* Header */}
            <div className="relative z-10 bg-white border-b border-slate-200/80 py-6 px-4 sm:px-8 overflow-hidden shrink-0 no-print shadow-xs">
                <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-athar-blue flex items-center gap-1.5">
                                <Grid3X3 size={14} /> Full 1-1 Mentoring Matrix
                            </p>
                            {hasActiveDayCustomConfig && (
                                <span className="px-2.5 py-1 rounded-full bg-athar-blue/10 text-athar-blue text-[9px] font-black uppercase tracking-widest border border-athar-blue/20">
                                    Flexible Per-Day Config Active
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">
                            Mentoring Distribution Matrix
                        </h1>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                            <div className="flex items-center gap-2">
                                <Calendar size={13} className="text-athar-blue" />
                                <span className="text-slate-500 text-xs font-bold">
                                    {activeDayMeta?.day_date
                                        ? new Date(activeDayMeta.day_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                                        : `Day ${activeDay + 1}`}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <CheckCircle2 size={13} className="text-emerald-500" />
                                <span className="text-slate-500 text-xs font-bold">
                                    {activeMentors.length} / {mentors.length} Available Mentors
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Sun size={13} className="text-amber-500" />
                                <span className="text-slate-500 text-xs font-bold">
                                    {activeSlotsPerDay} Slots · {timeTo12Hour(activeEffectiveConfig.start_time)} → {activeSlotsPerDay > 0 ? timeTo12Hour(slotTimes[activeSlotsPerDay - 1].end_time) : '--:--'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <AlertCircle size={13} className={hasConflicts ? 'text-rose-500' : 'text-slate-300'} />
                                <span className={`text-xs font-bold ${hasConflicts ? 'text-rose-600' : 'text-slate-400'}`}>
                                    {hasConflicts ? 'Contains Conflicts' : 'No Conflicts'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-athar-blue to-athar-black hover:opacity-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-athar-blue/25 cursor-pointer"
                    >
                        <Printer size={14} /> Print Matrix
                    </button>
                </div>
            </div>

            {/* Day Tabs */}
            <div className="relative z-10 border-b border-slate-200/60 bg-white/40 no-print shrink-0">
                <div className="px-4 sm:px-8 flex gap-1 overflow-x-auto">
                    {Array.from({ length: config.num_days }).map((_, dayIdx) => {
                        const meta = eventDays[dayIdx];
                        const cfg = dayConfigs.find(c => c.day_index === dayIdx);
                        const eff = resolveDayEffectiveConfig(config, dayConfigs, dayIdx);
                        const slotsToday = calculateDaySlotTimes(eff).length;
                        const assignedCount = cfg?.mentor_ids?.length || 0;
                        return (
                            <button
                                key={dayIdx}
                                onClick={() => setActiveDay(dayIdx)}
                                className={`flex flex-col items-start gap-0.5 px-5 py-3 text-xs font-extrabold border-b-2 transition-all duration-200 whitespace-nowrap min-w-[130px] cursor-pointer ${
                                    activeDay === dayIdx
                                        ? 'border-athar-blue text-athar-blue bg-white/70 font-black shadow-inner shadow-athar-blue/5'
                                        : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
                                }`}
                            >
                                <div className="flex items-center gap-2 w-full">
                                    <Sun size={13} />
                                    <span>Day {dayIdx + 1}</span>
                                    {cfg && (
                                        <span className="ml-auto px-1.5 py-0.5 rounded bg-athar-blue/15 text-athar-blue text-[9px] font-black tracking-wider">
                                            FLEX
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 truncate w-full normal-case tracking-normal">
                                    {meta?.day_name || (meta?.day_date ? new Date(meta.day_date).toLocaleDateString(undefined, { weekday: 'short' }) : '')}
                                </span>
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                        {slotsToday} slots
                                    </span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                        {assignedCount > 0 ? `${assignedCount} mentors` : 'all mentors'}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Live Synchronized Timer Bar (Interactive Controls) */}
            <div className="relative z-10 bg-slate-900 text-white px-4 sm:px-8 py-2.5 no-print flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3">
                    <span className="flex h-2.5 w-2.5 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${currentSlot !== null ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${currentSlot !== null ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                        {currentSlot !== null ? `الجلسة الحالية: #${currentSlot + 1} (${slotTimes[currentSlot]?.start_time} - ${slotTimes[currentSlot]?.end_time})` : 'لا توجد جلسة جارية حالياً (Waiting for next slot)'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 font-mono text-sm font-extrabold tabular-nums">
                        <Clock size={14} className="text-athar-blue" />
                        <span className={`${isAlertMode ? 'text-rose-400 animate-pulse font-black' : secondsLeft && secondsLeft <= 60 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {secondsLeft !== null ? `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}` : '--:--'}
                        </span>
                        {isPaused && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-bold uppercase">
                                Paused
                            </span>
                        )}
                    </div>

                    {/* Timer Control Buttons */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => adjustTime(-60)}
                            title="تخفيض دقيقة (-1m)"
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-all active:scale-95 cursor-pointer"
                        >
                            -1m
                        </button>
                        <button
                            onClick={() => adjustTime(60)}
                            title="زيادة دقيقة (+1m)"
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-all active:scale-95 cursor-pointer"
                        >
                            +1m
                        </button>
                        <button
                            onClick={togglePause}
                            title={isPaused ? "استئناف (Resume)" : "إيقاف مؤقت (Pause)"}
                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all active:scale-95 flex items-center gap-1 cursor-pointer ${
                                isPaused ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'
                            }`}
                        >
                            {isPaused ? <Play size={11} className="fill-white" /> : <Pause size={11} className="fill-white" />}
                            {isPaused ? 'استئناف' : 'إيقاف مؤقت'}
                        </button>
                        <button
                            onClick={() => resetTimer(defaultSlotSeconds)}
                            title="إعادة ضبط الوقت (Reset)"
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-all active:scale-95 cursor-pointer"
                        >
                            <RotateCcw size={13} />
                        </button>
                        <button
                            onClick={toggleMute}
                            title={isMuted ? "تفعيل الصوت (Unmute)" : "كتم الصوت (Mute)"}
                            className={`p-1.5 rounded-lg border transition-all active:scale-95 cursor-pointer ${
                                isMuted ? 'bg-rose-900/40 border-rose-700 text-rose-400' : 'bg-slate-800 border-slate-700 text-slate-300'
                            }`}
                        >
                            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* FIT-TO-SCREEN MATRIX TABLE */}
            <div className="relative z-10 flex-1 w-full max-w-full overflow-x-hidden p-2 sm:p-4">
                {activeMentors.length === 0 || activeSlotsPerDay === 0 ? (
                    <div className="w-full border border-slate-200/80 rounded-xl bg-white shadow-xl shadow-slate-100/50 p-12 flex flex-col items-center justify-center text-center">
                        {activeMentors.length === 0 ? (
                            <>
                                <XCircle size={52} className="text-slate-300 mb-4" />
                                <h3 className="text-xl font-black text-slate-700 mb-2">No Available Mentors for This Day</h3>
                                <p className="text-slate-500 text-sm font-semibold max-w-md leading-relaxed">
                                    All mentors are marked as unavailable for Day {activeDay + 1}. Please adjust Participants availability or Per-Day Mentor Selection in the Admin Distribution tool.
                                </p>
                            </>
                        ) : (
                            <>
                                <AlertCircle size={52} className="text-slate-300 mb-4" />
                                <h3 className="text-xl font-black text-slate-700 mb-2">No Time Slots for This Day</h3>
                                <p className="text-slate-500 text-sm font-semibold max-w-md leading-relaxed">
                                    The schedule configuration for Day {activeDay + 1} produced zero slots. Please verify start/end times, total round duration and slot duration.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="w-full max-w-full border border-slate-200/80 rounded-xl bg-white shadow-xl shadow-slate-100/50 overflow-hidden">
                        <table className="w-full max-w-full table-fixed border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200/80">
                                    {/* Time Header Column */}
                                    <th className="w-20 sm:w-28 px-2 py-3.5 text-center text-xs font-black text-slate-400 border-r border-slate-200/60 shrink-0">
                                        Time
                                    </th>
                                    {/* Dynamically proportioned Mentor Columns */}
                                    {activeMentors.map(m => (
                                        <th
                                            key={m.id}
                                            title={`${m.name}${m.title ? ` - ${m.title}` : ''}`}
                                            className={`${cellPadding} text-center border-r border-slate-200/60 bg-slate-50/30 overflow-hidden text-ellipsis whitespace-nowrap`}
                                        >
                                            <p className={`${mentorFontSize} font-black text-slate-700 truncate`}>
                                                {m.name}
                                            </p>
                                            {m.title && !isUltraDense && (
                                                <p className="text-[9px] text-slate-400 truncate font-bold mt-0.5">
                                                    {m.title}
                                                </p>
                                            )}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {slotTimes.map((st, slotIdx) => (
                                    <tr
                                        key={slotIdx}
                                        className={`transition-colors ${slotIdx % 2 === 0 ? 'bg-transparent' : 'bg-slate-50/10'} hover:bg-slate-50/50`}
                                    >
                                        {/* Time Cell — using Per-Day dynamic times */}
                                        <td className="w-20 sm:w-28 px-2 py-2 text-center border-r border-slate-200/60 bg-inherit shrink-0">
                                            <p className="text-xs font-black text-slate-700 whitespace-nowrap">{timeTo12Hour(st.start_time)}</p>
                                            <p className="text-[10px] text-slate-400 whitespace-nowrap">{timeTo12Hour(st.end_time)}</p>
                                            <span className="text-[9px] text-slate-300 font-extrabold">#{slotIdx + 1}</span>
                                        </td>

                                        {/* Mentor Cells */}
                                        {activeMentors.map(m => {
                                            const sess = matrix?.[activeDay]?.[slotIdx]?.[m.id];
                                            return (
                                                <td key={m.id} className={`${cellPadding} border-r border-slate-100 text-center overflow-hidden align-middle`}>
                                                    {sess ? (
                                                        sess.company_name ? (
                                                            <div
                                                                title={`Startup: ${sess.company_name}\nMentor: ${m.name}\nTime: ${timeTo12Hour(st.start_time)} - ${timeTo12Hour(st.end_time)}`}
                                                                className={`w-full rounded-lg ${cellPadding} font-bold transition-all truncate ${
                                                                    sess.has_conflict
                                                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                                                        : 'bg-amber-50 text-amber-900 border border-amber-200'
                                                                } ${startupFontSize}`}
                                                            >
                                                                {sess.has_conflict && (
                                                                    <AlertCircle size={10} className="inline mr-1 text-rose-600 shrink-0" />
                                                                )}
                                                                {sess.company_name}
                                                            </div>
                                                        ) : (
                                                            <div
                                                                title={sess.conflict_reason || 'Free slot available for mentor'}
                                                                className={`w-full rounded-lg ${cellPadding} font-semibold bg-amber-50/60 text-amber-700/80 border border-amber-200/60 ${startupFontSize} truncate`}
                                                            >
                                                                Free Slot
                                                            </div>
                                                        )
                                                    ) : (
                                                        <span className="text-xs text-slate-300 select-none">—</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Footer Legend */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 no-print text-xs font-semibold text-slate-400">
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 rounded-md bg-amber-50 border border-amber-200" />
                            <span>Assigned Session</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 rounded-md bg-amber-50/60 border border-amber-200/60" />
                            <span>Free Slot</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 font-bold">—</span>
                            <span>Empty Slot</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500">
                            <Calendar size={13} />
                            <span>{activeMentors.length} Mentors × {activeSlotsPerDay} Slots = {activeMentors.length * activeSlotsPerDay} Cells Rendered (Day {activeDay + 1})</span>
                        </div>
                    </div>
                    <div className="text-[11px] text-slate-400/80">
                        Fits 100% of viewport width · Hover any cell to view full startup details
                    </div>
                </div>
            </div>

            {/* Print Styles */}
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { background: white !important; color: black !important; }
                    table { font-size: 10px; table-layout: fixed; width: 100% !important; }
                    td, th { padding: 3px 4px !important; color: black !important; border-color: #ddd !important; }
                    tr { background: white !important; }
                    thead tr { background: #f5f5f5 !important; }
                    div[class*="bg-athar"], div[class*="bg-\\[#0d0e0e"] { background: white !important; }
                }
            `}</style>
        </div>
    );
}
