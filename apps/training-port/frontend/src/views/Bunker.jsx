import { stampWorkoutActivity, workoutInactive, inactivityFinishMetadata } from '../lib/workout-activity.js'
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, nameFor } from '../lib/i18n.js'
import { fmtNum, todayISO, uid, exCount } from '../lib/format.js'
import { effectiveRoutine, modeOf, swapEntryExercise, supersetUnits, effortOf, stepEffort, setLabel } from '../lib/history.js'
import { buildRoutineEntries, buildFreeEntry } from '../lib/progression.js'
import { EXIDX, imgSrc, gifSrc } from '../lib/exercises.js'
import { supersetGroupInfo, supersetLabel } from '../lib/superset-colors.js'
import { glyphOf } from '../lib/glyphs.js'
import { ExerciseSearchList, BunkerTopBar, BunkerToolPane, DEFAULT_TIMER_STATE } from './BunkerTools.jsx'
import { musclesOf, MUSCLE_GROUPS } from '../lib/muscles.js'
import { landmarksFor, weeklyGroupVolume, primaryGroupOf } from '../lib/rp-volume.js'
import RpVolumeBar from '../components/RpVolumeBar.jsx'
import { beep, vibrate } from '../lib/sound.js'
import Icon from '../components/Icon.jsx'
import {
  fetchBunkerSnapshot, fetchBunkerSettings, bunkerCheckin, fetchBunkerSession,
  postBunkerActive, postBunkerRest, postBunkerFinish,
  bunkerAdminCheckin, fetchBunkerAdminSessions, closeBunkerSession, pauseBunkerSession, saveBunkerSettings,
} from '../lib/bunker-api.js'
import { purgeStaleCredentials } from '../lib/bunker-credentials.js'
import { nextAfterBunkerSet, bunkerRestSec, bunkerProgress, buildBunkerFinishedWorkout, BUNKER_REST_FALLBACK } from '../lib/bunker-workout.js'
import { guidedBlocksOf } from '../lib/guided.js'
import { TYPE_LABEL } from '../lib/protocol/index.js'
import { drainPendingActive, retryPendingFinish, stagePendingFinish } from '../lib/bunker-persistence.js'
import { alternativesSheet } from '../sheets.jsx'
import { goToExercise } from '../lib/bunker-nav.js'
import { buildBunkerActive, BunkerTodayPicker, BunkerOutline, BunkerStepper, BunkerSupersetSwitch, BunkerExerciseMedia, BunkerPanelGrid, BunkerCompactCard } from './BunkerRoutine.jsx'
import { compactFacts, bunkerUnit } from '../lib/bunker-nav.js'

const BOARD_POLL_MS = 4000
const AFTER_SET_MINIMIZE_MS = 20000
// Guided blocks of the running session: its own snapshot, else the routine it came from.
const guidedOf = (active, routines) => active?.guidedBlocks || guidedBlocksOf((routines || []).find(r => r.id === active?.routineId))
const PAIR_KEY = 'gym_bunker_screen'

const elapsed = ms => { const m = Math.floor(ms / 60000); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm' }
const MUSCLE_GROUP_NAME = Object.fromEntries(MUSCLE_GROUPS.map(g => [g.key, g.name]))

/* ============================ live countdown ring (dashboard card + panel header) ============================ */
// `onEnd` fires exactly once per countdown, the instant it reaches zero — the room dashboard's
// hook for the "rest just finished" beep + pulse (settings.enableRestEndBeep/highlightFinishedRest),
// since that moment only exists client-side (the server just hands out a target timestamp).
function RestRing({ endsAt, total, size = 44, paused, onEnd }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
  const endedRef = useRef(false)
  useEffect(() => {
    endedRef.current = false
    setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    const id = setInterval(() => {
      const l = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      setLeft(l)
      if (l <= 0 && !endedRef.current) { endedRef.current = true; onEnd && onEnd() }
    }, 1000)
    return () => clearInterval(id)
  }, [endsAt])
  if (paused) return <div className="bk-ring bk-ring-paused" style={{ width: size, height: size }}><Icon name="pause" /></div>
  if (!endsAt || left <= 0) return null
  // Proportional to the rest actually prescribed (Constructor V2.1), not a fixed 90 s.
  const pct = Math.max(0, Math.min(1, left / Math.max(1, total || BUNKER_REST_FALLBACK)))
  const color = pct > 0.5 ? '#10B981' : pct > 0.2 ? '#ffd60a' : '#ff453a'
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  return (
    <div className="bk-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#2a2a2e" strokeWidth={4} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={4} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="bk-ring-n">{left}</span>
    </div>
  )
}

/* ============================ community dashboard ============================ */
// One card's own rest-end reaction — a beep + a few seconds of pulsing highlight, each gated
// by its own room setting (a gym that finds the beep annoying can keep the visual pulse alone,
// or neither). Split out from the card markup below only because it owns this bit of timing
// state (the pulse has to turn itself back off) that the card otherwise has no reason to hold.
function CardRest({ s, settings }) {
  const [pulsing, setPulsing] = useState(false)
  const onRestEnd = () => {
    if (settings.enableRestEndBeep) beep(true, 740, 0.2)
    if (settings.highlightFinishedRest) { setPulsing(true); setTimeout(() => setPulsing(false), 6000) }
  }
  return <>
    {s.restEndsAt && <RestRing endsAt={s.restEndsAt} total={s.restSec} paused={s.paused} onEnd={onRestEnd} />}
    {pulsing && <i className="bk-card-pulse" />}
  </>
}
// Just the "who's here" board + the join button — the header (title, paired badge, admin
// gear) moved into BunkerTopBar, which every screen shares now, not just this one.
//
// Every card is tappable now (it never used to be — see Bunker.jsx's own module doc comment).
// `credentials` is THIS device's own local map of who it already has a valid bunker token for
// (set on a successful PIN checkin, kept across a minimize, never containing anyone who checked
// in from a different phone/tablet — see lib/bunker-credentials.js). A card whose uid is in that
// map reopens that exact session with no PIN; any other card — someone else's, or this member's
// own but checked in elsewhere — falls through to the normal PIN pad, same as "Join" always did.
function TodayPrs({ prs, compact = false }) {
  return <section className={'bk-live-prs' + (compact ? ' compact' : '')} aria-label={t('PRs today')}>
    <div className="bk-live-prs-head">
      <div><span aria-hidden="true">🔥</span> {t('Today at 2J')}</div>
      {!!prs.length && <strong>{t(prs.length === 1 ? '{0} new PR today' : '{0} new PRs today', prs.length)}</strong>}
    </div>
    {prs.length ? <div className="bk-live-prs-list">{prs.map(pr => <div className="bk-live-pr" key={pr.id}>
      <div className="bk-live-pr-person">{pr.authorName}</div>
      <div className="bk-live-pr-mark"><span>{pr.exName}</span><b>{setLabel(pr.exId, pr.value, { mode: pr.mode })}</b></div>
      {pr.delta > 0 && <div className="bk-live-pr-delta">+{fmtNum(pr.delta)} kg</div>}
    </div>)}</div> : <div className="bk-live-prs-empty">
      <Icon name="trophy" />
      <span>{t('No public PRs yet today.')}</span>
      <small>{t('Only records members chose to share appear here.')}</small>
    </div>}
  </section>
}

const LAYOUT_KEY = 'gym_bunker_layout'
const readLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'compact' ? 'compact' : 'normal' } catch { return 'normal' } }

