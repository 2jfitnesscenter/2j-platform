// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health V2 — pure derivations over data 2J already holds. Nothing here reads a store, writes state, calls a provider or
// publishes anything: Health stays private to the member. Every function returns null / [] when there is nothing real to
// show, so the screens can drop the block instead of inventing a number.
import { weekKey, todayISO } from './format.js'
import { orderedBodyWeightSeries } from './bodyweight.js'
import { fitnessOf, ORIGIN_APP, SOURCE_NAME } from './fitness.js'
import { workoutEnergy, ENERGY_KIND } from './energy.js'
import { dailyActivity, bridgeState, getBridge, platformLabel } from './health-bridge.js'
import { lastBW, setsDone } from './history.js'
import { metricSummary } from './health.js'
import { EXIDX } from './exercises.js'
import { MUSCLES, loadOfWorkouts, musclesOf, muscleOptsOf, levelsOf } from './muscles.js'

/* ------------------------------------------------------------------ energy source --- */

/**
 * How one workout's energy is presented — the SAME three kinds the energy policy already defines
 * (measured wearable > official aggregate > 2J estimate; lib/energy.js). Never a sum, never relabelled:
 *   measured   → "463 kcal" + the app that recorded it when the origin is stored, else "Device / Health Connect"
 *   aggregate  → "463 kcal" + "Aggregated data" (the health store's own total over the session)
 *   estimated  → "≈235 kcal" + "2J estimate" (+ the range when there is one) — the only kind that gets ≈
 * `source` is the plain English key the UI translates; `detail` is an app/platform name that is data, not copy.
 */
export function energyPresentation(e) {
  if (!e || !(e.kcal > 0)) return null
  const platform = SOURCE_NAME[e.source] || null
  if (e.kind === ENERGY_KIND.estimated) {
    return { kind: 'estimated', approx: true, kcal: Math.round(e.kcal), source: '2J estimate', detail: null,
      range: e.low > 0 && e.high > 0 ? [Math.round(e.low), Math.round(e.high)] : null }
  }
  if (e.kind === ENERGY_KIND.aggregate) {
    return { kind: 'aggregate', approx: false, kcal: Math.round(e.kcal), source: 'Aggregated data', detail: platform, range: null }
  }
  // measured: the exact provider is shown only if it was stored (never guessed)
  const app = e.origin ? (ORIGIN_APP[e.origin] || e.origin) : null
  return { kind: 'measured', approx: false, kcal: Math.round(e.kcal), source: app ? null : 'Device', detail: app ? (platform ? `${app} · ${platform}` : app) : platform, range: null }
}

/** Energy of one saved workout, presented; null when no source has it (no weight/duration → nothing). */
export const workoutEnergyView = (w, S) => { try { return energyPresentation(workoutEnergy(w, S)) } catch { return null } }

/* ------------------------------------------------------------------------ states --- */

/**
 * The comprehensible Health state of this device/member:
 *   unavailable   no native bridge (browser / PWA) — nothing to connect here
 *   off           bridge present, never connected
 *   noPermission  connected but nothing granted beyond workouts (no steps/energy readable)
 *   partial       some of steps / energy are readable, others are not (or today has only one)
 *   wearable      sessions with a wearable's own figures exist
 *   estimateOnly  only 2J estimates (or nothing but the member's own logs)
 */
export function healthState(S, uid, now = Date.now()) {
  const bridge = getBridge()
  if (!bridge) return { state: 'unavailable', platform: null }
  const b = bridgeState(uid)
  const platform = platformLabel(bridge)
  if (!b.enabled) return { state: 'off', platform }
  const readsSteps = b.granted.includes('steps'), readsKcal = b.granted.includes('activeCalories')
  if (!readsSteps && !readsKcal) return { state: 'noPermission', platform, granted: b.granted }
  const daily = dailyActivity(uid, now)
  if (!readsSteps || !readsKcal || (daily && (daily.steps == null || daily.activeKcal == null))) return { state: 'partial', platform, granted: b.granted }
  const measured = (S.workouts || []).some(w => fitnessOf(w)?.calories > 0)
  return { state: measured ? 'wearable' : 'estimateOnly', platform, granted: b.granted }
}

