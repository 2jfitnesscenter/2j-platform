// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health V2 — optional composition goals for the three metrics the app already measures: weight (the goal is the existing S.targetW), body fat and muscle mass
// (S.compGoals = { bodyFat?: { target, at }, muscleMass?: { target, at } }). Pure and derived: the status of a goal is computed from the readings the member already has,
// and nothing here stores a conclusion. A goal belongs to the member's own profile (S is opaque to Sync) and is read by no one else: it is not part of any share, the
// Social snapshots or the Coach/AI payloads.
//
// Reference ranges are shown ONLY where a published basis exists and the person is an adult:
//   · BMI bands — WHO (adults, 18+): under 18.5 · 18.5–24.9 · 25–29.9 · 30 and over. BMI does not tell muscle from fat; the screen says so.
//   · Body-fat bands — American Council on Exercise (ACE) general reference for adults, by sex. Descriptive categories, not a diagnosis.
//   · Muscle mass — no widely accepted reference range for a gym scale exists, so none is shown (trend and goal only).
// A range needs a known birth date (adult) — and for body fat the sex the member gave — otherwise the screen asks for it instead of guessing. Colour is never the only signal:
// every state and band has a text label.
import { metricSummary, bmiOf } from './health.js'
import { todayISO } from './format.js'

export const GOAL_KEYS = ['weight', 'bodyFat', 'muscleMass']
export const GOAL_LIMITS = { weight: { min: 30, max: 300 }, bodyFat: { min: 3, max: 50 }, muscleMass: { min: 10, max: 80 } }
// Differences smaller than this are drawing/measurement noise for display ("flat"), and a goal this close counts as reached. Display heuristics, not clinical thresholds.
const NOISE = { weight: 0.3, bodyFat: 0.3, muscleMass: 0.3 }
const REACHED = { weight: 0.5, bodyFat: 0.5, muscleMass: 0.3 }
const MIN_SPAN_DAYS = 14
const DAY = 86400000
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY)

/** The stored goals, cleaned: known keys, a number inside its limits. Anything else is ignored. */
export function normalizeGoals(raw) {
  const out = {}
  for (const k of ['bodyFat', 'muscleMass']) {
    const t = Number(raw?.[k]?.target)
    if (Number.isFinite(t) && t >= GOAL_LIMITS[k].min && t <= GOAL_LIMITS[k].max) out[k] = { target: round(t, 1), at: typeof raw[k].at === 'string' ? raw[k].at.slice(0, 10) : null }
  }
  return out
}
/** The goal of one metric (or null). Weight is the member's existing target weight. */
export function goalOf(S, key) {
  if (key === 'weight') return S?.targetW > 0 ? { target: S.targetW, at: null } : null
  return normalizeGoals(S?.compGoals)[key] || null
}
/** The next S.compGoals with one goal set (target number) or removed (null). Weight is not stored here — callers write S.targetW. */
export function withGoal(S, key, target, today = todayISO()) {
  const goals = normalizeGoals(S?.compGoals)
  if (!['bodyFat', 'muscleMass'].includes(key)) return goals
  if (target == null || target === '') delete goals[key]
  else {
    const t = Number(target)
    if (!(t >= GOAL_LIMITS[key].min && t <= GOAL_LIMITS[key].max)) return goals
    goals[key] = { target: round(t, 1), at: today }
  }
  return goals
}
export const validTarget = (key, v) => Number.isFinite(Number(v)) && Number(v) >= GOAL_LIMITS[key].min && Number(v) <= GOAL_LIMITS[key].max

/**
 * Where a goal stands, from the readings. `state`:
 *   reached   within tolerance of the target (or past it in the wanted direction)
 *   toward    the last 90 days moved in the wanted direction by more than the noise floor
 *   away      moved the other way
 *   flat      moved less than the noise floor
 *   few-data  fewer than two readings, or less than two weeks apart: no trend is claimed
 *   no-data   nothing measured yet
 */
