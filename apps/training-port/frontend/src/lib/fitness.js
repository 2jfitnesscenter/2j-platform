// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fitness data attached to a 2J workout — calories, heart rate and zones that came from
// somewhere OTHER than the strength log itself (a wearable's hub, WHOOP, an Apple Health export,
// a Bluetooth chest strap). The workout keeps being the one record of what was trained; this is
// a small, extensible side note on it:
//
//   w.fitness = { primary: Rec, others: [Rec] }      (others: the same session seen by another
//                                                     source — kept for reference, never summed)
//   Rec = { source, origin?, externalId?, start, end, calories?, avgHr?, maxHr?,
//           zones?: { mins: [..], scheme: 'source' | 'hrmax', derived, hrMax?, hrMaxKind? }, kind, importedAt }
//
// Zone provenance is always one of three, and the UI says which (components/FitnessSummary.jsx):
//   scheme 'source'                         → the source's own zones (WHOOP 0-5), untouched
//   derived + hrMaxKind 'declared'          → 2J from samples, against the max HR the member set
//   derived + hrMaxKind 'calculated'        → 2J from samples, against the 220 − age ESTIMATE
// `maxHr` on a record is the highest reading of THAT session, never the member's max HR.
//
// `kind` says what the numbers are: 'imported' (a third party's own figures), 'measured' (read
// live from a sensor by 2J) — and zones carry `derived: true` whenever 2J computed them from
// heart-rate samples rather than receiving them. Older workouts may carry `w.hrZones` (the Apple
// Health import's own HR-sample summary); fitnessOf reads it too, so nothing is migrated.

export const SOURCE_NAME = {
  healthconnect: 'Health Connect', healthkit: 'Apple Health', apple: 'Apple Health', whoop: 'WHOOP',
  ble: 'Bluetooth sensor', strava: 'Strava', twoj: '2J estimate',
}
// Which source leads when several saw the same session. The phone's health hub is the most
// direct record of what the watch measured; a Bluetooth strap read live by 2J next; the rest
// are other apps' copies. Calories/HR are never added up across sources.
const PRIORITY = { healthkit: 1, healthconnect: 1, apple: 2, ble: 3, whoop: 4, strava: 5, twoj: 11 }
// A store-wide total over the workout's interval (energyKind 'aggregated') never outranks a record of the session itself.
const prio = r => (PRIORITY[r.source] || 9) + (r.energyKind === 'aggregated' ? 0.5 : 0)

// Known Health Connect data origins (package names) → a readable app name. Unknown packages are
// shown as their package name, never guessed.
export const ORIGIN_APP = {
  'com.huami.watch.hmwatchmanager': 'Zepp', 'com.sec.android.app.shealth': 'Samsung Health',
  'com.fitbit.FitbitMobile': 'Fitbit', 'com.google.android.apps.fitness': 'Google Fit',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect', 'com.strava': 'Strava', 'com.whoop.android': 'WHOOP',
}

/* ------------------------------------------------------------------ reading --- */

export function fitnessOf(w) {
  if (w?.fitness?.primary) return w.fitness.primary
  if (w?.hrZones) {
    // Legacy: the Apple Health import's summary of the watch's HR samples during this workout.
    return { source: 'apple', kind: 'imported', avgHr: w.hrZones.avg, maxHr: w.hrZones.max,
      zones: w.hrZones.z ? { mins: w.hrZones.z, scheme: 'hrmax', derived: true, hrMax: w.hrZones.hrMax ?? null,
        // Imports before Health V2 always split against 220 − age (there was no declared value).
        hrMaxKind: w.hrZones.hrMaxKind || 'calculated' } : null }
  }
  return null
}
export const fitnessSources = w => w?.fitness ? [w.fitness.primary, ...(w.fitness.others || [])].filter(Boolean) : []

/* ------------------------------------------------------------ heart-rate zones --- */

// Five bands of max heart rate — 50-60, 60-70, 70-80, 80-90, 90-100 % — the same cut points the
// Apple Health import has always used (lib/import-csv.js).
export const zoneCuts = maxHr => maxHr > 0 ? [0.5, 0.6, 0.7, 0.8, 0.9, 1].map(p => p * maxHr) : null
export const bandFor = (bpm, cuts) => bpm < cuts[1] ? 0 : bpm < cuts[2] ? 1 : bpm < cuts[3] ? 2 : bpm < cuts[4] ? 3 : 4

// The max HR zones are computed against: the member's own value if they set one (declared),
// otherwise the classic 220 − age estimate (calculated) — labelled as such wherever it shows.
export function maxHrFor(S, ageOf) {
  if (S?.hrMax > 0) return { value: S.hrMax, kind: 'declared' }
  const age = ageOf ? ageOf(S?.birthDate) : null
  return age > 0 ? { value: 220 - age, kind: 'calculated' } : null
}