/* ---------------------------------------------------------------------- the blocks --- */

const mins = ms => Math.round(ms / 60000)

/** Activity: today's steps / active kcal as the bridge last read them (this device, this day) — null without any. */
export function activityBlock(S, uid, now = Date.now()) {
  const d = dailyActivity(uid, now)
  if (!d || (d.steps == null && d.activeKcal == null)) return null
  return { steps: d.steps, activeKcal: d.activeKcal, at: d.at, platform: platformLabel(getBridge()) }
}

/** Training: this week's 2J sessions, time, volume and the weekly frequency over the last 4 weeks (real sessions only). */
export function trainingBlock(S, iso = todayISO()) {
  const ws = S.workouts || []
  if (!ws.length) return null
  const wk = weekKey(iso)
  const week = ws.filter(w => weekKey(w.d) === wk)
  const timeMs = week.reduce((n, w) => n + (w.end > w.start ? w.end - w.start : 0), 0)
  const vol = week.reduce((n, w) => n + (w.vol > 0 ? w.vol : 0), 0)
  const since = new Date(iso + 'T12:00:00'); since.setDate(since.getDate() - 28)
  const recent = ws.filter(w => w.d > since.toISOString().slice(0, 10) && w.d <= iso)
  return {
    sessions: week.length, minutes: mins(timeMs), volume: vol || null,
    perWeek: recent.length ? Math.round(recent.length / 4 * 10) / 10 : null,
    sets: week.reduce((n, w) => n + (() => { try { return setsDone(w) } catch { return 0 } })(), 0),
  }
}

/**
 * Recovery: only what exists. `restingHr` (imported series), the last session's average HR with its source, and the
 * muscle-load estimate is NOT repeated here (that is the Home "Recovery" indicator, labelled as a training-load estimate).
 * WHOOP's recovery is fetched live by the card that shows it; this function never fabricates it.
 */
export function recoveryBlock(S) {
  const rhr = (S.restingHR || []).length ? S.restingHR[S.restingHR.length - 1] : null
  const last = [...(S.workouts || [])].reverse().map(w => ({ w, f: fitnessOf(w) })).find(x => x.f && x.f.avgHr > 0)
  if (!rhr && !last) return null
  return {
    restingHr: rhr ? { bpm: Math.round(rhr.v), d: rhr.d } : null,
    sessionHr: last ? { avg: last.f.avgHr, max: last.f.maxHr || null, d: last.w.d, source: SOURCE_NAME[last.f.source] || last.f.source } : null,
  }
}

/** Composition: current weight, trend over 90 days (only with two readings), a mini series, the member's goal. */
export function compositionBlock(S, range = '3m') {
  const bw = lastBW(S)
  const sum = bw ? metricSummary(S, 'weight', range) : null
  const scan = ['bodyFat', 'muscleMass', 'visceralFat', 'waterPct'].map(k => metricSummary(S, k, 'all')).filter(Boolean)
  if (!bw && !scan.length) return null
  const pts = sum ? sum.points.map(p => p.v) : []
  return {
    weight: bw ? { v: bw.w, d: bw.d } : null,
    delta: sum && sum.delta != null ? sum.delta : null,       // null with a single reading — never a made-up zero
    points: pts.length > 1 ? pts : [],
    goal: S.targetW > 0 && bw ? { target: S.targetW, toGo: Math.round((S.targetW - bw.w) * 10) / 10 } : null,
    scan: scan.map(s => ({ key: s.key, label: s.def.label, unit: s.def.unit, v: s.current.v, d: s.current.d, src: s.current.src || null })),
  }
}

/* ---------------------------------------------------------------- muscle detail (Body Map) --- */

const dayMs = 86400000
const wkRange = (iso, back) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - back * 7); return weekKey(d.toISOString().slice(0, 10)) }

// kg moved by exercises whose MAIN target is this muscle (weight 1) — secondary work is deliberately left out, so the
// number is comparable week to week without pretending to split a lift across muscles.
function primaryVolume(ws, slug, opts) {
  let kg = 0
  ws.forEach(w => (w.entries || []).forEach(e => {
    const m = musclesOf(EXIDX[e.id], opts)
    if (m[slug] !== 1) return
    ;(e.sets || []).forEach(s => { if (s.done && s.type !== 'warmup' && s.w > 0 && s.r > 0) kg += s.w * s.r })
  }))
  return Math.round(kg)
}

