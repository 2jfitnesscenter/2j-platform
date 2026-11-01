// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Readiness · accumulated fatigue · proposed deload. Pure and deterministic — no AI, no I/O — so the member's app and the server compute the same thing
// (api/lib/fatigue.js is a byte copy; api/test/fatigue.test.js keeps them equal). It works with the workout log alone; sleep (S.sleep, minutes), muscle recovery,
// volume landmarks and check-ins are used only when they exist, and a missing source is simply absent — never guessed.
// Nothing here edits a routine, a load or a plan: a deload is only PROPOSED, and when the member accepts it becomes a temporary, reversible 1-week adjustment
// (S.deload) that the session builder applies on top of the untouched base plan (lib/progression.js → withDeload).
//
// Fatigue (a trend, never one bad session) = points from independent signals over the last 28 days of NON-deload sessions:
//   effort_up   same loads at ≥ 1 RPE harder (RIR lower)     +2 (+1 when in ≥ 2 exercises)   family effort     — lib/routine-review.js plateau()
//   hard        ≥ 2 of the last 3 sessions rated mostly hard +2 (3 of 3: +3)                  family effort
//   misses      repeated "couldn't do it"/missed reps        +2 (≥ 2 exercises: +3)           family failures
//   incomplete  ≥ 2 of the last 3 sessions cut short         +1                               family failures
//   checkins    fatigue ≥ 4 on ≥ 3 of the last 14 days       +2                               family wellbeing   (only when allowed)
//   sleep       average of the last nights < 6 h / < 6.5 h   +2 / +1                          family sleep       (≥ 3 nights)
//   recovery    overall muscle recovery < 40 % / < 60 %      +2 / +1                          family recovery    (caller supplies it)
//   volume      a group over MRV / ≥ 2 groups in MAV         +2 / +1                          family load        (caller supplies it)
//   level: high = ≥ 6 points from ≥ 2 families · elevated = ≥ 3 points · otherwise normal. Only a repeated pattern ever gets there.
import { plateau } from './routine-review.js'
import { countsForProgression } from './workout-policy.js'

export const HIGH_POINTS = 6
export const ELEVATED_POINTS = 3
export const DELOAD_DAYS = 7
export const DELOAD_VOLUME_CUT = 0.35      // ≈ 30–40 % fewer working sets
export const DELOAD_LOAD_CUT = 0.075       // ≈ 5–10 % lighter
export const DELOAD_RIR = 3                // an easier effort target
export const DELOAD_COOLDOWN_DAYS = 14     // no new proposal right after a deload, or after the member kept the plan

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86400000
const day = iso => Date.parse(iso + 'T12:00:00Z')
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / DAY)
const addDays = (iso, n) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10)
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const isWork = s => s && s.done && s.type !== 'warmup'
/** One effort scale: RPE higher = harder, RIR lower = harder → RPE = 10 − RIR. */
export const effortOf = s => (num(s?.rpe) != null ? s.rpe : num(s?.rir) != null ? 10 - s.rir : null)
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

/** Sessions of the last 28 days, oldest first, without the deload-week entries (deliberately easy, they say nothing about fatigue). */
export function recentSessions(S, today, days = 28) {
  const from = addDays(today, -(days - 1))
  return (S?.workouts || [])
    .filter(w => countsForProgression(w) && ISO.test(w.d || '') && w.d >= from && w.d <= today)
    .map(w => ({ ...w, entries: (Array.isArray(w.entries) ? w.entries : []).filter(e => e && typeof e === 'object' && !e.target?.deload) }))
    .filter(w => w.entries.length)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
}

/** Average sleep over the most recent nights (S.sleep: [{ d, v: minutes }]); null with fewer than 3 nights in the last 7 days. */
export function sleepHours(S, today) {
  const from = addDays(today, -6)
  const nights = (Array.isArray(S?.sleep) ? S.sleep : []).filter(x => x && ISO.test(x.d || '') && x.d >= from && x.d <= today && num(x.v) > 0)
  return nights.length >= 3 ? mean(nights.map(x => x.v)) / 60 : null
}

