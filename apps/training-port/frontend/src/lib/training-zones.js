// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { bestKnownOneRM } from './onerm.js'
import { rirOf } from './effort.js'

// Training Zones — classifies a set's intensity into one of the 5 standard strength &
// conditioning zones, from %1RM (against lib/onerm.js's bestKnownOneRM) or, when no 1RM
// estimate exists yet for that exercise, from the set's own logged RIR/RPE. No TypeScript in
// this project (plain .js/.jsx throughout, no tsconfig) — documented the same way every other
// lib/*.js module documents its shapes, not a .ts file.
//
// Zone shape:
//   id            — 1-5, low to high intensity
//   key           — stable string id ('z1'..'z5')
//   short         — the chip label ("Z3")
//   label         — the i18n'd name shown next to `short`
//   color         — a CSS var, reusing the app's existing named tokens rather than new hex
//   pctMin/pctMax — %1RM band (pctMax is exclusive except for Z5, which has no ceiling)
//   rirMax        — RIR fallback boundary (used top-down: the first zone whose rirMax the set's
//                   RIR is at or under, hardest first — see zoneForRir)
//   reps          — the rep range this zone is conventionally trained in, for display only
//   pctLabel/rirLabel — friendly range strings for the two boundaries above, display only
//                   (Settings' trainingZonesHelpSheet is the one place that reads these)
export const ZONES = [
  { id: 1, key: 'z1', short: 'Z1', label: 'Recovery', color: 'var(--teal)', pctMin: 0, pctMax: 60, rirMax: Infinity, reps: '15+', pctLabel: '< 60%', rirLabel: '> 5' },
  { id: 2, key: 'z2', short: 'Z2', label: 'Muscular endurance', color: 'var(--green)', pctMin: 60, pctMax: 70, rirMax: 5, reps: '12-20+', pctLabel: '60-70%', rirLabel: '4-5' },
  { id: 3, key: 'z3', short: 'Z3', label: 'Hypertrophy', color: 'var(--yellow)', pctMin: 70, pctMax: 80, rirMax: 3, reps: '8-12', pctLabel: '70-80%', rirLabel: '2-3' },
  { id: 4, key: 'z4', short: 'Z4', label: 'Strength', color: 'var(--orange)', pctMin: 80, pctMax: 90, rirMax: 2, reps: '4-6', pctLabel: '80-90%', rirLabel: '1-2' },
  { id: 5, key: 'z5', short: 'Z5', label: 'Max strength', color: 'var(--red)', pctMin: 90, pctMax: Infinity, rirMax: 0, reps: '1-3', pctLabel: '> 90%', rirLabel: '0' },
]
export const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]))

/** The zone whose %1RM band contains `pct` (0-100+). Null for a null/undefined input. */
export function zoneForPct(pct) {
  if (pct == null || !isFinite(pct)) return null
  for (let i = ZONES.length - 1; i >= 0; i--) if (pct >= ZONES[i].pctMin) return ZONES[i]
  return ZONES[0]
}

/** The zone for a logged RIR (0 = failure), hardest zone first — RIR 2 sits in both Z3 and Z4's
 * bands in the brief's own numbers, resolved here in favour of the harder read. Null for null. */
export function zoneForRir(rir) {
  if (rir == null || !isFinite(rir)) return null
  const r = Math.max(0, rir)
  for (let i = ZONES.length - 1; i >= 0; i--) if (r <= ZONES[i].rirMax) return ZONES[i]
  return ZONES[0]
}

/**
 * Classifies one logged or planned set. Prefers %1RM (weight against this exercise's current
 * best known 1RM — lib/onerm.js's bestKnownOneRM, workout-derived or a deliberate test,
 * whichever is higher) since that's the most direct read of the three signals the brief lists;
 * falls back to the set's own RIR/RPE (lib/effort.js's rirOf) when no 1RM estimate exists yet
 * for this exercise — a brand-new movement, or one only ever trained past onerm.js's REP_CAP.
 * Returns null when neither signal is available: no zone beats a wrong one.
 */
export function zoneOfSet(S, exId, set) {
  const oneRM = bestKnownOneRM(S, exId)
  if (oneRM > 0 && set.w > 0) return zoneForPct(set.w / oneRM * 100)
  return zoneForRir(rirOf(set))
}

// Same rounding the barbell plate calculator uses (2.5kg / 5lb) — a suggested weight that isn't
// actually loadable would defeat the point of suggesting one.
const roundToStep = (w, unit) => {
  const step = unit === 'lb' ? 5 : 2.5
  return Math.round(w / step) * step
}

/**
 * Suggested weight to land near the middle of `zoneId`, from this exercise's current best known
 * 1RM — the reverse direction of zoneOfSet, for "I want to train Zone 4 today, what should I
 * load?" Null when there's no 1RM estimate to work from yet (a brand-new exercise), or for an
 * unknown zone id.
 */
export function suggestedWeightForZone(S, exId, zoneId, unit) {
  const oneRM = bestKnownOneRM(S, exId)
  const zone = ZONE_BY_ID[zoneId]
  if (!(oneRM > 0) || !zone) return null
  const pctMid = zone.id === 5 ? 95 : (zone.pctMin + zone.pctMax) / 2
  return roundToStep(oneRM * pctMid / 100, unit)
}
