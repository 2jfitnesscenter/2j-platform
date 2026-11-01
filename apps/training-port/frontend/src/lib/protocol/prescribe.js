// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Deterministic prescription and estimates under the 2J protocol. Pure: no app imports.
import { REPS, REST } from './rules.js'

export const modeOfEntry = e => (e?.mode === 'time' || e?.mode === 'cardio') ? e.mode : (e?.min != null && e?.speed != null && e?.reps == null ? 'cardio' : 'reps')

// A reps entry's range as prescribed: a range when the builder set one, else the fixed target.
export function repRange(e) {
  if (modeOfEntry(e) !== 'reps') return null
  const hi = Number(e.targetRepsMax ?? e.reps)
  const lo = Number(e.targetRepsMin ?? e.repsMin ?? e.reps)
  if (!Number.isFinite(hi) || hi <= 0) return null
  return [Math.min(lo || hi, hi), hi]
}

// Supersets: consecutive entries sharing `sg` form one unit (same rule as lib/history.js).
export function unitsOf(ex) {
  const units = []
  ;(ex || []).forEach((e, i) => {
    const last = units[units.length - 1]
    if (last && e.sg && ex[last[last.length - 1]].sg === e.sg) last.push(i)
    else units.push([i])
  })
  return units
}

/** Role inside a strength/power block, when the entry did not state one. */
export function roleOf(e, c, goal, isFirstCompound) {
  if (e?.role) return e.role
  if (goal === 'strength') return isFirstCompound ? 'main' : c.cls === 'isolation' ? 'accessory' : 'secondary'
  if (goal === 'power') return (c.pattern === 'jump' || c.cls === 'compound_free') ? 'main' : 'accessory'
  return null
}

/** Which REST band applies to an entry. */
export function restDemand(c, goal, role) {
  if (goal === 'strength') return role === 'main' ? 'heavy' : role === 'accessory' ? 'isolation' : 'compound'
  if (goal === 'power') return role === 'main' ? 'power' : 'machine'
  if (goal === 'endurance') return 'circuit'
  if (c.cls === 'compound_free') return 'compound'
  if (c.cls === 'isolation') return 'isolation'
  return 'machine'
}

/** Which REPS zone applies to an entry. */
export function repKey(c, goal, role) {
  if (goal === 'strength') return role === 'main' ? 'main' : role === 'accessory' ? 'accessory' : 'secondary'
  if (goal === 'power') return role === 'main' ? 'main' : 'accessory'
  if (role === 'metabolic') return 'metabolic'
  return c.cls
}
export const zoneFor = (c, goal, role) => REPS[goal]?.[repKey(c, goal, role)] || null

// ---- default prescription ---------------------------------------------------------------
// What 2J writes when a block is built or a trainer asks "prescribe this for me". Always
// inside the preferred zone; RPE mostly 6-8 with 10 only as a selective last set.
const rng = (a, b) => [a, b]
const REP_DEFAULT = {
  hypertrophy: { compound_free: rng(6, 10), compound_stable: rng(8, 12), secondary: rng(8, 12), isolation: rng(12, 15), metabolic: rng(15, 20) },
  general: { compound_free: rng(6, 10), compound_stable: rng(8, 12), secondary: rng(10, 12), isolation: rng(12, 15), metabolic: rng(15, 20) },
  endurance: { compound_free: rng(12, 15), compound_stable: rng(15, 20), secondary: rng(15, 20), isolation: rng(15, 20), metabolic: rng(20, 25) },
  beginner: { compound_free: rng(8, 12), compound_stable: rng(10, 12), secondary: rng(10, 12), isolation: rng(12, 15), metabolic: rng(12, 15) },
  strength: { main: { beginner: rng(5, 6), intermediate: rng(4, 6), advanced: rng(3, 5) }, secondary: rng(6, 8), accessory: rng(8, 12) },
  power: { main: rng(3, 5), accessory: rng(6, 8) },
}
const REST_DEFAULT = { heavy: 180, compound: 150, machine: 105, isolation: 75, power: 180, circuit: 60 }