/** { level: 'normal'|'elevated'|'high', points, families, signals, sessions, enough } — see the header for the rules. ctx: { checkins?, recovery?, volume? }. */
export function fatigueState(S, today, ctx = {}) {
  const sessions = recentSessions(S, today)
  const signals = []
  const add = (code, points, family, extra) => signals.push({ code, points, family, ...extra })
  if (sessions.length >= 3) {
    const p = plateau(sessions)
    const r = code => p.reasons.find(x => x.code === code)
    if (r('effort_up')) add('effort_up', 2 + (r('effort_up').n >= 2 ? 1 : 0), 'effort', { n: r('effort_up').n })
    if (r('hard')) add('hard', r('hard').n >= 3 ? 3 : 2, 'effort', { n: r('hard').n })
    if (r('misses')) add('misses', r('misses').n >= 2 ? 3 : 2, 'failures', { n: r('misses').n })
    if (r('incomplete')) add('incomplete', 1, 'failures', { n: r('incomplete').n })
  }
  if (ctx.checkins !== false) {
    const from = addDays(today, -13)
    const n = (Array.isArray(S?.checkins) ? S.checkins : []).filter(c => c && ISO.test(c.d || '') && c.d >= from && c.d <= today && num(c.fatigue) >= 4).length
    if (n >= 3) add('checkins', 2, 'wellbeing', { n })
  }
  const sleep = sleepHours(S, today)
  if (sleep != null && sleep < 6.5) add('sleep', sleep < 6 ? 2 : 1, 'sleep', { hours: Math.round(sleep * 10) / 10 })
  if (num(ctx.recovery) != null && ctx.recovery < 60) add('recovery', ctx.recovery < 40 ? 2 : 1, 'recovery', { pct: Math.round(ctx.recovery) })
  if (ctx.volume) {
    if (ctx.volume.over >= 1) add('volume', 2, 'load', { n: ctx.volume.over, mrv: true })
    else if (ctx.volume.high >= 2) add('volume', 1, 'load', { n: ctx.volume.high })
  }
  const points = signals.reduce((n, s) => n + s.points, 0)
  const families = [...new Set(signals.map(s => s.family))]
  const level = points >= HIGH_POINTS && families.length >= 2 ? 'high' : points >= ELEVATED_POINTS ? 'elevated' : 'normal'
  return { level, points, families, signals, sessions: sessions.length, enough: sessions.length >= 3 }
}

/** Is a deload adjustment running on `today`? → the S.deload record or null. */
export function activeDeload(S, today) {
  const d = S?.deload
  return d && ISO.test(d.from || '') && ISO.test(d.until || '') && d.from <= today && today < d.until ? d : null
}

/** A proposal only when fatigue is HIGH, nothing is running and nothing was just ended or dismissed. Never applied by itself. */
export function deloadProposal(S, today, ctx = {}) {
  if (activeDeload(S, today)) return null
  const quiet = [S?.deloadDismissed, S?.deload?.until].filter(d => ISO.test(d || ''))
  if (quiet.some(d => daysBetween(d, today) < DELOAD_COOLDOWN_DAYS && daysBetween(d, today) >= 0)) return null
  const f = fatigueState(S, today, ctx)
  if (f.level !== 'high') return null
  return { from: today, until: addDays(today, DELOAD_DAYS), days: DELOAD_DAYS, volumeCut: DELOAD_VOLUME_CUT, loadCut: DELOAD_LOAD_CUT, rir: DELOAD_RIR, signals: f.signals, points: f.points }
}

/** The member accepts: a temporary 1-week adjustment record. The routines/programs are not touched; the session builder applies it on top of the base plan. */
export function applyDeload(S, today, proposal, by = 'member') {
  if (!ISO.test(today || '') || !proposal) return false
  S.deload = { from: today, until: addDays(today, proposal.days || DELOAD_DAYS), volumeCut: proposal.volumeCut ?? DELOAD_VOLUME_CUT, loadCut: proposal.loadCut ?? DELOAD_LOAD_CUT,
    rir: proposal.rir ?? DELOAD_RIR, why: (proposal.signals || []).map(s => s.code), by }
  return true
}
/** "Keep my plan": no deload now, and no new proposal for DELOAD_COOLDOWN_DAYS. */
export function keepPlan(S, today) { if (!ISO.test(today || '')) return false; S.deloadDismissed = today; return true }
/** Back to the normal plan before the week is over (the base plan was never changed). */
export function cancelDeload(S, today) { if (!S?.deload) return false; delete S.deload; S.deloadDismissed = today; return true }

