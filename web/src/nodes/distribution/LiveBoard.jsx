import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { to12h } from '../../lib/time/slots.js'
import { TimeRange } from './TimeRange.jsx'
import { publicThumbUrl } from '../../data/storage.js'
import { dayDate, dayLabel } from './dayLabels.js'
import { dayTimes, formatMMSS, liveRound, nameOf, roundNeighbour, roundPairs } from './distributionLogic.js'
import { playAlarm, playTick, readSoundPreference, unlockAudio, writeSoundPreference } from './timerSound.js'
import { useNow } from './useNow.js'

/**
 * The live board (design 01 section 3.7 "Live", as-is `MentoringLiveView` for a TV): the round in progress with its big countdown,
 * who meets whom, and the next round. The remaining time is computed HERE from the server timestamps of the shared timer
 * (`timer.ends_at` / `remaining_s` + the server clock offset) - no per-second writes, no socket; the page polls the tiny timer RPC.
 * Without a timer round the board follows the wall clock of the PROJECT zone (as-is: viewer-local clock vs UTC "today", CON-10).
 * Props: model (client model), timer (payload of get_distribution_timer / get_distribution_timer_state), offsetMs (server clock - local
 * clock), controls (PM remote, only rendered by pages that know the viewer is a project manager), title.
 * Sounds: tick in the alert window, alarm at zero; the viewer switches them on (browsers need a gesture), config `timer.sounds` can disable them.
 */