/**
 * What the member's own log says about one muscle. `status`:
 *   worked   shaded level ≥ 2 on the map's own relative scale
 *   low      worked, but at the lightest levels
 *   rest     nothing this week, but it has been in a logged session before
 *   nodata   never in a logged session (or nothing logged at all)
 * Comparisons with last week only when both weeks have sets for it (a valid base).
 */
export function muscleDetail(S, slug, iso = todayISO()) {
  const ws = S.workouts || []
  if (!MUSCLES.includes(slug) || !ws.length) return { slug, status: 'nodata' }
  const opts = muscleOptsOf(S)
  const wk = weekKey(iso), prevWk = wkRange(iso, 1)
  const thisWeek = ws.filter(w => weekKey(w.d) === wk)
  const lastWeek = ws.filter(w => weekKey(w.d) === prevWk)
  const loadNow = loadOfWorkouts(thisWeek, null, opts)
  const loadPrev = loadOfWorkouts(lastWeek, null, opts)
  const sets = Math.round((loadNow[slug] || 0) * 10) / 10
  const prevSets = Math.round((loadPrev[slug] || 0) * 10) / 10
  const touching = ws.filter(w => (loadOfWorkouts([w], null, opts)[slug] || 0) > 0)
  const last = touching.length ? touching[touching.length - 1] : null
  const since = new Date(iso + 'T12:00:00').getTime() - 28 * dayMs
  const sessions28 = touching.filter(w => new Date(w.d + 'T12:00:00').getTime() > since).length
  const level = levelsOf(loadNow)[slug]
  const status = !touching.length ? 'nodata' : sets > 0 ? (level >= 2 ? 'worked' : 'low') : 'rest'
  const vol = primaryVolume(thisWeek, slug, opts), prevVol = primaryVolume(lastWeek, slug, opts)
  return {
    slug, status, sets,
    prevSets: prevSets > 0 && sets > 0 ? prevSets : null,
    last: last ? { d: last.d, name: last.name, sets: Math.round((loadOfWorkouts([last], null, opts)[slug] || 0) * 10) / 10 } : null,
    perWeek: sessions28 ? Math.round(sessions28 / 4 * 10) / 10 : null,
    volume: vol > 0 ? vol : null,
    prevVolume: vol > 0 && prevVol > 0 ? prevVol : null,
  }
}

/* ------------------------------------------------------------------- health timeline --- */

/**
 * Non-workout moments worth a line in the timeline, newest first, at most one per kind per day and a handful in total:
 *   weight  a logged change of ≥ 1 kg (or 2 %) against the previous reading, at least a week apart
 *   scan    a body-composition reading (one line per scan day, however many metrics it had)
 */
export function healthMoments(S, { max = 6 } = {}) {
  const out = []
  const bw = orderedBodyWeightSeries(S)
  for (let i = bw.length - 1; i > 0 && out.length < max; i--) {
    const cur = bw[i], prev = bw[i - 1]
    const days = (new Date(cur.d) - new Date(prev.d)) / dayMs
    const diff = cur.w - prev.w
    if (days >= 7 && (Math.abs(diff) >= 1 || (prev.w > 0 && Math.abs(diff) / prev.w >= 0.02))) out.push({ kind: 'weight', d: cur.d, id: 'w:' + cur.d, v: cur.w, delta: Math.round(diff * 10) / 10 })
  }
  const scans = new Map()
  Object.entries(S.measurements || {}).forEach(([key, series]) => {
    if (!['bodyFat', 'muscleMass', 'visceralFat', 'waterPct'].includes(key)) return
    ;(series || []).forEach(p => { const a = scans.get(p.d) || []; a.push(key); scans.set(p.d, a) })
  })
  ;[...scans.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, max).forEach(([d, keys]) => out.push({ kind: 'scan', d, id: 's:' + d, count: keys.length }))
  return out.sort((a, b) => a.d < b.d ? 1 : -1).slice(0, max)
}