export function goalStatus(S, key, today = todayISO()) {
  const goal = goalOf(S, key)
  const sum = metricSummary(S, key, '3m', today)
  const all = metricSummary(S, key, 'all', today)
  const current = all?.current || null
  if (!goal && !current) return null
  const base = { key, target: goal?.target ?? null, current, start: null, delta: null, remaining: null, state: 'no-data', needed: null, progressPct: null }
  if (!current) return base
  const span = sum?.start && sum?.end ? daysBetween(sum.start.d, sum.end.d) : 0
  const trendOk = !!(sum && sum.start && sum.end && span >= MIN_SPAN_DAYS)
  const out = { ...base, start: sum?.start || null, delta: trendOk ? sum.delta : null, state: trendOk ? 'flat' : 'few-data' }
  if (!goal) return out
  const gap = round(goal.target - current.v, 2)
  out.remaining = gap
  out.needed = Math.abs(gap) <= REACHED[key] ? 'hold' : gap < 0 ? 'down' : 'up'
  if (out.needed === 'hold') { out.state = 'reached'; return out }
  if (trendOk) {
    const moved = sum.delta
    if (Math.abs(moved) >= NOISE[key]) out.state = (moved < 0) === (out.needed === 'down') ? 'toward' : 'away'
  }
  // progress from the first reading of the window (or when the goal was set) to the target, only when that start is on the far side of the current value
  const from = (goal.at && all.points.find(p => p.d >= goal.at)) || sum?.start || null
  if (from && from.v !== goal.target) {
    const total = goal.target - from.v
    const done = current.v - from.v
    out.progressPct = Math.max(0, Math.min(100, Math.round(done / total * 100)))
  }
  return out
}

const ageOf = (S, today = todayISO()) => {
  const b = S?.birthDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b || '')) return null
  const y = Number(today.slice(0, 4)) - Number(b.slice(0, 4)) - (today.slice(5) < b.slice(5) ? 1 : 0)
  return y >= 0 && y < 120 ? y : null
}

const BMI_BANDS = [
  { id: 'under', label: 'Below the normal range', min: 0, max: 18.5, text: 'under 18.5' },
  { id: 'normal', label: 'Normal range', min: 18.5, max: 25, text: '18.5–24.9' },
  { id: 'over', label: 'Above the normal range', min: 25, max: 30, text: '25–29.9' },
  { id: 'high', label: 'Well above the normal range', min: 30, max: Infinity, text: '30 and over' },
]
// American Council on Exercise, general body-fat reference for adults (% of body weight).
const ACE = {
  male: [{ id: 'essential', label: 'Essential fat', min: 0, max: 6, text: '2–5 %' }, { id: 'athletes', label: 'Athletes', min: 6, max: 14, text: '6–13 %' }, { id: 'fitness', label: 'Fitness', min: 14, max: 18, text: '14–17 %' },
    { id: 'average', label: 'Average', min: 18, max: 25, text: '18–24 %' }, { id: 'above', label: 'Above the average range', min: 25, max: Infinity, text: '25 % and over' }],
  female: [{ id: 'essential', label: 'Essential fat', min: 0, max: 14, text: '10–13 %' }, { id: 'athletes', label: 'Athletes', min: 14, max: 21, text: '14–20 %' }, { id: 'fitness', label: 'Fitness', min: 21, max: 25, text: '21–24 %' },
    { id: 'average', label: 'Average', min: 25, max: 32, text: '25–31 %' }, { id: 'above', label: 'Above the average range', min: 32, max: Infinity, text: '32 % and over' }],
}
const bandOf = (bands, v) => bands.find(b => v >= b.min && v < b.max) || bands[bands.length - 1]

/**
 * The documented reference band for a metric, or why there is none. Returns { kind: 'band', basis, value, band } | { kind: 'needs', need: 'birthDate' | 'sex' } | { kind: 'none', why }.
 * Never invents a threshold: weight uses BMI (WHO), body fat uses ACE, muscle mass has no accepted range.
 */
export function referenceRange(S, key, today = todayISO()) {
  if (key === 'muscleMass') return { kind: 'none', why: 'muscle' }
  const age = ageOf(S, today)
  if (age == null) return { kind: 'needs', need: 'birthDate' }
  if (age < 18) return { kind: 'none', why: 'adult-only' }
  if (key === 'weight') {
    const bmi = bmiOf(S)
    if (bmi == null) return { kind: 'needs', need: 'height' }
    return { kind: 'band', basis: 'WHO (adults)', value: bmi, unit: 'BMI', band: bandOf(BMI_BANDS, bmi) }
  }
  if (key === 'bodyFat') {
    const sex = S?.body === 'female' ? 'female' : S?.body === 'male' ? 'male' : null
    if (!sex) return { kind: 'needs', need: 'sex' }
    const cur = metricSummary(S, 'bodyFat', 'all', today)?.current
    if (!cur) return { kind: 'none', why: 'no-reading' }
    return { kind: 'band', basis: 'ACE (adults)', value: cur.v, unit: '%', band: bandOf(ACE[sex], cur.v), sex }
  }
  return { kind: 'none', why: 'unknown' }
}