export default function LiveBoard({ model, timer, offsetMs = 0, controls = null, title }) {
  const { t, lang } = useLanguage()
  const now = useNow(250)
  const cfg = model.config.timer
  const round = liveRound(model, timer, now, offsetMs)
  const day = round.dayId ? model.days.find((d) => d.id === round.dayId) : null
  const times = day ? dayTimes(day) : []
  const slot = round.slotIndex !== null && round.slotIndex !== undefined ? times[round.slotIndex] : null
  const nextRef = day && round.slotIndex !== null && round.slotIndex !== undefined ? roundNeighbour(model.days, day.id, round.slotIndex, round.state === 'in' ? 1 : 0) : null
  const nextDay = nextRef ? model.days.find((d) => d.id === nextRef.dayId) : null
  const nextSlot = nextDay ? dayTimes(nextDay)[nextRef.slotIndex] : null
  const pairs = round.state === 'in' && day ? roundPairs(model, day.id, round.slotIndex, lang) : []
  const nextPairs = nextRef && (round.state === 'in' || round.state === 'before' || round.state === 'between') ? roundPairs(model, nextRef.dayId, nextRef.slotIndex, lang) : []

  const remaining = round.secondsLeft
  const running = round.status === 'running' || round.status === 'clock'
  const alerting = round.state === 'in' && running && remaining !== null && remaining <= cfg.alertSeconds
  const timeUp = round.state === 'in' && remaining !== null && remaining <= 0

  // ---- sounds
  const [sound, setSound] = useState(() => readSoundPreference())
  const last = useRef({ sec: null, alarmed: null })
  const soundKey = `${timer?.version ?? 0}|${round.dayId}|${round.slotIndex}`
  useEffect(() => {
    if (!cfg.sounds || !sound || round.state !== 'in' || !running || remaining === null) return
    const sec = Math.ceil(remaining)
    if (sec > 0 && sec <= cfg.alertSeconds && last.current.sec !== sec) {
      last.current.sec = sec
      playTick(sec)
    }
    if (remaining <= 0 && last.current.alarmed !== soundKey) {
      last.current.alarmed = soundKey
      playAlarm()
    }
  })
  const toggleSound = () => {
    const next = !sound
    if (next) unlockAudio()
    setSound(next)
    writeSoundPreference(next)
  }

  // ---- fullscreen (TV)
  const boardRef = useRef(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFull = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen()
      else boardRef.current?.requestFullscreen?.()
    } catch { /* not supported */ }
  }

  if (model.days.length === 0 || model.sessions.length === 0) return <EmptyState title={t('distribution.view.empty')} body={t('distribution.view.emptyBody')} />

  const statusText = round.state === 'in'
    ? round.source === 'clock' ? t('distribution.live.status.clock') : round.status === 'paused' ? t('distribution.live.status.paused') : timeUp ? t('distribution.live.status.up') : t('distribution.live.status.running')
    : t(`distribution.live.state.${round.state}`)

  return (
    <div ref={boardRef} className={cn('space-y-6 bg-background', full && 'min-h-dvh p-8')} data-testid="live-board" data-state={round.state} data-source={round.source} data-status={round.status ?? ''}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {title && <h2 className="truncate font-display text-section-title" dir="auto">{title}</h2>}
          {day && <p className="text-muted-foreground" dir="auto">{dayLabel(day, lang, t)}{day.date ? ` - ${dayDate(day, lang)}` : ''}</p>}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {cfg.sounds && (
            <Button variant={sound ? 'secondary' : 'outline'} size="sm" onClick={toggleSound} aria-pressed={sound} data-testid="live-sound">
              {sound ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
              {sound ? t('distribution.live.soundOn') : t('distribution.live.soundOff')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={toggleFull} data-testid="live-fullscreen">
            {full ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            {full ? t('distribution.live.exitFullscreen') : t('distribution.live.fullscreen')}
          </Button>
        </div>
      </header>

      <section aria-live="off" className={cn('rounded-card border-2 p-6 text-center transition-colors', alerting ? 'border-destructive bg-destructive/5' : 'border-primary bg-primary/5')} data-testid="live-countdown-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{statusText}</p>
        {slot && (
          <p className="mt-1 text-lg font-semibold" dir="auto">
            {t('distribution.live.roundOf', { n: round.slotIndex + 1, total: day.slots })} <span className="tabular-nums text-muted-foreground">(<TimeRange start={slot.startMinutes} end={slot.endMinutes} lang={lang} />)</span>
          </p>
        )}
        <p
          className={cn('my-2 font-display font-extrabold leading-none tabular-nums', alerting && !timeUp && 'animate-pulse text-destructive-text', timeUp && 'text-destructive-text')}
          style={{ fontSize: 'clamp(4rem, 18vw, 12rem)' }}
          dir="ltr"
          data-testid="live-remaining"
          role="timer"
          aria-label={remaining === null ? t('distribution.live.noCountdown') : t('distribution.live.remainingAria', { time: formatMMSS(remaining) })}
        >
          {remaining === null ? '--:--' : formatMMSS(remaining)}
        </p>
        {round.state === 'in' && round.duration > 0 && remaining !== null && (
          <div className="mx-auto h-2 max-w-3xl overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div className={cn('h-full transition-[width] duration-300', alerting ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.max(0, Math.min(100, (remaining / round.duration) * 100))}%` }} />
          </div>
        )}
        {(round.state === 'before' || round.state === 'between') && slot && (
          <p className="mt-2 text-muted-foreground">{t('distribution.live.startsAt', { time: to12h(slot.startMinutes, lang) })}</p>
        )}
      </section>

      {controls}

      {pairs.length > 0 ? (
        <section aria-label={t('distribution.live.now')} data-testid="live-pairs">
          <h3 className="mb-3 font-display text-card-title">{t('distribution.live.nowTitle')}</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pairs.map((p) => (
              <li key={p.session.mentorId} className="flex items-center gap-3 rounded-card border border-border bg-card p-3" data-testid="live-pair">
                <Avatar name={nameOf(p.mentor, lang)} id={p.session.mentorId} src={p.mentor?.image ? publicThumbUrl(p.mentor.image) : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted-foreground" dir="auto">{nameOf(p.mentor, lang)}{p.mentor?.room ? ` - ${p.mentor.room}` : ''}</p>
                  <p className="truncate text-lg font-bold" dir="auto">{nameOf(p.company, lang)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : round.state === 'in' ? (
        <p className="text-center text-muted-foreground">{t('distribution.live.nobody')}</p>
      ) : null}

      {nextPairs.length > 0 && nextSlot && (
        <section aria-label={t('distribution.live.next')} data-testid="live-next">
          <h3 className="mb-2 font-display text-card-title text-muted-foreground">
            {t('distribution.live.nextTitle')} <span dir="ltr" className="text-sm font-normal tabular-nums">({to12h(nextSlot.startMinutes, lang)})</span>
          </h3>
          <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {nextPairs.map((p) => (
              <li key={p.session.mentorId} className="flex items-baseline justify-between gap-2 rounded-md bg-surface px-3 py-2">
                <span className="truncate text-muted-foreground" dir="auto">{nameOf(p.mentor, lang)}</span>
                <span className="truncate font-semibold" dir="auto">{nameOf(p.company, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