/** Normal / Compact: a display preference of THIS screen only (nothing about the members' data). */
function BunkerLayoutToggle({ layout, onChange }) {
  return <div className="bk-layout" role="group" aria-label={t('Layout')}>
    {['normal', 'compact'].map(k => <button key={k} className={layout === k ? 'on' : ''} aria-pressed={layout === k} onClick={() => onChange(k)}>{k === 'normal' ? t('Normal') : t('Compact')}</button>)}
  </div>
}

function BunkerBoard({ board, settings, credentials, onCheckin, onResume }) {
  const gridStyle = settings.columns === 'auto'
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, flex: 1, alignContent: 'start' }
    : { '--cols': settings.columns || 4 }
  return <div className="bk-dash">
    {board.length === 0 ? (
      <div className="bk-empty">{t('Nobody checked in yet — be the first.')}</div>
    ) : (
      <div className={settings.columns === 'auto' ? undefined : 'bk-grid'} style={gridStyle}>
        {board.map(s => {
          const resumable = !!credentials[s.uid]
          const tap = () => resumable ? onResume(s.uid) : onCheckin()
          return (
            <div className={'bk-card' + (s.paused ? ' paused' : '') + (resumable ? ' resumable' : '')} key={s.uid}
              role="button" tabIndex={0} onClick={tap}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap() } }}>
              <div className="bk-card-top">
                <div className="bk-card-name">{s.name}</div>
                {resumable && <span className="bk-card-resume">{t('Continue')}</span>}
                <span className="bk-card-elapsed">{elapsed(Date.now() - s.checkinAt)}</span>
              </div>
              {s.exName ? <>
                <div className="bk-card-ex">{s.exName}</div>
                <div className="bk-card-set">
                  {s.paused ? t('Paused') : t('Set {0} of {1}', Math.min(s.setIdx + 1, s.setsTotal || 1), s.setsTotal || 1)}
                </div>
              </> : <div className="bk-card-ex dim">{t('Getting ready…')}</div>}
              <CardRest s={s} settings={settings} />
            </div>
          )
        })}
      </div>
    )}
    <button className="bk-join" onClick={onCheckin}><Icon name="plus" /> {t('Join the Bunker')}</button>
  </div>
}

/* ============================ PIN check-in pad ============================ */
function BunkerCheckinPad({ onClose, onSuccess }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const press = d => { if (pin.length < 4 && !busy) setPin(p => p + d) }
  const back = () => setPin(p => p.slice(0, -1))
  useEffect(() => {
    if (pin.length !== 4) return
    setBusy(true); setErr('')
    bunkerCheckin(pin).then(onSuccess).catch(e => { setErr(e.message); setPin(''); setBusy(false) })
  }, [pin])
  return <div className="bk-overlay">
    <div className="bk-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Enter your PIN')}</div>
      <div className="bk-pad-dots">{[0, 1, 2, 3].map(i => <span key={i} className={'bk-dot' + (i < pin.length ? ' on' : '')} />)}</div>
      {err && <div className="bk-pad-err">{err}</div>}
      <div className="bk-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
          <button key={i} disabled={!k || busy} className={'bk-key' + (!k ? ' ghost' : '')}
            onClick={() => k === '⌫' ? back() : k && press(k)}>{k}</button>
        ))}
      </div>
    </div>
  </div>
}

/* ============================ individual training panel ============================ */
function lastResultFor(recentWorkouts, exId) {
  for (let i = recentWorkouts.length - 1; i >= 0; i--) {
    const e = recentWorkouts[i].entries.find(x => x.id === exId)
    if (e) { const best = e.sets.filter(s => s.done).sort((a, b) => b.w - a.w)[0]; if (best) return best }
  }
  return null
}
function exName(exId, customEx) {
  // The kiosk isn't "logged in" as this member in the normal sense (see the module's own
  // security-boundary comment), so useStore's usual registerCustom() never merges their
  // custom exercises into the shared EXIDX — check the session's own customEx list first,
  // same as EXIDX itself is just the real library plus whichever account is signed in.
  const c = (customEx || []).find(x => x.id === exId)
  if (c) return c.n
  const ex = EXIDX[exId]
  return ex ? nameFor(ex) : exId
}