/**
 * Samples [{t, v}] → { avgHr, maxHr, zones } — each reading describes the interval until the
 * next one, capped at 5 minutes so a real gap (strap off, watch off the wrist) never counts as
 * a continuous zone. Same rule the Apple Health import uses.
 */
const GAP_CAP_MS = 5 * 60000
// `maxHr` is maxHrFor()'s { value, kind } (preferred, so zones record their basis) or a number.
const hrRef = m => m && typeof m === 'object' ? (m.value > 0 ? m : null) : (m > 0 ? { value: m, kind: null } : null)
const zonesOf = (ref, zMs) => ({ mins: zMs.map(ms => Math.round(ms / 60000)), scheme: 'hrmax', derived: true, hrMax: ref.value, hrMaxKind: ref.kind })
export function summarizeHr(samples, maxHr) {
  const ref = hrRef(maxHr)
  const arr = [...(samples || [])].filter(s => s.v > 0).sort((a, b) => a.t - b.t)
  if (!arr.length) return null
  const cuts = ref && zoneCuts(ref.value)
  let sum = 0, max = 0
  const zMs = [0, 0, 0, 0, 0]
  arr.forEach(({ t, v }, i) => {
    sum += v; if (v > max) max = v
    if (i === arr.length - 1 || !cuts) return
    const gap = Math.min(arr[i + 1].t - t, GAP_CAP_MS)
    if (gap > 0) zMs[bandFor(v, cuts)] += gap
  })
  return {
    avgHr: Math.round(sum / arr.length), maxHr: Math.round(max),
    zones: cuts ? zonesOf(ref, zMs) : null,
  }
}

// A running summary for a live sensor: constant memory however long the session — no stream is
// ever kept (see lib/ble-hr.js). `add(bpm, t)` per reading, `result()` at the end.
export function hrAccumulator(maxHr) {
  const ref = hrRef(maxHr)
  const cuts = ref && zoneCuts(ref.value)
  let n = 0, sum = 0, max = 0, last = null
  const zMs = [0, 0, 0, 0, 0]
  return {
    add(v, t = Date.now()) {
      if (!(v > 0)) return
      if (last && cuts) { const gap = Math.min(t - last.t, GAP_CAP_MS); if (gap > 0) zMs[bandFor(last.v, cuts)] += gap }
      n++; sum += v; if (v > max) max = v
      last = { v, t }
    },
    result() {
      if (!n) return null
      return { avgHr: Math.round(sum / n), maxHr: Math.round(max), samples: n,
        zones: cuts ? zonesOf(ref, zMs) : null }
    },
    get count() { return n },
  }
}

/* ------------------------------------------------------------------ mappers --- */

const kjToKcal = kj => kj > 0 ? Math.round(kj / 4.184) : null
const iso = v => v == null ? null : (typeof v === 'number' ? v : Date.parse(v))

// WHOOP v2 workout (GET /v2/activity/workout). Its zones are WHOOP's own (zone 0-5, heart-rate
// reserve based), kept as the source gave them — never re-cut against 2J's max-HR bands.
export function mapWhoopWorkout(r, importedAt = Date.now()) {
  if (!r || r.score_state !== 'SCORED' || !r.start || !r.end) return null
  const s = r.score || {}
  const zd = s.zone_durations || {}
  const keys = ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli']
  const hasZones = keys.some(k => zd[k] > 0)
  return {
    source: 'whoop', origin: r.sport_name || null, externalId: String(r.id), kind: 'imported',
    start: iso(r.start), end: iso(r.end),
    calories: kjToKcal(s.kilojoule), avgHr: s.average_heart_rate || null, maxHr: s.max_heart_rate || null,
    strain: s.strain ?? null,
    zones: hasZones ? { mins: keys.map(k => Math.round((zd[k] || 0) / 60000)), scheme: 'source', derived: false } : null,
    importedAt,
  }
}

// One <Workout> of an Apple Health export (parsed by lib/import-csv.js's parseAppleHealth).
export function mapAppleWorkout(x, importedAt = Date.now()) {
  if (!x || !(x.start > 0) || !(x.end > x.start)) return null
  return {
    source: 'apple', origin: x.sourceName || null, activity: x.activityType || null,
    externalId: `${x.start}-${x.end}-${x.sourceName || ''}`, kind: 'imported',
    start: x.start, end: x.end, calories: x.kcal > 0 ? Math.round(x.kcal) : null,
    avgHr: x.avgHr > 0 ? Math.round(x.avgHr) : null, maxHr: x.maxHr > 0 ? Math.round(x.maxHr) : null,
    zones: null, importedAt,
  }
}

/* -------- contracts for a future native bridge (docs/HEALTH_NATIVE_BRIDGE.md) — the JS side
   of what an Android (Health Connect) or iOS (HealthKit) shell would hand to the web app. ---- */

