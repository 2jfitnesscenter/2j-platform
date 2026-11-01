// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Energy of one 2J workout, honestly. ACTIVE calories only — never total daily expenditure (no
// basal metabolism is read, written or guessed anywhere). One number per workout, never a sum of
// sources, always labelled with what it is:
//
//   1. measured   — a wearable's own figure for this workout, attached to it (WHOOP, Apple Watch,
//                   Samsung, Garmin… through Health Connect / HealthKit), see lib/fitness.js
//   2. aggregate  — the health store's active-energy total over the workout's interval, when no
//                   session of its own could be matched (HealthKit / Health Connect de-duplicate
//                   their sources; 2J adds nothing on top)
//   3. estimated  — 2J's own rough estimate from duration, type, work density, effort and, when it
//                   exists, heart rate. A range and a rounded number, never presented as measured,
//                   and never written to the health store as if it were.
//
// The model is deliberately plain (MET-based, Compendium of Physical Activities orders of
// magnitude) so its limits are visible: it needs a body weight and a duration, and says nothing
// when either is missing.
import { fitnessSources } from './fitness.js'
import { latestBodyWeight } from './bodyweight.js'
import { ageFrom } from './format.js'

export const ENERGY_KIND = { measured: 'measured', aggregate: 'aggregate', estimated: 'estimated' }
export const ENERGY_SCOPE = 'active'
// Sources whose calories come from a device's own sensors during the session.
const MEASURING_SOURCES = new Set(['healthkit', 'healthconnect', 'apple', 'whoop', 'strava'])
// Each stored figure says what it is: no energyKind = a wearable's own session (measured); 'aggregated' = the store's total
// over the interval; 'estimated' = 2J's estimate that was written to the store (source 'twoj').

const MAX_MIN = 360
const SET_SECONDS = 40          // time under tension + handling of one working set
const REST_MET = 1.5            // standing/walking between sets
const round5 = n => Math.round(n / 5) * 5

// Work intensity (MET while a set or an interval is actually being done).
const MET_WORK = { strengthHard: 6.0, strengthMod: 5.0, strengthEasy: 3.5, hiit: 8.0, interval: 7.0, circuit: 6.0, mobility: 2.5 }