/**
 * Today's readiness: { state: 'push'|'maintain'|'adjust'|'recover', score, level, reasons: [{ code, impact, … }] }, or null when there is nothing real to base it on.
 * score = 75 + sleep (+8…−18) + muscle recovery (+10…−20) + today's check-in (+5/−8/−8) + headroom (+5, repeated easy effort) − training fatigue (effort + failure signals: ≥ 3 points −15, ≥ 6 points −35).
 * state: recover = high fatigue or < 40 · adjust = elevated fatigue or < 60 · push = ≥ 80 with normal fatigue · otherwise maintain.
 */
export function readiness(S, today, ctx = {}) {
  const f = fatigueState(S, today, ctx)
  const sessions = recentSessions(S, today)
  const rated = sessions.some(w => w.entries.some(e => (e.sets || []).some(s => isWork(s) && effortOf(s) != null)))
  const sleep = sleepHours(S, today)
  const recovery = num(ctx.recovery)
  const today1 = (Array.isArray(S?.checkins) && ctx.checkins !== false) ? S.checkins.find(c => c && c.d === today) : null
  if (!rated && sleep == null && recovery == null && !today1) return null
  const parts = []
  const add = (code, impact, extra) => { if (impact) parts.push({ code, impact, ...extra }) }
  if (sleep != null) add(sleep >= 7.5 ? 'sleep_good' : sleep >= 6.5 ? 'sleep_ok' : 'sleep_low', sleep >= 7.5 ? 8 : sleep >= 6.5 ? 0 : sleep >= 6 ? -8 : -18, { hours: Math.round(sleep * 10) / 10 })
  if (recovery != null) add(recovery >= 80 ? 'recovery_good' : recovery >= 60 ? 'recovery_ok' : 'recovery_low', recovery >= 80 ? 10 : recovery >= 60 ? 0 : recovery >= 40 ? -10 : -20, { pct: Math.round(recovery) })
  if (today1) {
    if (num(today1.energy) >= 4) add('checkin_good', 5)
    else if (num(today1.energy) <= 2) add('checkin_low', -8)
    if (num(today1.fatigue) >= 4) add('checkin_tired', -8)
  }
  const easy = easyStreak(sessions)
  if (easy) add('headroom', 5, { n: easy })
  // the penalty comes from what the training itself shows (effort + failures); sleep, recovery and check-ins are already in the score above, once
  const trainingPoints = f.signals.filter(s => s.family === 'effort' || s.family === 'failures').reduce((n, s) => n + s.points, 0)
  if (trainingPoints >= HIGH_POINTS) add('fatigue_high', -35, { points: f.points })
  else if (trainingPoints >= ELEVATED_POINTS) add('fatigue_elevated', -15, { points: f.points })
  const score = Math.max(0, Math.min(100, Math.round(75 + parts.reduce((n, p) => n + p.impact, 0))))
  const state = f.level === 'high' || score < 40 ? 'recover' : f.level === 'elevated' || score < 60 ? 'adjust' : score >= 80 && f.level === 'normal' ? 'push' : 'maintain'
  // with elevated / high fatigue the reasons ARE the signals behind it (the numbers), then the other factors; otherwise the factors that moved the score most
  const sig = f.level === 'normal' ? [] : f.signals.slice(0, 2).map(x => ({ code: 'signal', signal: x.code, impact: 0, n: x.n, hours: x.hours, pct: x.pct }))
  const main = parts.filter(p => !(f.level !== 'normal' && p.code.startsWith('fatigue_'))).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  const reasons = [...sig, ...main].slice(0, 3)
  return { state, score, level: f.level, reasons }
}

// The last 3 sessions all had rated working sets at RPE ≤ 7 (RIR ≥ 3): repeated "clearly easy" effort → there is room to push.
function easyStreak(sessions) {
  const last = sessions.slice(-3)
  if (last.length < 3) return 0
  const avg = w => mean(w.entries.flatMap(e => (e.sets || []).filter(isWork).map(effortOf).filter(x => x != null)))
  const a = last.map(avg)
  return a.every(x => x != null && x <= 7) ? 3 : 0
}
