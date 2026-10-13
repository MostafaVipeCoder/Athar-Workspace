/**
 * Timer sounds (Web Audio, as-is `useMentoringTimer` behaviour): a tick every second inside the alert window (700 Hz, then 988 Hz for
 * the last three seconds) and a three-tone alarm at zero. Browsers only allow audio after a user gesture, so the page offers an
 * "Enable sound" switch (remembered per device in localStorage; storage may be unavailable, so every access is guarded).
 */
const STORAGE_KEY = 'athar.dist.sound'
let ctx = null

function audio() {
  if (ctx || typeof window === 'undefined') return ctx
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  try { ctx = new Ctor() } catch { ctx = null }
  return ctx
}

/** Call from a click handler: creates/resumes the audio context. Returns true when sound can play. */
export function unlockAudio() {
  const c = audio()
  if (!c) return false
  try { c.resume?.() } catch { /* ignore */ }
  return true
}

export function readSoundPreference() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
export function writeSoundPreference(on) {
  try { window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0') } catch { /* private mode: not remembered */ }
}

export function beep(frequency, ms = 120, volume = 0.18, delayMs = 0) {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime + delayMs / 1000
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + ms / 1000 + 0.02)
}

/** `secondsLeft` = whole seconds remaining (7..1). */
export const playTick = (secondsLeft) => beep(secondsLeft <= 3 ? 988 : 700, 110)
export function playAlarm() {
  beep(880, 220, 0.25, 0)
  beep(880, 220, 0.25, 320)
  beep(1175, 520, 0.28, 640)
}