/** The dominant guided block type of a session, if it had guided blocks. */
function guidedKind(w) {
  const g = Array.isArray(w?.guided) ? w.guided : []
  const count = {}
  for (const b of g) {
    const type = String(b?.type || '').toLowerCase()
    const kind = /hiit|tabata/.test(type) ? 'hiit' : /interval/.test(type) ? 'interval' : /circuit/.test(type) ? 'circuit' : /mobility|stretch/.test(type) ? 'mobility' : null
    if (kind) count[kind] = (count[kind] || 0) + (Number(b.bouts) || 1)
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null
}

const doneSets = w => (w?.entries || []).flatMap(e => (e.sets || []).filter(s => s.done && s.type !== 'warmup'))

/** Mean RPE of the working sets that recorded one (RIR sessions: null — not guessed). */
function meanRpe(sets) {
  const v = sets.map(s => s.rpe).filter(x => x > 0 && x <= 10)
  return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null
}

const weightKg = S => {
  const w = Number(latestBodyWeight(S)?.w)
  if (!(w > 0)) return null
  return S?.unit === 'lb' ? w * 0.45359237 : w
}

/** The workout's own record of a device-measured calorie figure (the primary source, never summed). */
function measuredRecord(w) {
  return fitnessSources(w).find(r => MEASURING_SOURCES.has(r.source) && r.calories > 0 && !r.energyKind) || null
}
const recordOfKind = (w, kind) => fitnessSources(w).find(r => r.energyKind === kind && r.calories > 0) || null

/**
 * Heart-rate based estimate (Keytel et al. 2005): gross kcal/min from average HR, weight, age, sex;
 * the resting share is removed so the result is ACTIVE energy. Needs all four inputs.
 */
function fromHeartRate({ avgHr, kg, age, male, minutes }) {
  if (!(avgHr > 40) || !(kg > 0) || !(age > 0) || !(minutes > 0)) return null
  const perMin = male
    ? (-55.0969 + 0.6309 * avgHr + 0.1988 * kg + 0.2017 * age) / 4.184
    : (-20.4022 + 0.4472 * avgHr - 0.1263 * kg + 0.074 * age) / 4.184
  const gross = perMin * minutes
  const resting = kg * (minutes / 60)         // 1 MET ≈ 1 kcal/kg/h
  const active = gross - resting
  return active > 0 ? active : null
}

/** 2J's own estimate: { kcal, low, high, basis } or null when weight or duration is missing. */
export function estimateWorkoutEnergy(w, S) {
  const kg = weightKg(S)
  const ms = Number(w?.end) - Number(w?.start)
  if (!(kg > 0) || !(ms > 60e3)) return null
  const minutes = Math.min(MAX_MIN, ms / 60e3)
  const sets = doneSets(w)
  const kind = guidedKind(w)
  const hrRec = fitnessSources(w).find(r => r.avgHr > 0)
  const hr = fromHeartRate({ avgHr: hrRec?.avgHr, kg, age: ageFrom(S?.birthDate), male: S?.body !== 'female', minutes })
  let active, basis
  if (hr) { active = hr; basis = 'heart-rate' }
  else {
    let work, density = 1
    if (kind) { work = MET_WORK[kind]; basis = 'guided-' + kind }
    else {
      if (!sets.length) return null
      const rpe = meanRpe(sets)
      work = rpe == null ? MET_WORK.strengthMod : rpe >= 8 ? MET_WORK.strengthHard : rpe >= 6.5 ? MET_WORK.strengthMod : MET_WORK.strengthEasy
      density = Math.min(1, Math.max(0.2, (sets.length * SET_SECONDS) / (minutes * 60)))
      basis = rpe == null ? 'strength' : 'strength-effort'
    }
    const metAvg = density * work + (1 - density) * REST_MET
    active = Math.max(0, (metAvg - 1) * kg * (minutes / 60))
  }
  if (!(active > 0)) return null
  const kcal = round5(active)
  return { kcal, low: round5(active * 0.7), high: round5(active * 1.3), basis }
}

/**
 * The energy of a workout by source priority. `aggregate` is the health store's active-energy total
 * over the workout's interval ({ activeCaloriesKcal }), read by the caller only with permission.
 * Returns { kcal, kind, scope:'active', source?, basis?, low?, high? } or null. Never a sum.
 */
export function workoutEnergy(w, S, { aggregate = null } = {}) {
  const m = measuredRecord(w)
  if (m) return { kcal: Math.round(m.calories), kind: ENERGY_KIND.measured, scope: ENERGY_SCOPE, source: m.source, origin: m.origin || null }
  const stored = recordOfKind(w, 'aggregated')
  if (stored) return { kcal: Math.round(stored.calories), kind: ENERGY_KIND.aggregate, scope: ENERGY_SCOPE, source: stored.source, origin: stored.origin || null }
  const a = Number(aggregate?.activeCaloriesKcal)
  if (a > 0 && a <= 20000) return { kcal: Math.round(a), kind: ENERGY_KIND.aggregate, scope: ENERGY_SCOPE, source: aggregate?.source || 'health' }
  const written = recordOfKind(w, 'estimated')        // the estimate 2J wrote to the store: the same number, still labelled as one
  if (written) return { kcal: Math.round(written.calories), kind: ENERGY_KIND.estimated, scope: ENERGY_SCOPE, source: 'twoj', basis: 'written' }
  const e = estimateWorkoutEnergy(w, S)
  return e ? { ...e, kind: ENERGY_KIND.estimated, scope: ENERGY_SCOPE } : null
}
