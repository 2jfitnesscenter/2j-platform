// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A drift-corrected timer engine shared by every Reloj mode and the optional reference timer
// inside a test session (VAM 6', ergometer) — one implementation instead of a bespoke
// setInterval per screen. `elapsed`/`remaining` are always recomputed from real wall-clock time
// (`startedAt` + already-accumulated `base`), never by decrementing a counter each tick, so a
// backgrounded tab or a throttled interval never drifts — the same trick useUI.js's rest/work
// timers already use.
import { useEffect, useRef, useState } from 'react'
import { beep, vibrate } from './sound.js'

function useClockCore() {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const startedAt = useRef(null)
  const base = useRef(0)

  useEffect(() => {
    if (!running) return
    const tick = () => setElapsed(base.current + (Date.now() - startedAt.current) / 1000)
    const iv = setInterval(tick, 200)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [running])

  const resume = () => { if (running) return; startedAt.current = Date.now(); setRunning(true) }
  const pause = () => { if (!running) return; base.current += (Date.now() - startedAt.current) / 1000; setRunning(false) }
  const restart = () => { startedAt.current = Date.now(); base.current = 0; setElapsed(0); setRunning(true) }
  // Unlike restart(), does NOT resume running — a "Reset" button should hand back the initial,
  // stopped state (so the UI shows "Start" again), not immediately start a new run.
  const stop = () => { startedAt.current = null; base.current = 0; setElapsed(0); setRunning(false) }
  return { elapsed, running, resume, pause, restart, stop }
}

// Counts up freely from 0:00 — Cronómetro, and For Time (the caller compares `elapsed` to its
// own cap and stops itself, since "counting up to an optional limit" is a for-time concern, not
// a stopwatch one).
export function useStopwatch() {
  const c = useClockCore()
  return { elapsed: c.elapsed, running: c.running, start: c.restart, resume: c.resume, pause: c.pause, reset: c.stop }
}

// Counts down from `totalSec` to 0, then fires `onDone` once and stops. `start()` always begins
// a fresh full countdown (used both for the first start and a "reset" button); `resume()`
// continues from wherever `pause()` left it. Tabata/EMOM are built by chaining one of these per
// phase/round rather than a bespoke "phases" engine of their own: the phase's `onDone` advances
// the round/phase state and calls `start()` again for the next phase's duration.
export function useCountdown(totalSec, { sound = true, onDone } = {}) {
  const c = useClockCore()
  const doneRef = useRef(false)
  const lastWhole = useRef(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const remaining = Math.max(0, totalSec - c.elapsed)

  useEffect(() => {
    if (!c.running) return
    const whole = Math.ceil(remaining)
    if (whole === lastWhole.current) return
    lastWhole.current = whole
    if (whole > 0 && whole <= 3) beep(sound, 660, 0.1)
    if (whole <= 0 && !doneRef.current) {
      doneRef.current = true
      beep(sound, 880, .15); beep(sound, 880, .15, 0.25); beep(sound, 1320, .4, 0.5)
      vibrate([200, 100, 200])
      c.pause()
      onDoneRef.current && onDoneRef.current()
    }
  }, [remaining, c.running, sound])

  const start = () => { doneRef.current = false; lastWhole.current = null; c.restart() }
  const reset = () => { doneRef.current = false; lastWhole.current = null; c.stop() }
  return { remaining, elapsed: c.elapsed, running: c.running, start, resume: c.resume, pause: c.pause, reset }
}

// mm:ss (or h:mm:ss past an hour) — every clock display in the feature wants the same format.
export function fmtClock(totalSeconds) {
  const s = isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0')
}
