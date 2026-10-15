import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';

const ALERT_SECONDS_THRESHOLD = 7;

export function useMentoringTimer({
    eventId,
    initialSeconds = 900,
    dayIndex = 0,
    slotIndex = 0,
    isMaster = false,
}) {
    const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
    const [isPaused, setIsPaused] = useState(false);
    const [isMuted, setIsMuted] = useState(() => {
        try {
            return localStorage.getItem('mentoring_timer_muted') === 'true';
        } catch {
            return false;
        }
    });

    const channelRef = useRef(null);
    const audioCtxRef = useRef(null);
    const lastAlertedSecondRef = useRef(null);
    const initialSecondsRef = useRef(initialSeconds);

    useEffect(() => {
        initialSecondsRef.current = initialSeconds;
    }, [initialSeconds]);

    // ── Web Audio API sound generator ──────────────────────────
    const getAudioCtx = () => {
        if (!audioCtxRef.current) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                audioCtxRef.current = new AudioContext();
            }
        }
        return audioCtxRef.current;
    };

    const playTone = useCallback((freq = 800, durationMs = 100, volume = 0.25) => {
        if (isMuted) return;
        try {
            const ctx = getAudioCtx();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
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
            console.warn('[Timer Audio] Tone error:', e.message);
        }
    }, [isMuted]);

    const playFinishAlarm = useCallback(() => {
        if (isMuted) return;
        [
            { f: 523, d: 150, v: 0.3, delay: 0 },
            { f: 659, d: 150, v: 0.35, delay: 150 },
            { f: 784, d: 300, v: 0.4, delay: 300 },
        ].forEach(({ f, d, v, delay }) => {
            setTimeout(() => playTone(f, d, v), delay);
        });
    }, [isMuted, playTone]);

    // ── Supabase Realtime Channel ──────────────────────────────
    useEffect(() => {
        if (!eventId) return;

        const channelName = `mentoring_timer_${eventId}`;
        const channel = supabase.channel(channelName, {
            config: { broadcast: { self: false } },
        });

        channel
            .on('broadcast', { event: 'timer_action' }, ({ payload }) => {
                if (!payload) return;
                if (payload.type === 'PAUSE') {
                    setIsPaused(true);
                } else if (payload.type === 'RESUME') {
                    setIsPaused(false);
                } else if (payload.type === 'ADJUST') {
                    setSecondsLeft(prev => Math.max(0, prev + (payload.seconds || 0)));
                } else if (payload.type === 'RESET') {
                    setSecondsLeft(payload.seconds ?? initialSecondsRef.current);
                    setIsPaused(false);
                } else if (payload.type === 'SYNC') {
                    if (typeof payload.secondsLeft === 'number') {
                        setSecondsLeft(payload.secondsLeft);
                    }
                    if (typeof payload.isPaused === 'boolean') {
                        setIsPaused(payload.isPaused);
                    }
                }
            })
            .subscribe();

        channelRef.current = channel;

        return () => {
            supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [eventId]);

    // ── Broadcast sender helper ────────────────────────────────
    const broadcastAction = useCallback((action) => {
        if (channelRef.current) {
            channelRef.current.send({
                type: 'broadcast',
                event: 'timer_action',
                payload: { ...action, timestamp: Date.now(), dayIndex, slotIndex },
            });
        }
    }, [dayIndex, slotIndex]);

    // ── Actions ────────────────────────────────────────────────
    const adjustTime = useCallback((deltaSeconds) => {
        setSecondsLeft(prev => {
            const next = Math.max(0, prev + deltaSeconds);
            return next;
        });
        broadcastAction({ type: 'ADJUST', seconds: deltaSeconds });
    }, [broadcastAction]);

    const togglePause = useCallback(() => {
        setIsPaused(prev => {
            const next = !prev;
            broadcastAction({ type: next ? 'PAUSE' : 'RESUME' });
            return next;
        });
    }, [broadcastAction]);

    const resetTimer = useCallback((overrideSeconds = null) => {
        const secs = overrideSeconds ?? initialSecondsRef.current;
        setSecondsLeft(secs);
        setIsPaused(false);
        lastAlertedSecondRef.current = null;
        broadcastAction({ type: 'RESET', seconds: secs });
    }, [broadcastAction]);

    const setExactSeconds = useCallback((secs) => {
        setSecondsLeft(secs);
        broadcastAction({ type: 'SYNC', secondsLeft: secs, isPaused });
    }, [broadcastAction, isPaused]);

    const toggleMute = useCallback(() => {
        setIsMuted(prev => {
            const next = !prev;
            try {
                localStorage.setItem('mentoring_timer_muted', String(next));
            } catch (_) {}
            return next;
        });
    }, []);

    // ── Countdown Interval ─────────────────────────────────────
    useEffect(() => {
        if (isPaused) return;

        const interval = setInterval(() => {
            setSecondsLeft(prev => {
                if (prev <= 1) {
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isPaused]);

    // ── 7-Second Audio Alerts ──────────────────────────────────
    useEffect(() => {
        if (secondsLeft === null || isPaused) return;

        if (secondsLeft <= ALERT_SECONDS_THRESHOLD && secondsLeft >= 0) {
            if (lastAlertedSecondRef.current !== secondsLeft) {
                lastAlertedSecondRef.current = secondsLeft;

                if (secondsLeft === 0) {
                    playFinishAlarm();
                } else if (secondsLeft <= 3) {
                    playTone(988, 120, 0.35); // Higher pitch for final 3 seconds
                } else {
                    playTone(700, 80, 0.22);  // Warning tick for 7..4 seconds
                }
            }
        } else if (secondsLeft > ALERT_SECONDS_THRESHOLD) {
            lastAlertedSecondRef.current = null;
        }
    }, [secondsLeft, isPaused, playTone, playFinishAlarm]);

    return {
        secondsLeft,
        isPaused,
        isMuted,
        isAlertMode: secondsLeft !== null && secondsLeft <= ALERT_SECONDS_THRESHOLD && secondsLeft > 0,
        isFinished: secondsLeft === 0,
        adjustTime,
        togglePause,
        resetTimer,
        setExactSeconds,
        toggleMute,
    };
}
