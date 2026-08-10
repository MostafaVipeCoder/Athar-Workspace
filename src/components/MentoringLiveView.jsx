import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Users, AlertTriangle, Wifi, WifiOff, ChevronRight, Briefcase, Calendar, XCircle, Volume2 } from 'lucide-react';
import {
    getDistributionConfig,
    getDistributionSessions,
    getDayConfigs,
    resolveDayEffectiveConfig,
    calculateDaySlotTimes,
    isMentorAvailableOnDay,
} from '../lib/mentoringDistribution';
import { supabase } from '../lib/supabase';
import { getGoogleDriveFallbackUrls } from '../lib/utils';

// ─────────────────────────────────────────────────────────────
// Countdown Timer Component
// ─────────────────────────────────────────────────────────────
function CountdownTimer({ seconds, isAlertMode }) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    const color = isAlertMode
        ? 'text-rose-600 animate-pulse'
        : seconds <= 60
            ? 'text-rose-600'
            : seconds <= 180
                ? 'text-amber-600'
                : 'text-emerald-700';

    return (
        <div className="flex flex-col items-center">
            <div className={`font-mono font-extrabold tabular-nums text-6xl sm:text-8xl ${color} transition-all duration-500 ${isAlertMode ? 'scale-105' : ''}`}>
                {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            {isAlertMode && (
                <div className="mt-2 flex items-center gap-1.5 text-rose-500 text-[10px] font-black uppercase tracking-widest animate-bounce">
                    <Volume2 size={12} />
                    Slot ending soon
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Audio Alert Utility (Web Audio API — no external file needed)
// ─────────────────────────────────────────────────────────────
const ALERT_SECONDS_THRESHOLD = 10;

function useCountdownAudioAlert(secondsLeft, currentSlot, currentDayIndex) {
    const audioCtxRef = useRef(null);
    const lastAlertedSlotKeyRef = useRef(null);
    const lastBeepSecondRef = useRef(null);

    const getAudioCtx = () => {
        if (!audioCtxRef.current) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) audioCtxRef.current = new Ctx();
        }
        return audioCtxRef.current;
    };

    const playBeep = useCallback((freq = 880, durationMs = 120, volume = 0.25) => {
        try {
            const ctx = getAudioCtx();
            if (!ctx) return;

            if (ctx.state === 'suspended') ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + durationMs / 1000);
        } catch (e) {
            console.warn('Audio beep failed:', e.message);
        }
    }, []);

    const playFinalBlast = useCallback(() => {
        [
            { f: 660, d: 120, v: 0.25, delay: 0 },
            { f: 880, d: 120, v: 0.28, delay: 140 },
            { f: 1175, d: 240, v: 0.32, delay: 280 },
        ].forEach(({ f, d, v, delay }) => {
            setTimeout(() => playBeep(f, d, v), delay);
        });
    }, [playBeep]);

    useEffect(() => {
        if (secondsLeft === null || currentSlot === null) return;

        const slotKey = `${currentDayIndex}-${currentSlot}`;
        const newSlot = slotKey !== lastAlertedSlotKeyRef.current;

        if (newSlot) {
            lastAlertedSlotKeyRef.current = slotKey;
            lastBeepSecondRef.current = null;
        }

        if (secondsLeft <= ALERT_SECONDS_THRESHOLD && secondsLeft > 0) {
            if (lastBeepSecondRef.current !== secondsLeft) {
                lastBeepSecondRef.current = secondsLeft;

                if (secondsLeft === ALERT_SECONDS_THRESHOLD) {
                    playBeep(523, 180, 0.25);
                } else if (secondsLeft <= 3 && secondsLeft >= 2) {
                    playBeep(988, 130, 0.28);
                } else if (secondsLeft === 1) {
                    playFinalBlast();
                } else {
                    playBeep(784, 100, 0.22);
                }
            }
        }
    }, [secondsLeft, currentSlot, currentDayIndex, playBeep, playFinalBlast]);

    useEffect(() => () => {
        try { audioCtxRef.current?.close(); } catch (_) {}
    }, []);

    return secondsLeft !== null && secondsLeft <= ALERT_SECONDS_THRESHOLD && secondsLeft > 0 && currentSlot !== null;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function MentoringLiveView() {
    const { eventId } = useParams();
    const [config, setConfig] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentSlot, setCurrentSlot] = useState(null);
    const [secondsLeft, setSecondsLeft] = useState(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [mentorsMap, setMentorsMap] = useState({});
    const [companiesMap, setCompaniesMap] = useState({});
    const [dayConfigs, setDayConfigs] = useState([]);
    const [eventDays, setEventDays] = useState([]);
    const [manualDayOverride, setManualDayOverride] = useState(null);

    // Load data
    const loadData = useCallback(async () => {
        try {
            const [
                cfg,
                sess,
                { data: expertsData },
                { data: companiesData },
                dcs,
                edRes,
            ] = await Promise.all([
                getDistributionConfig(eventId),
                getDistributionSessions(eventId),
                supabase.from('experts').select('*, master:master_experts(*)').eq('event_id', eventId),
                supabase.from('companies').select('company_id, name, logo_url').eq('event_id', eventId),
                (async () => { try { return await getDayConfigs(eventId); } catch(e) { console.warn('day configs load failed:', e.message); return []; } })(),
                (async () => { try { return await supabase.from('event_days').select('*').eq('event_id', eventId).order('day_number', { ascending: true }); } catch(e) { return { data: [] }; } })(),
            ]);
            setConfig(cfg);
            setSessions(sess);
            setDayConfigs(dcs || []);
            setEventDays(edRes?.data || []);

            const mMap = {};
            if (expertsData) {
                expertsData.forEach(exp => {
                    const combined = { ...exp.master, ...exp };
                    mMap[exp.expert_id] = {
                        name: combined.name,
                        photo_url: combined.photo_url,
                        company: combined.company || combined.company_name || '',
                        title: combined.title || '',
                    };
                });
            }
            setMentorsMap(mMap);

            const cMap = {};
            if (companiesData) {
                companiesData.forEach(comp => {
                    cMap[comp.company_id] = {
                        name: comp.name,
                        logo_url: comp.logo_url,
                    };
                });
            }
            setCompaniesMap(cMap);
        } catch (err) {
            console.error('Live view load error:', err);
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    useEffect(() => {
        loadData();

        // Online/offline
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [loadData]);

    // ──────────────────────────────────────────────────────────────
    // Resolve current day index:
    //  1. Manual override (user clicked a day tab - if any)
    //  2. OR match today's date against event_days
    //  3. OR fallback to day 0 (today or first day)
    // ──────────────────────────────────────────────────────────────
    const currentDayIndex = useMemo(() => {
        if (manualDayOverride !== null) return manualDayOverride;
        if (!config) return 0;

        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);

        if (eventDays && eventDays.length > 0) {
            const matchIdx = eventDays.findIndex(ed => {
                if (!ed.day_date) return false;
                const d = new Date(ed.day_date);
                return d.toISOString().slice(0, 10) === todayISO;
            });
            if (matchIdx !== -1) return matchIdx;
        }

        // Fallback: find day from dayConfigs' day_date (without event_days table)
        if (dayConfigs && dayConfigs.length > 0) {
            const mIdx = dayConfigs.findIndex(c => {
                if (!c.day_date) return false;
                const d = new Date(c.day_date);
                return d.toISOString().slice(0, 10) === todayISO;
            });
            if (mIdx !== -1) return mIdx;
        }

        // Default: 0 (first day)
        return 0;
    }, [config, eventDays, dayConfigs, manualDayOverride]);

    // ──────────────────────────────────────────────────────────────
    // Per-day effective config + slot times
    // ──────────────────────────────────────────────────────────────
    const dayEffectiveConfig = useMemo(() => {
        if (!config) return null;
        return resolveDayEffectiveConfig(config, dayConfigs, currentDayIndex);
    }, [config, dayConfigs, currentDayIndex]);

    const slotTimes = useMemo(() => {
        return dayEffectiveConfig ? calculateDaySlotTimes(dayEffectiveConfig) : [];
    }, [dayEffectiveConfig]);

    const activeSlotsPerDay = slotTimes.length;
    const currentDayCfg = dayConfigs.find(c => c.day_index === currentDayIndex);
    const currentDayMeta = eventDays[currentDayIndex];

    // ── Audio alert hook (after all inputs are defined) ──────
    const isAlertMode = useCountdownAudioAlert(secondsLeft, currentSlot, currentDayIndex);

    // Compute current slot for THIS DAY's schedule:
    // match system time (hh:mm) against this day's slotTimes[] start/end windows
    const computeCurrentSlotForDay = () => {
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
    };

    // Tick every second
    useEffect(() => {
        const tick = setInterval(() => {
            const now = new Date();
            setCurrentTime(now);

            if (!dayEffectiveConfig || !slotTimes.length) {
                setCurrentSlot(null);
                setSecondsLeft(null);
                return;
            }

            const slot = computeCurrentSlotForDay();
            setCurrentSlot(slot);
            if (slot !== null) {
                const st = slotTimes[slot];
                const [eh, em] = st.end_time.split(':').map(Number);
                const nowS = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                const endS = eh * 3600 + em * 60;
                setSecondsLeft(Math.max(0, endS - nowS));
            } else {
                setSecondsLeft(null);
            }
        }, 1000);
        return () => clearInterval(tick);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayEffectiveConfig, slotTimes]);

    // Re-fetch data every 60s to stay fresh
    useEffect(() => {
        const interval = setInterval(loadData, 60000);
        return () => clearInterval(interval);
    }, [loadData]);

    const isMentorAvailable = (mentorId, dayIdx) => {
        // 1) Global Participants availability
        const globalOk = (() => {
            if (!config?.mentor_availability) return true;
            const avail = config.mentor_availability[mentorId];
            if (avail === 'excluded' || avail === 'none') return false;
            return isMentorAvailableOnDay(mentorId, dayIdx, config.mentor_availability);
        })();
        if (!globalOk) return false;

        // 2) Per-day mentor_ids override
        if (currentDayCfg?.mentor_ids && currentDayCfg.mentor_ids.length > 0) {
            return currentDayCfg.mentor_ids.includes(mentorId);
        }
        return true;
    };

    // Current slot sessions (assigned + mentor available today)
    const currentSlotSessions = currentSlot !== null
        ? sessions.filter(s => s.day_index === currentDayIndex && s.slot_index === currentSlot && !s.is_break && s.company_id && isMentorAvailable(s.mentor_id, currentDayIndex))
        : [];

    const nextSlotIndex = currentSlot !== null ? currentSlot + 1 : null;
    const nextSlotSessions = nextSlotIndex !== null && nextSlotIndex < activeSlotsPerDay
        ? sessions.filter(s => s.day_index === currentDayIndex && s.slot_index === nextSlotIndex && !s.is_break && isMentorAvailable(s.mentor_id, currentDayIndex))
        : [];

    const currentSlotTime = currentSlot !== null && slotTimes[currentSlot]
        ? { start: slotTimes[currentSlot].start_time, end: slotTimes[currentSlot].end_time }
        : null;

    const dayDateString = (() => {
        const d = currentDayMeta?.day_date || currentDayCfg?.day_date;
        if (d) return new Date(d);
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    })();

    const isDayOff = (() => {
        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);
        const d = currentDayMeta?.day_date || currentDayCfg?.day_date;
        if (!d) return false;
        const dISO = new Date(d).toISOString().slice(0, 10);
        return todayISO !== dISO && manualDayOverride === null;
    })();

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-athar-blue/20 border-t-athar-blue mx-auto" />
                    <p className="mt-6 text-slate-500 font-bold text-lg">Loading...</p>
                </div>
            </div>
        );
    }

    // Not published
    if (config && !config.is_published) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Schedule Not Published Yet</h2>
                    <p className="text-slate-500">The administrator is currently reviewing the mentoring distribution matrix.</p>
                </div>
            </div>
        );
    }

    // No active slot
    const isBeforeStart = currentSlot === null && currentSlotSessions.length === 0;

    const activeMentorsCount = new Set(
        sessions
            .filter(s => s.day_index === currentDayIndex && isMentorAvailable(s.mentor_id, currentDayIndex))
            .map(s => s.mentor_name).filter(Boolean)
    ).size;

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-manrope overflow-hidden relative pb-20" dir="ltr">
            {/* Background gradient */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-athar-blue/5 via-slate-50 to-slate-50 pointer-events-none" />

            {/* Noise texture */}
            <div
                className="absolute inset-0 opacity-[0.015] pointer-events-none mix-blend-soft-light"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
            />

            {/* ── Top bar ──────────────────────────────────────── */}
            <div className="relative z-10 flex items-center justify-between px-6 sm:px-12 pt-6 pb-4 flex-wrap gap-4">
                <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-athar-blue">
                        🔴 LIVE — 1-1 Mentoring Sessions
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Calendar size={13} className="text-athar-blue" />
                            <p className="text-slate-600 text-sm font-extrabold tracking-tight">
                                Today: {currentDayMeta?.day_name || `Day ${currentDayIndex + 1}`}
                                <span className="mx-2 text-slate-300">·</span>
                                <span className="text-slate-500 font-bold normal-case text-[13px]">
                                    {dayDateString.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                </span>
                                {isDayOff && (
                                    <span className="ml-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-500 bg-rose-50 border border-rose-200 rounded-full">
                                        Manual Review
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock size={13} className="text-athar-blue" />
                            <p className="text-slate-500 text-xs font-bold">
                                {activeSlotsPerDay > 0 ? `${format12(slotTimes[0].start_time)} → ${format12(slotTimes[activeSlotsPerDay - 1].end_time)}` : 'No time slots'}
                                <span className="mx-2 text-slate-300">·</span>
                                {activeSlotsPerDay} Slots
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Current time */}
                    <span className="font-mono text-slate-500 text-sm font-bold">
                        {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {/* Online indicator */}
                    <div className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${isOnline ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                        {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                        {isOnline ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>

            {/* ── Day Quick Switcher ───────────────────────────── */}
            {config && config.num_days > 1 && (
                <div className="relative z-10 px-6 sm:px-12 pb-3 overflow-x-auto">
                    <div className="flex gap-2 min-w-max">
                        {Array.from({ length: config.num_days }).map((_, idx) => {
                            const meta = eventDays[idx];
                            const cfg = dayConfigs.find(c => c.day_index === idx);
                            const dDate = meta?.day_date || cfg?.day_date;
                            const isToday = (() => {
                                const todayISO = new Date().toISOString().slice(0, 10);
                                if (!dDate) return false;
                                return new Date(dDate).toISOString().slice(0, 10) === todayISO;
                            })();
                            const active = manualDayOverride === idx || (manualDayOverride === null && currentDayIndex === idx);
                            const daySlots = (() => {
                                const eff = resolveDayEffectiveConfig(config, dayConfigs, idx);
                                return calculateDaySlotTimes(eff).length;
                            })();
                            const assignedMentors = cfg?.mentor_ids?.length || 0;
                            return (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        // Unlock AudioContext on user interaction (browser autoplay policy)
                                        try { const AC = window.AudioContext || window.webkitAudioContext; new AC()?.resume(); } catch (_) {}
                                        setManualDayOverride(manualDayOverride === idx ? null : idx);
                                    }}
                                    className={`flex flex-col items-start gap-0.5 px-4 py-2.5 rounded-xl text-xs font-extrabold border transition-all duration-200 min-w-[140px] cursor-pointer ${
                                        active
                                            ? 'bg-gradient-to-r from-athar-blue to-athar-black text-white border-transparent shadow-md shadow-athar-blue/25'
                                            : 'bg-white border-slate-200/70 text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center justify-between w-full gap-2">
                                        <span className="font-black tracking-wider">Day {idx + 1}</span>
                                        <div className="flex gap-1">
                                            {isToday && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[8px] font-black tracking-widest">
                                                    TODAY
                                                </span>
                                            )}
                                            {cfg && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[8px] font-black tracking-widest">
                                                    FLEX
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className={`text-[10px] font-bold truncate w-full ${active ? 'text-white/80' : 'text-slate-400'}`}>
                                        {meta?.day_name || '—'}
                                    </span>
                                    <span className={`text-[9px] font-bold truncate w-full ${active ? 'text-white/60' : 'text-slate-300'}`}>
                                        {dDate ? new Date(dDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : 'No date'}
                                    </span>
                                    <span className={`text-[9px] font-bold tracking-wider uppercase w-full ${active ? 'text-white/50' : 'text-slate-300'}`}>
                                        {daySlots} slots · {assignedMentors > 0 ? `${assignedMentors} mentors` : 'all mentors'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Main content ─────────────────────────────────── */}
            <div className="relative z-10 px-6 sm:px-12 py-4">
                {activeSlotsPerDay === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <XCircle size={64} className="text-slate-300 mb-6" />
                        <h2 className="text-3xl font-extrabold text-slate-400 mb-2">No Sessions Scheduled for This Day</h2>
                        <p className="text-slate-500 text-lg max-w-md leading-relaxed">
                            Current day settings produced zero slots. Please review Admin Distribution (Time &amp; Slot Settings).
                        </p>
                    </div>
                ) : isBeforeStart || currentSlot === null ? (
                    /* ── No active slot ── */
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <Clock size={64} className="text-slate-300 mb-6" />
                        <h2 className="text-3xl font-extrabold text-slate-400 mb-2">No Active Session Right Now</h2>
                        <p className="text-slate-500 text-lg max-w-md leading-relaxed">
                            {dayEffectiveConfig
                                ? `Sessions for today start at ${format12(dayEffectiveConfig.start_time)} — ${activeSlotsPerDay} slots (${dayEffectiveConfig.slot_duration_minutes} min per slot)`
                                : 'Waiting for sessions to begin'
                            }
                        </p>
                        {currentSlotSessions.length === 0 && nextSlotSessions.length > 0 && (
                            <div className="mt-10 max-w-5xl w-full">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4 text-center">
                                    Upcoming · Slot #{(currentSlot || 0) + 1}
                                </p>
                                <div className="flex flex-wrap gap-3 justify-center">
                                    {nextSlotSessions.map((s, i) => (
                                        <div key={i} className="px-4 py-2.5 bg-white border border-slate-200/60 rounded-xl text-xs text-slate-500 shadow-2xs flex items-center gap-2">
                                            <span className="text-slate-800 font-bold">{s.mentor_name}</span>
                                            {s.company_name && (
                                                <>
                                                    <ChevronRight size={12} className="text-slate-300" />
                                                    <span className="font-extrabold text-slate-600">{s.company_name}</span>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* ── Slot number & countdown ── */}
                        <div className={`flex flex-col sm:flex-row items-center justify-between gap-6 mb-8 pb-6 border-b transition-all duration-500 ${isAlertMode ? 'border-rose-200 bg-rose-50/40 -mx-6 sm:-mx-12 px-6 sm:px-12 py-6 rounded-t-3xl' : 'border-slate-200/80'}`}>
                            <div>
                                <p className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Current Slot</p>
                                <h1 className="text-5xl sm:text-7xl font-black text-slate-800 leading-none">
                                    #{currentSlot + 1}
                                    <span className="text-xl font-extrabold text-slate-400 ml-3">of {activeSlotsPerDay}</span>
                                </h1>
                                {currentSlotTime && (
                                    <p className="text-slate-400 text-sm font-bold mt-2">
                                        {format12(currentSlotTime.start)} — {format12(currentSlotTime.end)}
                                        <span className="mx-3 text-slate-300">·</span>
                                        <span className="text-athar-blue font-black">
                                            {currentDayMeta?.day_name || `Day ${currentDayIndex + 1}`}
                                        </span>
                                    </p>
                                )}
                            </div>
                            <div className="text-center">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Time Remaining</p>
                                {secondsLeft !== null ? (
                                    <CountdownTimer seconds={secondsLeft} isAlertMode={isAlertMode} />
                                ) : (
                                    <span className="text-slate-300 text-6xl font-extrabold">--:--</span>
                                )}
                            </div>
                        </div>

                        {/* ── Session Grid ── */}
                        {currentSlotSessions.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                <p className="text-xl font-bold">No Scheduled Sessions for This Slot</p>
                                <p className="text-sm mt-2 text-slate-400 font-semibold">
                                    All available mentors for today have a Free Slot at this time
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {currentSlotSessions.map((sess, i) => {
                                    const mentor = mentorsMap[sess.mentor_id] || {};
                                    const company = companiesMap[sess.company_id] || {};
                                    
                                    const mentorPhoto = mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url)[0] : null;
                                    const companyLogo = company.logo_url ? getGoogleDriveFallbackUrls(company.logo_url)[0] : null;

                                    return (
                                        <div
                                            key={sess.id || i}
                                            className={`relative rounded-2xl p-5 border transition-all duration-500 bg-white shadow-sm hover:shadow-lg flex flex-col justify-between ${
                                                sess.has_conflict
                                                    ? 'border-red-200 bg-red-50/50'
                                                    : 'border-slate-200/80 hover:border-athar-blue/30 hover:-translate-y-0.5'
                                            }`}
                                            style={{ animationDelay: `${i * 50}ms` }}
                                        >
                                            {sess.has_conflict && (
                                                <div className="absolute top-3 right-3">
                                                    <AlertTriangle size={14} className="text-red-500" />
                                                </div>
                                            )}
                                            
                                            {/* Mentor Details (Top Part) */}
                                            <div className="flex items-start gap-4 mb-4">
                                                {mentorPhoto ? (
                                                    <img 
                                                        src={mentorPhoto} 
                                                        alt={sess.mentor_name} 
                                                        className="w-14 h-14 rounded-full object-cover border border-slate-100 shadow-xs" 
                                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <div className="w-14 h-14 rounded-full bg-athar-blue/10 text-athar-blue font-black flex items-center justify-center text-xl border border-athar-blue/20 shadow-xs">
                                                        {(sess.mentor_name || 'M').charAt(0)}
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[9px] font-black uppercase tracking-wider text-athar-blue/60 mb-0.5">
                                                        Mentor
                                                    </p>
                                                    <h3 className="text-base font-extrabold text-slate-800 leading-tight truncate">
                                                        {sess.mentor_name}
                                                    </h3>
                                                    {mentor.title && (
                                                        <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5" title={mentor.title}>
                                                            {mentor.title}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="h-px bg-slate-100 w-full my-1" />

                                            {/* Startup Details (Bottom Part) */}
                                            <div className="flex items-center gap-4 mt-3">
                                                <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200/60 p-2 flex items-center justify-center shadow-2xs shrink-0 overflow-hidden">
                                                    {companyLogo ? (
                                                        <img 
                                                            src={companyLogo} 
                                                            alt={sess.company_name} 
                                                            className="w-full h-full object-contain" 
                                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <Briefcase size={20} className="text-slate-400" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[9px] font-black uppercase tracking-wider text-amber-600/70 mb-0.5">
                                                        Company / Startup
                                                    </p>
                                                    <p className="text-sm font-extrabold text-slate-700 leading-tight truncate">
                                                        {sess.company_name || <span className="text-slate-300 font-bold">—</span>}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ── Next slot preview ── */}
                        {nextSlotSessions.length > 0 && (
                            <div className="mt-10 pt-6 border-t border-slate-200/80">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <ChevronRight size={14} className="text-slate-400" />
                                    Next · Slot #{nextSlotIndex + 1}
                                    {slotTimes[nextSlotIndex] && (
                                        <span className="text-slate-400/70 font-bold normal-case text-[10px] ml-1">
                                            ({format12(slotTimes[nextSlotIndex].start_time)} — {format12(slotTimes[nextSlotIndex].end_time)})
                                        </span>
                                    )}
                                </p>
                                <div className="flex flex-wrap gap-3">
                                    {nextSlotSessions.map((sess, i) => (
                                        <div key={i} className="px-4 py-2.5 bg-white border border-slate-200/60 rounded-xl text-xs text-slate-500 shadow-2xs flex items-center gap-2">
                                            <span className="text-slate-800 font-bold">{sess.mentor_name}</span>
                                            {sess.company_name && (
                                                <>
                                                    <ChevronRight size={12} className="text-slate-300" />
                                                    <span className="font-extrabold text-slate-600">{sess.company_name}</span>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Bottom Sticky Progress Bar */}
            <div className={`fixed bottom-0 left-0 right-0 px-6 sm:px-12 py-3.5 border-t bg-white/90 backdrop-blur-xl z-20 shadow-lg flex-wrap gap-3 flex items-center justify-between transition-all duration-500 ${isAlertMode ? 'border-rose-200 bg-rose-50/85' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                    <Users size={14} className="text-slate-400" />
                    <span>
                        {activeMentorsCount} Active Mentor{activeMentorsCount === 1 ? '' : 's'} · Day {currentDayIndex + 1}
                    </span>
                </div>
                <div className="flex gap-1.5">
                    {Array.from({ length: activeSlotsPerDay }).map((_, i) => (
                        <div
                            key={i}
                            className={`h-2 rounded-full transition-all duration-500 ${
                                i === currentSlot
                                    ? `w-6 shadow-xs ${isAlertMode ? 'bg-rose-500 animate-pulse' : 'bg-athar-blue'}`
                                    : i < (currentSlot || 0)
                                        ? `w-1.5 ${isAlertMode ? 'bg-rose-300/70' : 'bg-athar-blue/30'}`
                                        : 'w-1.5 bg-slate-200'
                            }`}
                        />
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    {isAlertMode && (
                        <div className="flex items-center gap-1 text-rose-500 text-[10px] font-black uppercase tracking-widest animate-pulse">
                            <Volume2 size={12} />
                            Alert
                        </div>
                    )}
                    <p className="text-slate-400 text-xs font-black uppercase tracking-wider">1-1 Mentoring Live</p>
                </div>
            </div>
        </div>
    );
}

function format12(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
