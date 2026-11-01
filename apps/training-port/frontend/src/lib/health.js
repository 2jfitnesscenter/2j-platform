// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health V2 — "your physical evolution", derived. Every number here comes from series the app
// already keeps (S.bodyweight, S.measurements[key] from lib/measurements.js, workouts, and the
// workout's cardio data via lib/fitness.js). Nothing is stored by this module and nothing is
// interpreted medically: it filters, compares and summarises what was measured, declared or
// imported, and says where each value came from when the entry knows.
import { MEASUREMENTS, MEASUREMENT } from './measurements.js'
import { orderedBodyWeightSeries, latestBodyWeight } from './bodyweight.js'
import { weekKey, todayISO } from './format.js'
import { fitnessOf } from './fitness.js'

// Where a stored entry came from (entry.src, written by every writer since Health V2; older
// entries have none and simply show no source rather than a guessed one).
export const SOURCE_LABEL = {
  manual: 'Entered by you', scan: 'Scanned report', staff: 'Gym staff', apple: 'Apple Health',
  whoop: 'WHOOP', tanita: 'Tanita',
}
// Every value on the Health screens is one of these kinds — never presented as another.
export const KIND = { measured: 'measured', declared: 'declared', calculated: 'calculated', imported: 'imported' }

export const RANGES = [
  { key: '1m', days: 30 }, { key: '3m', days: 91 }, { key: '6m', days: 182 }, { key: '1y', days: 365 }, { key: 'all', days: null },
]
const isoMinusDays = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10) }

// Weight lives in S.bodyweight as {d, w}; every other metric in S.measurements[key] as {d, v}.
export const WEIGHT = { key: 'weight', label: 'Weight', unit: 'kg', group: 'composition', icon: 'scale', iconTint: 'var(--teal)' }
export const metricDef = key => key === 'weight' ? WEIGHT : MEASUREMENT[key]
export function seriesOf(S, key) {
  if (key === 'weight') return orderedBodyWeightSeries(S).map(b => ({ d: b.d, v: b.w, t: b.t, src: b.src }))
  return (S.measurements?.[key] || []).map(x => ({ d: x.d, v: x.v, t: x.t, src: x.src }))
}

// The metrics this member actually has, in the screen's order: weight and the scan's whole-body
// readings first, circumferences and skinfolds after. Segmental readings are shown on the body.
const ORDER = ['weight', ...MEASUREMENTS.filter(m => m.group === 'composition').map(m => m.key),
  ...MEASUREMENTS.filter(m => m.group === 'body').map(m => m.key), ...MEASUREMENTS.filter(m => m.group === 'folds').map(m => m.key)]
export const availableMetrics = S => ORDER.filter(k => seriesOf(S, k).length > 0)

