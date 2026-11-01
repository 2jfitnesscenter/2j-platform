// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
import { orderedBodyWeightSeries } from './bodyweight.js'
// SPDX-License-Identifier: AGPL-3.0-or-later
// Body measurements & composition — a generalised version of the bodyweight time series
// (S.bodyweight) that already existed: S.measurements[key] is the same {d, v, t} shape, just
// keyed by which measurement it is instead of there being exactly one. Two real workflows drive
// this: a member logging their own tape-measure numbers whenever, and a gym admin entering a
// full body assessment (bioimpedance scan + skinfold calipers) from one staff-run session — see
// sheets.jsx's measurementSheet and Admin.jsx's BioimpedanceSheet (which covers both the
// 'composition' and 'folds' groups, since they're typically taken in the same sitting).
export const GROUPS = ['body', 'composition', 'segments', 'folds']

// Icon + tint follow the measurement technique, not the individual spot: every tape-measure
// circumference shares one icon/colour (they're all "wrap a tape around it"), same for the four
// caliper skinfolds — only the five bioimpedance readings are visually distinct enough from each
// other to earn their own icon.
const TAPE = { icon: 'expand', iconTint: 'var(--mint)' }
const CALIPER = { icon: 'caliper', iconTint: 'var(--teal)' }
// Same reasoning for the 10 segmental readings: they're the same scan as `composition`, just
// broken down per limb/trunk, so they split into exactly two icons — fat vs muscle — matching
// bodyFat's and muscleMass's own icon/tint rather than getting 10 distinct ones.
const SEG_FAT = { icon: 'flame', iconTint: 'var(--orange)' }
const SEG_MUSCLE = { icon: 'figureStrength', iconTint: 'var(--indigo)' }