// `onMinimize`/`onFinish`/`onInvalid` are three deliberately different endings (V3 fix — see
// Bunker.jsx's own module doc comment): minimizing (manual button, idle timeout, the brief
// auto-minimize after a set) keeps this device's local credential for `token`'s uid so tapping
// their board card later reopens this exact session with no PIN; finishing a workout ends their
// Bunker presence on purpose, so it also drops the local credential (same as if their card had
// simply disappeared from the board); and a session that turns out not to load at all (an
// actually-expired/invalid token) drops the credential too, so a stale card self-heals into
// asking for the PIN again instead of silently doing nothing on the next tap.
function BunkerTrainingPanel({ token, name, settings, hidden = false, compact = false, onOpen, onBack, onMinimize, onFinish, onInvalid }) {
  const [plan, setPlan] = useState(null)
  const [active, setActive] = useState(null)
  const [exIdx, setExIdx] = useState(0)
  const [restEndsAt, setRestEndsAt] = useState(null)
  const [restTotal, setRestTotal] = useState(BUNKER_REST_FALLBACK)
  const [showAdd, setShowAdd] = useState(false)
  const [connection, setConnection] = useState('loading')
  const [conflict, setConflict] = useState(null)
  const conflictRef = useRef(null)
  const loadedRef = useRef(false)
  const loadSessionRef = useRef(null)
  const panelStyle = hidden ? { display: 'none' } : undefined
  const autoFinishRef = useRef(null)
  const idleRef = useRef(null)
  const minimizeRef = useRef(null)
  const activeRevisionRef = useRef(0)
  const pendingRef = useRef([])
  const drainPromiseRef = useRef(null)
  const finishPromiseRef = useRef(null)
  const pendingFinishRef = useRef(null)
  const pendingKey = 'gym_bunker_active_queue:' + token.slice(-24)
  const finishKey = 'gym_bunker_finish_queue:' + token.slice(-24)
  const idleMs = (settings?.autoLockSec || 60) * 1000

  const compactRef = useRef(compact)
  compactRef.current = compact
  // The compact grid is a wall display: its cards never auto-minimise (the full panel still does, as always).
  const armIdle = ms => { clearTimeout(idleRef.current); if (!compactRef.current) idleRef.current = setTimeout(onMinimize, ms) }
  const touch = () => armIdle(idleMs)
  useEffect(() => { if (!compact) armIdle(idleMs) }, [compact])   // opening a card from the compact grid starts the normal idle timer
  const persistPending = () => {
    try {
      if (pendingRef.current.length) localStorage.setItem(pendingKey, JSON.stringify(pendingRef.current))
      else localStorage.removeItem(pendingKey)
    } catch { /* the in-memory queue still protects this mounted session */ }
  }
  const drainPending = () => {
    if (conflictRef.current) return Promise.resolve(false)
    if (drainPromiseRef.current) return drainPromiseRef.current
    const run = (async () => {
      const result = await drainPendingActive({ queue: pendingRef.current, revision: activeRevisionRef.current,
        persist: persistPending, send: item => postBunkerActive(token, item) })
      activeRevisionRef.current = result.revision
      if (result.error?.status === 409) {
        conflictRef.current = result.error.data || {}
        setConflict(conflictRef.current)
      } else if (result.error?.status === 401 || result.error?.status === 403) {
        onInvalid()
      }
      setConnection(result.ok ? 'saved' : 'pending')
      return result.ok
    })()
    drainPromiseRef.current = run.finally(() => { drainPromiseRef.current = null })
    return drainPromiseRef.current
  }
  const drainFinish = () => {
    if (finishPromiseRef.current) return finishPromiseRef.current
    const run = retryPendingFinish({
      storage: localStorage,
      key: finishKey,
      workout: pendingFinishRef.current,
      drainActive: drainPending,
      send: workout => postBunkerFinish(token, workout),
    }).then(result => {
      if (result.completed) {
        pendingFinishRef.current = null
        pendingRef.current = []
        persistPending()
        onFinish()
      } else if (result.pending) {
        if (result.error?.status === 409) {
          conflictRef.current = result.error.data || {}
          setConflict(conflictRef.current)
        }
        setConnection('pending')
      }
      return result
    })
    finishPromiseRef.current = run.finally(() => { finishPromiseRef.current = null })
    return finishPromiseRef.current
  }

  useEffect(() => {
    let alive = true
    const load = () => fetchBunkerSession(token).then(p => {
      if (!alive) return
      setPlan(p)
      loadedRef.current = true
      setConnection('saved')
      activeRevisionRef.current = p.activeRevision || 0
      // Same resolver the rest of the app uses for "today's routine" (Home, Stats, the phone
      // logger) — dayPlan's own override first, then an active program's own week, then the
      // flat S.week — never a second, poorer guess that only ever checked the flat week.
      const miniS = {
        week: p.week, dayPlan: p.dayPlan, programs: p.programs, activeProgramId: p.activeProgramId,
        routines: p.routines,
      }
      const routine = effectiveRoutine(miniS, todayISO())
      // A session already in progress (started here or on the member's own phone) is resumed
      // exactly as-is — never rebuilt, never reset. A routine with no open session yet gets a
      // fresh one built from today's plan. Neither of a member's own phone nor an admin picked
      // anything for today (dayPlan has no override, the active program's own week is empty or
      // skips today): `active` is left null on purpose — the render below then offers the
      // "what do you want to train today?" picker instead of guessing, and NOTHING is written
      // to S.week/dayPlan/programs/activeProgramId either way (see pickRoutine/startFreeTraining
      // below — both only ever call sync(), which writes S.active alone, same as every other
      // in-session action here).
      let queued = []
      try { queued = JSON.parse(localStorage.getItem(pendingKey) || '[]') } catch { /* discard malformed local queue */ }
      pendingRef.current = Array.isArray(queued) ? queued : []
      const draft = pendingRef.current.at(-1)?.active
      const resumed = draft || p.active || (routine ? buildBunkerActive({ ...miniS, unit: p.unit, workouts: p.recentWorkouts, exWeights: p.exWeights, tests: p.tests, showPreviousResults: p.showPreviousResults, warmupEnabled: p.warmupEnabled }, routine) : null)
      setActive(resumed)
      setExIdx(Math.max(0, Math.min(resumed?.cur || 0, (resumed?.entries.length || 1) - 1)))
      setRestEndsAt(p.restEndsAt || null)
      setRestTotal(p.restSec || BUNKER_REST_FALLBACK)
      drainFinish()
      armIdle(idleMs)
    }).catch(e => {
      if (!alive) return
      if (e.status === 401 || e.status === 403) onInvalid()
      else setConnection('unavailable')
    })
    loadSessionRef.current = load
    load()
    const retry = () => loadedRef.current ? drainFinish() : load()
    window.addEventListener('online', retry)
    return () => { alive = false; clearTimeout(idleRef.current); clearTimeout(minimizeRef.current); window.removeEventListener('online', retry) }
  }, [token])

  useEffect(() => {
    const check = () => {
      if (!active || conflictRef.current || pendingFinishRef.current || pendingRef.current.length || !workoutInactive(active)) return
      autoFinishRef.current?.()
    }
    check()
    const timer = setInterval(check, 30000)
    window.addEventListener('online', check)
    return () => { clearInterval(timer); window.removeEventListener('online', check) }
  }, [active])

  if (!plan) return <div className="bk-panel" style={panelStyle}><div className="bk-loading">{name}<br />{t(connection === 'unavailable' ? 'Connection unavailable. Your session is still safe.' : 'Loading…')}
    {connection === 'unavailable' && <button className="bk-join" onClick={() => loadSessionRef.current?.()}>{t('Retry')}</button>}
  </div></div>

  // The same minimal S buildRoutineEntries/buildSets/nextPrescription/buildFreeEntry all need,
  // rebuilt from the session payload on demand (not just once at mount) so a routine picked or
  // an exercise added minutes into the session still sees this member's real workouts/exWeights.
  const sessionS = () => ({
    week: plan.week, dayPlan: plan.dayPlan, programs: plan.programs, activeProgramId: plan.activeProgramId,
    routines: plan.routines, unit: plan.unit, workouts: plan.recentWorkouts, exWeights: plan.exWeights,
    tests: plan.tests, showPreviousResults: plan.showPreviousResults, warmupEnabled: plan.warmupEnabled,
  })
  const sync = (next, currentIndex = exIdx) => {
    if (conflictRef.current) return
    next = stampWorkoutActivity(active, { ...next, cur: currentIndex })
    setActive(next)
    setConnection('pending')
    const entry = next.entries[currentIndex]
    const doneN = entry ? entry.sets.filter(s => s.done).length : 0
    pendingRef.current.push({ operationId: uid(), active: next, exId: entry?.id || null, exName: entry ? exName(entry.id, plan.customEx) : null, setIdx: doneN, setsTotal: entry?.sets.length || 0 })
    persistPending()
    drainPending()
  }
  // Manual choice for TODAY only — same buildRoutineEntries a normally-scheduled day uses, so a
  // picked routine behaves identically once it's running. Never touches S.week/dayPlan/programs;
  // the member's actual weekly plan is exactly as it was before this tap.
  const pickRoutine = routine => { touch(); sync(buildBunkerActive(sessionS(), routine)); armIdle(idleMs) }
  // Mirrors Workout.jsx's own beginWorkout(null, …) — a real Freestyle session, just started
  // from the kiosk: no routine, entries start empty, exercises get added one at a time below.
  const startFreeTraining = () => {
    touch()
    sync({ id: uid(), d: todayISO(), start: Date.now(), routineId: null, name: t('Freestyle'), bw: null, cur: 0, entries: [] })
    armIdle(idleMs)
  }

  if (!active) return <div className="bk-panel" style={panelStyle}>
    <div className="bk-panel-hd">
      <button className="bk-minimize" onClick={onMinimize}><Icon name="chevronDown" /> {t('Minimize / resting')}</button>
      <div className="bk-panel-name">{name}</div>
    </div>
    <BunkerTodayPicker routines={plan.routines} sessionS={sessionS} onPickRoutine={pickRoutine} onFreeTraining={startFreeTraining} />
  </div>

  const setField = (ei, si, field, delta) => {
    touch()
    const next = { ...active, entries: active.entries.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, [field]: Math.max(0, Math.round((s[field] + delta) * 10) / 10) }),
    }) }
    sync(next)
  }
  const setEffort = (ei, si, kind, dir) => {
    touch()
    const next = { ...active, entries: active.entries.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.map((s, j) => {
        if (j !== si) return s
        const value = stepEffort(kind, s[kind], dir)
        const updated = { ...s }
        if (value == null) delete updated[kind]
        else updated[kind] = value
        return updated
      }),
    }) }
    sync(next)
  }
  const toggleDone = (ei, si) => {
    touch()
    const willBeDone = !active.entries[ei].sets[si].done
    const next = { ...active, entries: active.entries.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, done: willBeDone }),
    }) }
    sync(next)
    if (willBeDone) {
      beep(true, 880, 0.15); vibrate(40)
      const progressEntries = active.entries.map((e, idx) => idx !== ei ? e : { ...e, sets: e.sets.map((s, setIdx) => setIdx === si ? { ...s, done: true } : s) })
      const advance = nextAfterBunkerSet(progressEntries, ei, si)
      if (advance.rest) {
        // The prescribed rest for this exercise (or pair / guided block); 90 s when none.
        const restSec = bunkerRestSec(progressEntries, ei, guidedOf(active, plan.routines))
        const endsAt = Date.now() + restSec * 1000
        setRestTotal(restSec)
        setRestEndsAt(endsAt)
        postBunkerRest(token, restSec).catch(() => {})
        clearTimeout(minimizeRef.current)
        minimizeRef.current = setTimeout(onMinimize, AFTER_SET_MINIMIZE_MS)
      } else {
        setExIdx(advance.nextEntry)
      }
    }
  }
  // Same semantics as Workout.jsx's own replaceExercise (issue tracked in lib/history.js's
  // swapEntryExercise doc comment): only the id changes. Whatever was already there for this
  // slot — target, plan, sets, including any already marked done — carries over untouched, so a
  // set logged before the swap stays exactly as logged, now just attributed to the new exercise.
  // Bunker has no routine to offer "keep this swap?" against (there's nothing to write it back
  // into — S.routines/dayPlan are never touched), so unlike the phone this never prompts.
  const doSwap = newEx => {
    touch()
    sync({ ...active, entries: swapEntryExercise(active.entries, exIdx, newEx.id) })
  }
  // Add/remove are only offered on a routineId: null (Freestyle) session — a routine-based one
  // still only ever gets "Change exercise" (doSwap above), same as the phone: swapping what an
  // existing slot means is one thing, growing or shrinking the routine itself from the kiosk is
  // another the brief never asked for. Same per-exercise pipeline buildRoutineEntries runs per
  // routine exercise (progression.js's buildFreeEntry), just with defaultConfig() standing in
  // for a routine author's own cfg — mirrors Workout.jsx's own mid-session "Add exercise".
  const doAdd = ex => {
    touch()
    const nextEntries = [...active.entries, buildFreeEntry(sessionS(), ex.id)]
    sync({ ...active, entries: nextEntries }, nextEntries.length - 1)
    setExIdx(nextEntries.length - 1)
    setShowAdd(false)
  }
  const doRemove = idx => {
    touch()
    const nextEntries = active.entries.filter((_, i) => i !== idx)
    const nextIndex = Math.min(exIdx, Math.max(0, nextEntries.length - 1))
    sync({ ...active, entries: nextEntries }, nextIndex)
    setExIdx(nextIndex)
  }

  const finish = async reason => {
    if (finishPromiseRef.current || conflictRef.current) return
    if (reason === 'inactivity_timeout' && !await drainPending()) return
    const w = buildBunkerFinishedWorkout(active)
    if (reason === 'inactivity_timeout') Object.assign(w, inactivityFinishMetadata(active), { _inactivityRevision: activeRevisionRef.current })
    pendingFinishRef.current = stagePendingFinish(localStorage, finishKey, w)
    const result = await drainFinish()
    if (!result.completed) onMinimize()
  }

  autoFinishRef.current = () => finish('inactivity_timeout')

  // Moves between exercises of THIS panel's session: the cursor only. Entries are never touched, so no set can be lost by navigating back.
  const goTo = i => { touch(); const next = goToExercise(active, i); sync(next, next.cur); setExIdx(next.cur) }
  const entry = active.entries[exIdx]
  const last = entry ? lastResultFor(plan.recentWorkouts, entry.id) : null
  const ssInfo = supersetGroupInfo(active.entries)
  const currentUnit = supersetUnits(active.entries).find(u => u.includes(exIdx)) || [exIdx]
  const effortKind = effortOf(plan)

  // Per-athlete RP Volume Zones (Fase V2 §2's "hidratación estricta de preferencias
  // individuales") — only ever read from THIS athlete's own session payload, which the server
  // already scoped to their account (see api/bunker/routes.js's sessionPayload); nothing here
  // is global room state, so it can never leak into whoever checks in next. A minimal
  // S-shaped object is enough for weeklyGroupVolume/landmarksFor to work unmodified — they only
  // ever read S.workouts/S.active/S.trainingLevel/S.rpVolumeOverrides.
  let rpBar = null
  if (plan.enableRpVolumeZones && entry) {
    const miniS = {
      workouts: plan.recentWorkouts, active, enableRpVolumeZones: true,
      trainingLevel: plan.trainingLevel, rpVolumeOverrides: plan.rpVolumeOverrides,
      countSecondaryMuscles: plan.countSecondaryMuscles, secondaryMuscleFactor: plan.secondaryMuscleFactor,
    }
    const opts = { countSecondary: plan.countSecondaryMuscles, secondaryFactor: plan.secondaryMuscleFactor }
    const groupKey = primaryGroupOf(musclesOf(EXIDX[entry.id], opts))
    if (groupKey) {
      const landmarks = landmarksFor(miniS, groupKey)
      const volume = weeklyGroupVolume(miniS, opts)
      rpBar = <RpVolumeBar groupName={t(MUSCLE_GROUP_NAME[groupKey] || groupKey)} sets={volume[groupKey] || 0} landmarks={landmarks} />
    }
  }

  const freeTraining = active.routineId === null
  const guidedHere = entry?.target?.blk ? (guidedOf(active, plan.routines) || []).find(b => b.iid === entry.target.blk) || null : null
  const progress = bunkerProgress(active.entries)
  const loadServerSession = async () => {
    try {
      const p = await fetchBunkerSession(token)
      // Explicit user choice: the draft was kept intact until this successful read.
      pendingRef.current = []
      pendingFinishRef.current = null
      persistPending()
      try { localStorage.removeItem(finishKey) } catch { /* in-memory draft is cleared explicitly */ }
      activeRevisionRef.current = p.activeRevision || 0
      setPlan(p); setActive(p.active || null)
      setExIdx(Math.max(0, Math.min(p.active?.cur || 0, (p.active?.entries.length || 1) - 1)))
      setRestEndsAt(p.restEndsAt || null); setRestTotal(p.restSec || BUNKER_REST_FALLBACK)
      conflictRef.current = null; setConflict(null); setConnection('saved')
    } catch { setConnection('pending') }
  }

  if (compact) {
    const facts = compactFacts(active.entries, exIdx, { effortKind })
    const unit = facts ? bunkerUnit(active.entries, exIdx) : []
    const partners = unit.filter(i => i !== exIdx).map(i => (ssInfo[i] ? supersetLabel(ssInfo[i]) + ' ' : '') + exName(active.entries[i].id, plan.customEx))
    return <BunkerCompactCard name={name} routineName={active.name} facts={facts} exName={entry ? exName(entry.id, plan.customEx) : ''}
      nextName={facts?.nextId != null ? exName(facts.nextId, plan.customEx) : null} ssLabel={ssInfo[exIdx] ? supersetLabel(ssInfo[exIdx]) : ''}
      partner={partners.join(', ')} progress={progress} hidden={hidden} onOpen={onOpen}
      warn={conflict ? t('Session changed on another device') : connection === 'pending' ? t('Changes pending') : null}
      rest={restEndsAt ? <RestRing endsAt={restEndsAt} total={restTotal} size={40} /> : null} />
  }
  return <div className="bk-panel" style={panelStyle} onClick={touch}>
    <div className="bk-panel-hd">
      {onBack && <button className="bk-minimize" onClick={onBack}><Icon name="grid" /> {t('Back to grid')}</button>}
      <button className="bk-minimize" onClick={onMinimize}><Icon name="chevronDown" /> {t('Minimize / resting')}</button>
      <div className="bk-panel-name">{name}</div>
      {restEndsAt && <RestRing endsAt={restEndsAt} total={restTotal} size={52} />}
    </div>
    <div className="bk-routine-name">{active.name}</div>
    {conflict ? <div className="bk-connection" role="alert"><span>{t('Session changed on another device. Pending sets are kept here until you choose.')}</span><button onClick={loadServerSession}>{t('Discard local changes and load server session')}</button></div>
      : connection === 'pending' && <div className="bk-connection" role="status"><span>{t('Changes pending. Your sets are kept on this device.')}</span><button onClick={drainFinish}>{t('Retry')}</button></div>}
    <div className="bk-live-progress" aria-label={t('Workout progress')}>
      <div className="bk-live-progress-label"><span>{t('{0} of {1} exercises', progress.doneExercises, progress.totalExercises)}</span><strong>{progress.percent}%</strong><span>{t('{0} of {1} sets', progress.doneSets, progress.totalSets)}</span></div>
      <div className="bk-live-progress-track" role="progressbar" aria-label={t('Workout progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
    </div>
    <BunkerOutline entries={active.entries} cur={exIdx} ssInfo={ssInfo} nameOf={id => exName(id, plan.customEx)} onGo={goTo}>
      {freeTraining && <button disabled={!!conflict} className="bk-extab bk-extab-add" onClick={() => { touch(); setShowAdd(true) }} aria-label={t('Add exercise')}><Icon name="plus" /></button>}
    </BunkerOutline>
    <BunkerStepper entries={active.entries} cur={exIdx} nameOf={id => exName(id, plan.customEx)} onGo={goTo} disabled={!!conflict} />
    {freeTraining && !active.entries.length && <div className="bk-empty">
      {t('Freestyle workout — add your first exercise.')}
      <button className="bk-join" style={{ marginTop: 16 }} onClick={() => { touch(); setShowAdd(true) }}><Icon name="plus" />{t('Add exercise')}</button>
    </div>}
    {entry && <div className="bk-sets">
      <BunkerExerciseMedia key={entry.id} ex={EXIDX[entry.id]} name={exName(entry.id, plan.customEx)} />
      <div className="bk-exname-row">
        <div className="bk-exname">{ssInfo[exIdx] && <span className="bk-ssbadge">{supersetLabel(ssInfo[exIdx])}</span>}{exName(entry.id, plan.customEx)}</div>
        <button disabled={!!conflict} className="bk-exchange-btn" onClick={() => { touch(); alternativesSheet(EXIDX[entry.id] || { id: entry.id, n: exName(entry.id, plan.customEx), eq: 'custom' }, doSwap, true, plan) }}>
          <Icon name="shuffle" />{t('Change exercise')}
        </button>
        {freeTraining && <button disabled={!!conflict} className="bk-exchange-btn bk-exremove-btn" onClick={() => doRemove(exIdx)}>
          <Icon name="trash" />{t('Remove exercise')}
        </button>}
      </div>
      {guidedHere && <div className="bk-guided-note" role="note"><Icon name="timer" /><span>{t('Guided block ({0}): at the Bunker it is logged set by set, resting what its timing says between rounds. The paced timer runs in the app on the phone.', t(guidedHere.timing?.preset === 'tabata' ? 'Tabata' : TYPE_LABEL[guidedHere.type] || guidedHere.type))}</span></div>}
      <BunkerSupersetSwitch entries={active.entries} cur={exIdx} ssInfo={ssInfo} nameOf={id => exName(id, plan.customEx)} onGo={goTo} />
      {/* Same plan.why the phone logger's own .progline shows (lib/progression.js's
          nextPrescription) — what the routine planned for this exercise and why, kept visibly
          separate from the editable set rows below (what is actually being done). */}
      {entry.plan?.why && entry.plan.kind !== 'off' && <div className="bk-last">{t('Planned: {0}', t(...entry.plan.why))}</div>}
      {last && <div className="bk-last">{t('Last time: {0} × {1}', fmtNum(last.w), last.r)}</div>}
      {rpBar && <div className="bk-rpbar">{rpBar}</div>}
      {entry.sets.map((s, si) => {
        // Cardio sets (lib/history.js's buildSets) carry {min, speed}, never {w, r} — the two
        // big steppers below switch what they edit by mode, same distinction Workout.jsx's own
        // ExerciseBlock makes, instead of assuming every set is a weight×reps one.
        const cardio = modeOf(entry.target || {}) === 'cardio'
        return <fieldset disabled={!!conflict} key={si} className={'bk-setrow' + (s.done ? ' done' : '')}>
          <span className="bk-setn">{si + 1}</span>
          {cardio ? <>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'min', -1)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.min)}<i>{t('min')}</i></span>
              <button onClick={() => setField(exIdx, si, 'min', 1)}>+</button>
            </div>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'speed', -0.5)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.speed)}<i>{t('km/h')}</i></span>
              <button onClick={() => setField(exIdx, si, 'speed', 0.5)}>+</button>
            </div>
          </> : <>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'w', -2.5)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.w)}<i>{plan.unit}</i></span>
              <button onClick={() => setField(exIdx, si, 'w', 2.5)}>+</button>
            </div>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'r', -1)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.r)}<i>{entry.target?.mode === 'time' ? 's' : t('reps')}</i></span>
              <button onClick={() => setField(exIdx, si, 'r', 1)}>+</button>
            </div>
          </>}
          {!cardio && modeOf(entry.target || {}) === 'reps' && effortKind !== 'none' && <div className="bk-bigstp bk-effort-stp">
            <button onClick={() => setEffort(exIdx, si, effortKind, -1)}>−</button>
            <span className="bk-bigstp-v">{s[effortKind] ?? '—'}<i>{effortKind.toUpperCase()}</i></span>
            <button onClick={() => setEffort(exIdx, si, effortKind, 1)}>+</button>
          </div>}
          <button className={'bk-check' + (s.done ? ' on' : '')} onClick={() => toggleDone(exIdx, si)} aria-label={t('Done')}><Icon name="check" /></button>
        </fieldset>
      })}
    </div>}
    {active.entries.length > 0 && <button disabled={!!conflict} className="bk-finish" onClick={finish}>{t('Finish workout & exit')}</button>}
    {showAdd && <div className="bk-overlay">
      <div className="bk-pad bk-tools-pad">
        <button className="bk-close" onClick={() => setShowAdd(false)} aria-label={t('Close')}><Icon name="xmark" /></button>
        <div className="bk-pad-title">{t('Add exercise')}</div>
        <ExerciseSearchList excludeIds={active.entries.map(e => e.id)} onPick={doAdd} />
      </div>
    </div>}
  </div>
}