// Health Connect: ExerciseSessionRecord + aggregates the shell computed for its time window.
export function mapHealthConnectSession(x, importedAt = Date.now()) {
  if (!x?.startTime || !x?.endTime) return null
  const pkg = x.metadata?.dataOrigin?.packageName || null
  const a = x.aggregates || {}
  const kcal = a.activeCaloriesKcal ?? a.totalCaloriesKcal ?? null
  return {
    source: 'healthconnect', origin: pkg ? (ORIGIN_APP[pkg] || pkg) : null, originPackage: pkg,
    externalId: x.metadata?.id || null, kind: 'imported', activity: x.exerciseType ?? null,
    start: iso(x.startTime), end: iso(x.endTime),
    calories: kcal > 0 ? Math.round(kcal) : null, caloriesKind: a.activeCaloriesKcal != null ? 'active' : a.totalCaloriesKcal != null ? 'total' : null,
    avgHr: a.hrAvg > 0 ? Math.round(a.hrAvg) : null, maxHr: a.hrMax > 0 ? Math.round(a.hrMax) : null,
    zones: null, importedAt,
  }
}
// HealthKit: HKWorkout + its statistics, as the iOS shell reports them.
export function mapHealthKitWorkout(x, importedAt = Date.now()) {
  if (!x?.startDate || !x?.endDate) return null
  const src = x.sourceRevision?.source || {}
  return {
    source: 'healthkit', origin: src.name || null, originBundle: src.bundleIdentifier || null,
    externalId: x.uuid || null, kind: 'imported', activity: x.workoutActivityType ?? null,
    start: iso(x.startDate), end: iso(x.endDate),
    calories: x.activeEnergyKcal > 0 ? Math.round(x.activeEnergyKcal) : null, caloriesKind: 'active',
    avgHr: x.hrAvg > 0 ? Math.round(x.hrAvg) : null, maxHr: x.hrMax > 0 ? Math.round(x.hrMax) : null,
    zones: null, importedAt,
  }
}

/* ----------------------------------------------------------------- matching --- */

/**
 * Which 2J workout an external activity belongs to — conservative on purpose:
 *   · a candidate must overlap the workout for at least half of the shorter of the two;
 *   · 'match' only when there is exactly one candidate AND the overlap covers ≥ 70 % of the
 *     longer one (18:03-19:08 vs 18:01-19:10 → match);
 *   · anything else with candidates is 'ambiguous' (the member chooses), none is 'none';
 *   · an activity already attached somewhere is 'linked' and never attached twice.
 */
export function matchActivity(workouts, rec) {
  const linked = (workouts || []).find(w => fitnessSources(w).some(r => r.source === rec.source && r.externalId && r.externalId === rec.externalId))
  if (linked) return { status: 'linked', workoutId: linked.id }
  const aDur = rec.end - rec.start
  if (!(aDur > 0)) return { status: 'none', candidates: [] }
  const candidates = (workouts || []).filter(w => w.start > 0 && w.end > w.start).map(w => {
    const overlap = Math.min(w.end, rec.end) - Math.max(w.start, rec.start)
    const wDur = w.end - w.start
    return { id: w.id, overlap, ofShorter: overlap / Math.min(wDur, aDur), ofLonger: overlap / Math.max(wDur, aDur) }
  }).filter(c => c.overlap > 0 && c.ofShorter >= 0.5).sort((a, b) => b.ofLonger - a.ofLonger)
  if (!candidates.length) return { status: 'none', candidates: [] }
  if (candidates.length === 1 && candidates[0].ofLonger >= 0.7) return { status: 'match', workoutId: candidates[0].id, candidates }
  return { status: 'ambiguous', candidates }
}

export function matchAll(workouts, recs) {
  const out = { match: [], ambiguous: [], none: [], linked: [] }
  recs.filter(Boolean).forEach(rec => {
    const m = matchActivity(workouts, rec)
    out[m.status].push({ rec, ...m })
  })
  return out
}

/* --------------------------------------------------------- attach / detach --- */

// Attach a record to a workout (mutates the workout inside an update()). Idempotent: the same
// source + externalId replaces itself; a different source joins `others`. The primary is always
// the highest-priority source present; numbers are never summed across sources.
export function attachFitness(w, rec) {
  const list = fitnessSources(w).filter(r => !(r.source === rec.source && (r.externalId || null) === (rec.externalId || null)))
  list.push(rec)
  list.sort((a, b) => prio(a) - prio(b))
  w.fitness = { primary: list[0], others: list.slice(1, 4) }
  return w
}
export function detachFitness(w, source, externalId = null) {
  const list = fitnessSources(w).filter(r => !(r.source === source && (r.externalId || null) === (externalId || null)))
  if (list.length) w.fitness = { primary: list[0], others: list.slice(1) }
  else delete w.fitness
  return w
}