export const MEASUREMENTS = [
  // ---- circumference, cm — a member's own tape measure ----
  { key: 'neck', label: 'Neck', group: 'body', unit: 'cm', min: 20, max: 60, step: 0.5, dec: true, ...TAPE },
  { key: 'shoulders', label: 'Shoulders', group: 'body', unit: 'cm', min: 70, max: 170, step: 0.5, dec: true, ...TAPE },
  { key: 'chest', label: 'Chest', group: 'body', unit: 'cm', min: 60, max: 170, step: 0.5, dec: true, ...TAPE },
  { key: 'bicepsL', label: 'Left biceps', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true, ...TAPE },
  { key: 'bicepsR', label: 'Right biceps', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true, ...TAPE },
  { key: 'forearmL', label: 'Left forearm', group: 'body', unit: 'cm', min: 15, max: 50, step: 0.5, dec: true, ...TAPE },
  { key: 'forearmR', label: 'Right forearm', group: 'body', unit: 'cm', min: 15, max: 50, step: 0.5, dec: true, ...TAPE },
  { key: 'waist', label: 'Waist', group: 'body', unit: 'cm', min: 40, max: 160, step: 0.5, dec: true, ...TAPE },
  { key: 'hips', label: 'Hips', group: 'body', unit: 'cm', min: 50, max: 170, step: 0.5, dec: true, ...TAPE },
  { key: 'thighL', label: 'Left thigh', group: 'body', unit: 'cm', min: 25, max: 100, step: 0.5, dec: true, ...TAPE },
  { key: 'thighR', label: 'Right thigh', group: 'body', unit: 'cm', min: 25, max: 100, step: 0.5, dec: true, ...TAPE },
  { key: 'calfL', label: 'Left calf', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true, ...TAPE },
  { key: 'calfR', label: 'Right calf', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true, ...TAPE },
  // ---- body composition — a bioimpedance scan (e.g. this gym's Tanita) ----
  // `altUnit`: the other unit this reading can be entered/shown in, converted against total
  // bodyweight (see pctOfWeight/kgOfWeight below) — the member-facing "Scan report" sheet and
  // Admin's staff version both use this to offer the %/kg toggle. Absent = only ever the one
  // unit; see segFat* below for why that's deliberate there, not an oversight.
  { key: 'bodyFat', label: 'Body fat', group: 'composition', unit: '%', altUnit: 'kg', min: 2, max: 55, step: 0.1, dec: true, icon: 'flame', iconTint: 'var(--orange)' },
  { key: 'muscleMass', label: 'Muscle mass', group: 'composition', unit: 'kg', altUnit: '%', min: 10, max: 70, step: 0.1, dec: true, icon: 'figureStrength', iconTint: 'var(--indigo)' },
  { key: 'waterPct', label: 'Body water', group: 'composition', unit: '%', min: 25, max: 75, step: 0.1, dec: true, icon: 'drop', iconTint: 'var(--blue)' },
  { key: 'visceralFat', label: 'Visceral fat', group: 'composition', unit: '', min: 1, max: 59, step: 1, dec: false, icon: 'target', iconTint: 'var(--purple)' },
  { key: 'boneMass', label: 'Bone mass', group: 'composition', unit: 'kg', min: 0.5, max: 6, step: 0.1, dec: true, icon: 'bone', iconTint: 'var(--grey)' },
  // ---- segmental composition — the same bioimpedance scan, broken down per body part.
  // Fat stays a percentage ONLY — no altUnit, deliberately: it's the reading's ratio against
  // its own segment's standard reference range, same as the scan report itself prints it (e.g.
  // "116.2%" for a trunk reading against a 90-110% standard band) — not a share of the limb's
  // own weight. There is no meaningful kg to convert it to: the scan does not (and physically
  // cannot, from a wrist-to-wrist/foot-to-foot BIA reading) isolate "kg of fat in this one limb"
  // the way it can for muscle. Offering a kg toggle here would invent a number, not convert one.
  // Muscle is the segment's muscle mass in kg instead (the report prints both a kg figure and
  // the same kind of ratio %, and kg is the one that's directly useful — comparable side to
  // side, and addable up toward the whole-body muscleMass above) — its altUnit '%' is that
  // segment's muscle as a share of TOTAL bodyweight (not of the segment's own estimated weight,
  // which would need a biomechanical segment-mass table this app has no other use for).
  { key: 'segFatArmL', label: 'Left arm fat', group: 'segments', unit: '%', min: 0, max: 250, step: 0.1, dec: true, ...SEG_FAT },
  { key: 'segFatArmR', label: 'Right arm fat', group: 'segments', unit: '%', min: 0, max: 250, step: 0.1, dec: true, ...SEG_FAT },
  { key: 'segFatLegL', label: 'Left leg fat', group: 'segments', unit: '%', min: 0, max: 250, step: 0.1, dec: true, ...SEG_FAT },
  { key: 'segFatLegR', label: 'Right leg fat', group: 'segments', unit: '%', min: 0, max: 250, step: 0.1, dec: true, ...SEG_FAT },
  { key: 'segFatTrunk', label: 'Trunk fat', group: 'segments', unit: '%', min: 0, max: 250, step: 0.1, dec: true, ...SEG_FAT },
  { key: 'segMuscleArmL', label: 'Left arm muscle', group: 'segments', unit: 'kg', altUnit: '%', min: 0.5, max: 15, step: 0.1, dec: true, ...SEG_MUSCLE },
  { key: 'segMuscleArmR', label: 'Right arm muscle', group: 'segments', unit: 'kg', altUnit: '%', min: 0.5, max: 15, step: 0.1, dec: true, ...SEG_MUSCLE },
  { key: 'segMuscleLegL', label: 'Left leg muscle', group: 'segments', unit: 'kg', altUnit: '%', min: 1, max: 25, step: 0.1, dec: true, ...SEG_MUSCLE },
  { key: 'segMuscleLegR', label: 'Right leg muscle', group: 'segments', unit: 'kg', altUnit: '%', min: 1, max: 25, step: 0.1, dec: true, ...SEG_MUSCLE },
  { key: 'segMuscleTrunk', label: 'Trunk muscle', group: 'segments', unit: 'kg', altUnit: '%', min: 5, max: 50, step: 0.1, dec: true, ...SEG_MUSCLE },
  // ---- skinfolds, mm — calipers (a staff assessment, taken alongside the bioimpedance scan) ----
  { key: 'skinTriceps', label: 'Triceps skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true, ...CALIPER },
  { key: 'skinSubscapular', label: 'Subscapular skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true, ...CALIPER },
  { key: 'skinSuprailiac', label: 'Suprailiac skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true, ...CALIPER },
  { key: 'skinAbdominal', label: 'Abdominal skinfold', group: 'folds', unit: 'mm', min: 2, max: 50, step: 0.5, dec: true, ...CALIPER }
]
export const MEASUREMENT = Object.fromEntries(MEASUREMENTS.map(m => [m.key, m]))

// Which section-level %/kg toggle (Settings → the "Grasa"/"Masa Muscular" header switch,
// S.measurementUnitMode) a given key answers to — the fat keys that have no altUnit
// (segFat*) still belong to the 'fat' group for layout purposes (they sit under the same
// section header), they just never actually change unit when the switch is flipped.
export const UNIT_TOGGLE_METRIC = {
  bodyFat: 'fat', segFatArmL: 'fat', segFatArmR: 'fat', segFatLegL: 'fat', segFatLegR: 'fat', segFatTrunk: 'fat',
  muscleMass: 'muscle', segMuscleArmL: 'muscle', segMuscleArmR: 'muscle', segMuscleLegL: 'muscle', segMuscleLegR: 'muscle', segMuscleTrunk: 'muscle',
}

// The one relationship every altUnit conversion in this app runs on — always against TOTAL
// bodyweight, never an estimated segment weight (see the segMuscle* comment above for why —
// there's no biomechanical segment-mass table anywhere else in this app to make that
// meaningful). Symmetric on purpose: converting % -> kg and kg -> % are the same fraction,
// just which side you already have.
const pctToKg = (pct, bwKg) => bwKg * pct / 100
const kgToPct = (kg, bwKg) => kg / bwKg * 100

/**
 * A measurement's stored (canonical-unit) value, converted into its altUnit for a live "≈
 * 12.4 kg" suggestion next to the input — null when there's nothing sensible to show (no
 * altUnit at all, nothing typed yet, or no bodyweight on file to convert against).
 */
export function altValueOf(m, canonicalValue, bodyweightKg) {
  if (!m.altUnit || !(bodyweightKg > 0)) return null
  const v = Number(canonicalValue)
  if (!Number.isFinite(v)) return null
  const alt = m.unit === '%' ? pctToKg(v, bodyweightKg) : kgToPct(v, bodyweightKg)
  return Math.round(alt * 10) / 10
}
/** The reverse — what to actually store when the member typed a value in the altUnit
 *  (Settings → the section's %/kg toggle set to "alt"). Same caller contract as altValueOf. */
export function canonicalFromAlt(m, altValue, bodyweightKg) {
  if (!m.altUnit || !(bodyweightKg > 0)) return null
  const v = Number(altValue)
  if (!Number.isFinite(v)) return null
  const canon = m.unit === '%' ? kgToPct(v, bodyweightKg) : pctToKg(v, bodyweightKg)
  return Math.round(canon * 10) / 10
}

/** Most recent entry for one measurement, or null. */
export const lastMeasurement = (S, key) => {
  const list = S.measurements?.[key]
  return list && list.length ? list[list.length - 1] : null
}

/**
 * The bodyweight to convert a measurement dated `iso` against — the closest entry on or
 * before that date, or (for a reading older than the first weigh-in on file) the earliest one
 * available. Charting a whole history of %/kg-converted points against *today's* weight would
 * quietly misconvert every older point once someone's weight has moved much at all, so the
 * evolution chart and the segment diagram both read a point's own converted value through
 * this rather than always reaching for lastBW.
 */
export function bodyweightNear(S, iso) {
  const list = orderedBodyWeightSeries(S)
  if (!list.length) return null
  let best = null
  for (const b of list) {
    if (b.d <= iso) best = b
    else { if (!best) best = b; break }
  }
  return best ? best.w : null
}

/** Whether there's anything at all to show on the body-composition diagram (Home gates on this
 *  — no point offering an all-dashes figure on a screen meant for a daily glance, unlike
 *  Measurements' own copy, which stays up as an invitation to scan a report). */
export const hasBodyComposition = S =>
  MEASUREMENTS.some(m => (m.group === 'composition' || m.group === 'segments') && lastMeasurement(S, m.key))

/** Most recent date (ISO) any bioimpedance-scan reading (the 'composition' or 'segments'
 *  groups — a tape measurement or a caliper skinfold isn't a scan) was logged, or null if
 *  none yet. Derived from S.measurements rather than a separately-stored field, so there is
 *  nothing to keep in sync when a reading is added, edited or removed, or when a backup is
 *  imported — the Home reminder banner's "how long since your last scan" clock. */
export function lastBioimpedanceDate(S) {
  let latest = null
  MEASUREMENTS.forEach(m => {
    if (m.group !== 'composition' && m.group !== 'segments') return
    const last = lastMeasurement(S, m.key)
    if (last && (!latest || last.d > latest)) latest = last.d
  })
  return latest
}

/** Whole days since the most recent bioimpedance scan, or null if none has ever been logged
 *  (a profile with nothing on file yet isn't "overdue" — that's a first-scan nudge, a
 *  different concern from this reminder). */
export function daysSinceBioimpedance(S) {
  const d = lastBioimpedanceDate(S)
  if (!d) return null
  return Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)
}

// Healthy body-fat-% bands by sex and age — Gallagher et al. 2000 (Am J Clin Nutr 72:694-701),
// the age/sex-adjusted "healthy range" most fitness and clinical tools use instead of one flat
// cutoff for everybody. `obese` is that study's high-risk threshold; anything below the healthy
// band ("underfat") gets the same caution colour as anything above it but under `obese` — neither
// is the danger zone the way crossing `obese` is.
const BODY_FAT_BANDS = {
  male: [
    { maxAge: 39, lo: 8, hi: 19, obese: 25 },
    { maxAge: 59, lo: 11, hi: 21, obese: 28 },
    { maxAge: Infinity, lo: 13, hi: 24, obese: 30 }
  ],
  female: [
    { maxAge: 39, lo: 21, hi: 32, obese: 39 },
    { maxAge: 59, lo: 23, hi: 33, obese: 40 },
    { maxAge: Infinity, lo: 24, hi: 35, obese: 42 }
  ]
}

/** 'good' | 'warn' | 'bad', or null when sex/age aren't known well enough to classify. */
export function bodyFatBand(pct, sex, age) {
  if (!Number.isFinite(pct) || !Number.isFinite(age)) return null
  const table = BODY_FAT_BANDS[sex === 'female' ? 'female' : 'male']
  const band = table.find(b => age <= b.maxAge)
  if (pct >= band.obese) return 'bad'
  if (pct < band.lo || pct > band.hi) return 'warn'
  return 'good'
}

// Tanita's own visceral-fat rating (the scale this gym's scan actually reports, 1-59, same for
// everyone — it isn't split by sex or age the way body fat is): 1-12 is "healthy", 13-59 is
// "excessive". Tanita doesn't subdivide "excessive" any further, but a flat orange-to-25-red
// jump reads as one big warning band rather than a gradient, so the split at 15 follows the
// same intermediate cutoff several secondary sources use for this same 1-59 scale.
export function visceralFatBand(v) {
  if (!Number.isFinite(v)) return null
  if (v >= 15) return 'bad'
  if (v >= 13) return 'warn'
  return 'good'
}