/* ============================ admin overlay (kiosk-code or trainer-cookie) ============================ */
function BunkerAdminLogin({ onClose, onSuccess }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    setBusy(true); setErr('')
    bunkerAdminCheckin(code).then(r => onSuccess(r.token)).catch(e => { setErr(e.message); setBusy(false) })
  }
  return <div className="bk-overlay">
    <div className="bk-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Trainer/admin code')}</div>
      <input className="bk-code-input" inputMode="numeric" maxLength={6} value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
      {err && <div className="bk-pad-err">{err}</div>}
      <button className="bk-join" disabled={busy || code.length < 6} onClick={submit}>{t('Unlock')}</button>
    </div>
  </div>
}
function BunkerAdminOverlay({ adminToken, onClose }) {
  const nav = useNavigate()
  const [sessions, setSessions] = useState([])
  const [settings, setSettings] = useState(null)
  const load = () => {
    fetchBunkerAdminSessions(adminToken).then(setSessions).catch(() => {})
    fetchBunkerSettings().then(setSettings).catch(() => {})
  }
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])
  const close = uid => closeBunkerSession(uid, adminToken).then(load)
  const togglePause = (uid, paused) => pauseBunkerSession(uid, paused, adminToken).then(load)
  const setCols = n => saveBunkerSettings({ columns: n }, adminToken).then(setSettings)
  const setBeep = v => saveBunkerSettings({ enableRestEndBeep: v }, adminToken).then(setSettings)
  return <div className="bk-overlay">
    <div className="bk-pad bk-admin-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Room admin')}</div>
      <div className="bk-admin-list">
        {sessions.length === 0 && <div className="dim small">{t('Nobody checked in yet — be the first.')}</div>}
        {sessions.map(s => (
          <div key={s.uid} className="bk-admin-row">
            <span>{s.name}{s.paused ? ' · ' + t('Paused') : ''}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="bk-admin-x" onClick={() => togglePause(s.uid, !s.paused)} aria-label={s.paused ? t('Resume') : t('Pause')}>
                <Icon name={s.paused ? 'play' : 'pause'} />
              </button>
              <button className="bk-admin-x" onClick={() => close(s.uid)} aria-label={t('Force close session')}><Icon name="xmark" /></button>
            </div>
          </div>
        ))}
      </div>
      {settings && <>
        <div className="bk-admin-setting">
          <span>{t('Grid columns')}</span>
          <div className="row" style={{ gap: 6 }}>
            {['auto', 2, 3, 4, 6].map(n => <button key={n} className={'bk-key sm' + (settings.columns === n ? ' on' : '')} onClick={() => setCols(n)}>{n === 'auto' ? t('Auto') : n}</button>)}
          </div>
        </div>
        <div className="bk-admin-setting">
          <span>{t('Rest-over sound alert')}</span>
          <button className={'bk-key sm' + (settings.enableRestEndBeep ? ' on' : '')} onClick={() => setBeep(!settings.enableRestEndBeep)}>
            {settings.enableRestEndBeep ? t('On') : t('Off')}
          </button>
        </div>
      </>}
      <button className="bk-join" style={{ marginTop: 16, width: '100%' }} onClick={() => nav('/admin/bunker')}>
        <Icon name="dumbbell" /> {t('Open the full admin panel')}
      </button>
    </div>
  </div>
}