// Relative change only where it means something: never for a percentage (a change in points is
// the honest figure) or for a unitless rating like Tanita's visceral-fat level.
const pctMeaningful = def => def && def.unit && def.unit !== '%'
const round = (v, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp

/**
 * One metric over a period: the points inside it (for the chart), the latest value on record,
 * the first value of the period, and the difference between them. With a single reading in the
 * period there is nothing to compare, so the difference stays null — never a made-up zero.
 */
export function metricSummary(S, key, range = '6m', today = todayISO()) {
  const def = metricDef(key)
  const all = seriesOf(S, key)
  if (!def || !all.length) return null
  const days = RANGES.find(r => r.key === range)?.days
  const from = days == null ? null : isoMinusDays(today, days)
  const points = from ? all.filter(p => p.d >= from && p.d <= today) : all.filter(p => p.d <= today)
  const current = all[all.length - 1]
  const start = points.length > 1 ? points[0] : null
  const end = points.length ? points[points.length - 1] : null
  const delta = start && end ? round(end.v - start.v, 2) : null
  const pct = delta != null && pctMeaningful(def) && start.v ? round(delta / start.v * 100) : null
  return { key, def, points, current, start, end, delta, pct, from }
}

// Every date that has any body-composition reading — the candidates for "compare A vs B".
export function scanDates(S) {
  const dates = new Set()
  MEASUREMENTS.filter(m => m.group === 'composition' || m.group === 'segments')
    .forEach(m => (S.measurements?.[m.key] || []).forEach(x => dates.add(x.d)))
  return [...dates].sort()
}

const valueOn = (S, key, iso) => seriesOf(S, key).find(p => p.d === iso) || null

/**
 * Two measurement days side by side: for every metric read on both, A, B, the change and (when
 * meaningful) the relative change. No "better"/"worse" — whether less fat or more water is good
 * depends on the person and the goal, so the change is shown as a number, not a verdict.
 */
export function compareMeasurements(S, dA, dB) {
  const [a, b] = dA <= dB ? [dA, dB] : [dB, dA]
  const keys = ['weight', ...MEASUREMENTS.filter(m => m.group === 'composition' || m.group === 'segments').map(m => m.key)]
  return keys.map(key => {
    const va = valueOn(S, key, a), vb = valueOn(S, key, b)
    if (!va || !vb) return null
    const def = metricDef(key)
    const delta = round(vb.v - va.v, 2)
    return { key, def, a: va.v, b: vb.v, delta, pct: pctMeaningful(def) && va.v ? round(delta / va.v * 100) : null }
  }).filter(Boolean)
}

// The five body segments the scan reports (lib/measurements.js's segFat*/segMuscle* keys).
export const SEGMENTS = [
  { key: 'armL', label: 'Left arm', fat: 'segFatArmL', muscle: 'segMuscleArmL' },
  { key: 'armR', label: 'Right arm', fat: 'segFatArmR', muscle: 'segMuscleArmR' },
  { key: 'trunk', label: 'Trunk', fat: 'segFatTrunk', muscle: 'segMuscleTrunk' },
  { key: 'legL', label: 'Left leg', fat: 'segFatLegL', muscle: 'segMuscleLegL' },
  { key: 'legR', label: 'Right leg', fat: 'segFatLegR', muscle: 'segMuscleLegR' },
]
/** Per segment: latest fat/muscle and their change over the range. Neutral by design — the
 *  scan's segment fat is already a ratio against its own reference band, and 2J has no validated
 *  per-segment targets, so no colour verdict is derived here. */
export function segmentSummary(S, range = '6m', today = todayISO()) {
  return SEGMENTS.map(seg => ({
    ...seg,
    fat: metricSummary(S, seg.fat, range, today),
    muscle: metricSummary(S, seg.muscle, range, today),
  })).map(s => ({ ...s, has: !!(s.fat || s.muscle) }))
}
export const hasSegments = S => SEGMENTS.some(seg => seriesOf(S, seg.fat).length || seriesOf(S, seg.muscle).length)

// BMI: calculated, secondary, never the headline. Needs a height and a weight.
export function bmiOf(S) {
  const w = latestBodyWeight(S)?.w
  const h = S.height
  if (!(w > 0) || !(h > 0)) return null
  return round(w / ((h / 100) ** 2))
}

/**
 * This week's activity, honestly: workouts and their total duration, plus calories ONLY as
 * recorded by a real source — "932 kcal recorded in 2 sessions", never extrapolated to the
 * sessions that have none.
 */
export function weekActivity(S, iso = todayISO()) {
  const wk = weekKey(iso)
  const ws = (S.workouts || []).filter(w => weekKey(w.d) === wk)
  const durationMs = ws.reduce((n, w) => n + (w.end > w.start ? w.end - w.start : 0), 0)
  const withKcal = ws.map(fitnessOf).filter(f => f && f.calories > 0)
  return {
    workouts: ws.length, durationMs,
    kcal: withKcal.length ? Math.round(withKcal.reduce((n, f) => n + f.calories, 0)) : null,
    kcalSessions: withKcal.length,
  }
}