function setsFor(goal, level, c, role, position) {
  if (goal === 'beginner') return 2
  if (goal === 'strength') return role === 'main' ? (level === 'advanced' ? 5 : 4) : role === 'secondary' ? 3 : 2
  if (goal === 'power') return role === 'main' ? 4 : 2
  if (goal === 'endurance') return level === 'beginner' ? 2 : 3
  if (level === 'beginner') return c.cls === 'isolation' ? 2 : 2
  if (level === 'advanced' && position === 0 && c.cls !== 'isolation') return 4
  return 3
}

// 2J RPE per set. Never every set at 10; 10 only as the last set of stable/isolation work for
// intermediate+ hypertrophy, never on power, never for beginners on technical lifts.
function rpeFor(goal, level, c, role, sets) {
  const fill = v => Array.from({ length: sets }, () => v)
  if (goal === 'power') return fill(6)
  if (goal === 'beginner') return fill(6).map((v, i) => i === 0 && sets > 1 ? 4 : v)
  if (goal === 'strength') {
    if (role === 'main') return fill(8).map((v, i) => i === 0 && level !== 'advanced' ? 6 : v)
    return fill(8)
  }
  if (level === 'beginner') return fill(6).map((v, i) => (i === sets - 1 && c.cls !== 'compound_free') ? 8 : v)
  if (goal === 'general' || goal === 'endurance') return fill(8).map((v, i) => i === 0 ? 6 : v)
  // hypertrophy
  const base = fill(8)
  if (level === 'advanced' && c.cls !== 'compound_free' && sets > 1) base[sets - 1] = 10
  return base
}

/**
 * Default prescription for one exercise.
 * @returns entry fields: { sets, mode, reps, targetRepsMin, targetRepsMax, repsMin, prog, rpe, rest }
 */
export function prescribe(c, { goal = 'hypertrophy', level = 'intermediate', role = null, position = 0 } = {}) {
  const r = role || roleOf({}, c, goal, position === 0)
  const sets = setsFor(goal, level, c, r, position)
  let range
  if (goal === 'strength') range = r === 'main' ? REP_DEFAULT.strength.main[level] || REP_DEFAULT.strength.main.intermediate : REP_DEFAULT.strength[r === 'accessory' ? 'accessory' : 'secondary']
  else if (goal === 'power') range = REP_DEFAULT.power[r === 'main' ? 'main' : 'accessory']
  else range = (REP_DEFAULT[goal] || REP_DEFAULT.hypertrophy)[r === 'metabolic' ? 'metabolic' : c.cls] || rng(8, 12)
  const [lo, hi] = range
  const out = { sets, mode: 'reps', reps: hi, targetRepsMin: lo, targetRepsMax: hi, repsMin: lo, prog: 'double', rpe: rpeFor(goal, level, c, r, sets), rest: REST_DEFAULT[restDemand(c, goal, r)] }
  if (r && (goal === 'strength' || goal === 'power' || r === 'metabolic')) out.role = r
  return out
}

// ---- duration --------------------------------------------------------------------------
// ~3 s per rep plus a few seconds to set up, the entry's rest (or the demand default) between
// sets and rounds, ~15 s between superset partners and ~60 s to move to the next exercise.
// Rounded to 5 minutes and always shown as "~N min" (2J-RULE-DURATION).
export function workSeconds(e) {
  const mode = modeOfEntry(e)
  if (mode === 'cardio') return (Number(e.min) || 20) * 60
  if (mode === 'time') return (Number(e.sec) || 45) + 5
  const r = repRange(e)
  return (r ? (r[0] + r[1]) / 2 : 10) * 3 + 5
}
export function estimateSeconds(ex, restOf = e => e.rest) {
  let total = 0
  for (const unit of unitsOf(ex)) {
    const entries = unit.map(i => ex[i])
    const rounds = Math.max(...entries.map(e => Math.max(1, Number(e.sets) || 1)))
    const last = entries[entries.length - 1]
    const rest = modeOfEntry(last) === 'cardio' ? 30 : Number(restOf(last)) || 90
    const perRound = entries.reduce((a, e) => a + workSeconds(e), 0) + (entries.length - 1) * 15
    total += rounds * perRound + (rounds - 1) * rest + 60
  }
  return total
}
export const roundMinutes = sec => sec <= 0 ? 0 : Math.max(5, Math.round(sec / 60 / 5) * 5)
export const REST_DEFAULTS = REST_DEFAULT
export { REST }