const DEFAULT_SETTINGS = { columns: 4, header: '2J Fitness Center', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 }

/* ============================ root ============================ */
export default function Bunker() {
  const nav = useNavigate()
  const [board, setBoard] = useState([])
  const [todayPrs, setTodayPrs] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  // V3 fix — this device's own local, in-memory map of every member it has already checked in
  // for THIS visit: { [uid]: { token, name, exp } }. Deliberately never written to localStorage
  // (or anywhere else that outlives this page load) — the Bunker is a shared physical kiosk in
  // the middle of the gym floor, and a credential readable from the browser's own storage after
  // someone has walked away is exactly the kind of thing that must not survive a refresh or a
  // reopen. A refresh clears everyone's local access at once, same trade-off the single-session
  // model already made before this fix (see AI_HANDOFF.md for the explicit reasoning). It's
  // *access* that's scoped to this device, never the training data itself — S.active stays
  // exactly as safe and persistent as it always was, on the server, independent of this map.
  const [credentials, setCredentials] = useState({})
  // Credentials whose compact training panels are currently open. Minimizing only removes one
  // uid from this list; it never touches that member's in-memory credential.
  const [activeUids, setActiveUids] = useState([])
  const [showCheckin, setShowCheckin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [showExitLock, setShowExitLock] = useState(false)
  const [adminToken, setAdminToken] = useState(null)
  // The top bar's active tab — 'training' | 'library' | 'plates' | 'rm' | 'timer' | 'warmup',
  // never null: the bar always shows one of them, 'training' by default. Root-level on purpose:
  // neither this nor the timer's own running state should reset just because the member
  // switches which tab they're looking at.
  const [tool, setTool] = useState('training')
  const [layout, setLayoutState] = useState(readLayout)
  const [focusUid, setFocusUid] = useState(null)   // the member opened from the compact grid
  const setLayout = k => { setLayoutState(k); setFocusUid(null); try { localStorage.setItem(LAYOUT_KEY, k) } catch { /* display preference only */ } }
  const [timer, setTimer] = useState(DEFAULT_TIMER_STATE)
  const tapsRef = useRef([])
  const paired = (() => { try { return JSON.parse(localStorage.getItem(PAIR_KEY) || 'null') } catch { return null } })()
  const open = activeUids.map(uid => [uid, credentials[uid]]).filter(([, credential]) => !!credential)
  const minimized = Object.entries(credentials).filter(([uid]) => !activeUids.includes(uid))

  useEffect(() => {
    let alive = true
    const poll = () => fetchBunkerSnapshot().then(snapshot => {
      if (!alive) return
      setBoard(snapshot.sessions)
      setTodayPrs(snapshot.todayPrs)
    }).catch(() => {})
    poll()
    const id = setInterval(poll, BOARD_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])
  useEffect(() => { fetchBunkerSettings().then(setSettings).catch(() => {}) }, [])
  // Drops a local credential the moment its own card leaves the board for any reason other than
  // "it's the one I'm actively looking at right now" — see lib/bunker-credentials.js's own doc
  // comment for exactly which real-world cases that covers (finish, admin force-close, the
  // 15-minute idle timeout) and why minimizing is never one of them.
  useEffect(() => { setCredentials(c => purgeStaleCredentials(c, board, activeUids)) }, [board])
  // A credential that failed to actually resume (GET /session 401'd — the rare case of a token
  // that outlived its own 4h TTL while its card stayed on the board because the member kept
  // training right up to that edge) or that just finished a workout both end the same way here:
  // drop the stale/spent credential and fall back to the board, where the next tap correctly
  // asks for the PIN again instead of silently doing nothing.
  const releaseActive = uid => {
    setCredentials(c => { if (!(uid in c)) return c; const next = { ...c }; delete next[uid]; return next })
    setActiveUids(list => list.filter(x => x !== uid))
    setFocusUid(f => (f === uid ? null : f))
  }
  const expand = uid => setActiveUids(list => list.includes(uid) ? list : [...list, uid])
  const minimize = uid => { setActiveUids(list => list.filter(x => x !== uid)); setFocusUid(f => (f === uid ? null : f)) }

  // A discreet way off a public kiosk — three quick taps on the room header, then the same
  // admin code the room-admin overlay already asks for, rather than a visible "exit" button
  // anyone walking past could tap by accident.
  const onExitTap = () => {
    const now = Date.now()
    tapsRef.current = [...tapsRef.current.filter(t => now - t < 1200), now]
    if (tapsRef.current.length >= 3) { tapsRef.current = []; setShowExitLock(true) }
  }

  return <div className="bunker">
    <BunkerTopBar active={tool} onSelect={setTool} header={settings.header || '2J Fitness Center'} paired={paired}
      onAdmin={() => setShowAdminLogin(true)} onExitTap={onExitTap} />
    <div className="bk-tabcontent">
      {/* Kept mounted and merely hidden while another tab shows, not unmounted — a browsed-away
          "Entrenamiento" tab must never re-fetch or reset the session (or its own idle timer)
          just because the member is looking at the plate calculator. The board underneath, when
          nobody's checked in yet, already polls at the root (below) and has nothing tab-switch
          could lose either way. */}
      <div style={{ display: tool === 'training' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {!!Object.keys(credentials).length && <div className="bk-multi" style={open.length ? undefined : { display: 'none' }}>
              <div className="bk-multi-actions">
                <BunkerLayoutToggle layout={layout} onChange={setLayout} />
                {minimized.map(([uid, credential]) => <button key={uid} className="bk-restore" onClick={() => expand(uid)}><Icon name="expand" />{credential.name}</button>)}
                <button className="bk-join" onClick={() => setShowCheckin(true)}><Icon name="plus" /> {t('Join the Bunker')}</button>
              </div>
              <BunkerPanelGrid credentials={credentials} activeUids={activeUids} compact={layout === 'compact'} focusUid={focusUid} renderPanel={(uid, current, hidden, mode = {}) =>
                <BunkerTrainingPanel key={uid} token={current.token} name={current.name} settings={settings} hidden={hidden} compact={!!mode.compact}
                  onOpen={() => setFocusUid(uid)} onBack={mode.focused ? () => setFocusUid(null) : undefined}
                  onMinimize={() => minimize(uid)} onFinish={() => releaseActive(uid)} onInvalid={() => releaseActive(uid)} />
              } />
            </div>}
        {!open.length && <div className="bk-board-tools"><BunkerLayoutToggle layout={layout} onChange={setLayout} /></div>}
        {!open.length && <BunkerBoard board={board} settings={settings} credentials={credentials}
              onCheckin={() => setShowCheckin(true)} onResume={expand} />}
        <TodayPrs prs={todayPrs} compact={open.length > 0} />
      </div>
      {tool !== 'training' && <BunkerToolPane tool={tool} timer={timer} setTimer={setTimer} />}
    </div>
    {showCheckin && <BunkerCheckinPad onClose={() => setShowCheckin(false)} onSuccess={s => {
      // A fresh PIN checkin always wins over anything already held locally for that uid — it's
      // a brand-new token from the server (POST /checkin never checks for one already existing),
      // so replacing rather than merging keeps this device from ever acting on a token the
      // server itself has already superseded.
      setCredentials(c => ({ ...c, [s.uid]: { token: s.token, name: s.name, exp: s.exp } }))
      expand(s.uid)
      setShowCheckin(false)
    }} />}
    {showAdminLogin && <BunkerAdminLogin onClose={() => setShowAdminLogin(false)} onSuccess={tok => { setAdminToken(tok); setShowAdminLogin(false) }} />}
    {adminToken && <BunkerAdminOverlay adminToken={adminToken} onClose={() => setAdminToken(null)} />}
    {showExitLock && <BunkerAdminLogin onClose={() => setShowExitLock(false)} onSuccess={() => nav('/home')} />}
  </div>
}
