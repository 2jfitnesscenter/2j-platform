// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, fmtNum } from './format.js'
import { latestBodyWeight } from './bodyweight.js'
import { isCardio } from './exercises.js'
import { uxOn } from './features.js'
import { dayPlanRoutineId, isMovedDayPlan } from './day-plan.js'
import { countsForProgression } from './workout-policy.js'

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// Emoji + a plain-language read of each RPE step, for the visual effort picker (sheets.jsx's
// effortSheet/EffortBadge) — the standard RPE 6-10 scale, one entry per 0.5 step. RIR reads the
// same table through its RPE equivalent (rpe = 10 − rir, see feelFor) rather than keeping a
// second table, since the two scales describe the same feeling from opposite ends.
export const EFFORT_FEEL = [
  { rpe: 6, emoji: '🙂', label: 'Warmup / very easy (4+ reps in reserve)' },
  { rpe: 6.5, emoji: '🙂', label: 'Easy (about 4 reps in reserve)' },
  { rpe: 7, emoji: '😐', label: 'Moderate (3 reps in reserve)' },
  { rpe: 7.5, emoji: '😐', label: 'Getting harder (2-3 reps in reserve)' },
  { rpe: 8, emoji: '😬', label: 'Demanding (2 reps in reserve)' },
  { rpe: 8.5, emoji: '😟', label: 'You could have done 1-2 more reps' },
  { rpe: 9, emoji: '😣', label: 'Very hard (1 rep in reserve)' },
  { rpe: 9.5, emoji: '😫', label: 'Right at the limit (maybe 1 more with a spot)' },
  { rpe: 10, emoji: '🥵', label: 'Complete muscular failure (0 reps in reserve)' },
]
// The emoji/label for a value on either scale — RIR is converted to its RPE equivalent first
// (clamped into 6-10, the range the table actually covers: anything easier than RPE 6 reads the
// same as RPE 6 itself, "very easy").
export function feelFor(kind, value) {
  if (value == null) return null
  const rpe = kind === 'rpe' ? value : Math.max(6, Math.min(10, 10 - value))
  let best = EFFORT_FEEL[0]
  for (const f of EFFORT_FEEL) if (Math.abs(f.rpe - rpe) < Math.abs(best.rpe - rpe)) best = f
  return best
}
// The three-way color a logged set's intensity badges as, by canonical RIR (10 − rpe) —
// matching the boundaries the spec calls out: RPE 7-8 (RIR 2-3) reads amber, RPE 9-10
// (RIR 0-1) reads red, anything easier reads green.
export function effortColor(rir) {
  if (rir == null) return null
  if (rir >= 3.5) return 'green'
  if (rir >= 1.5) return 'amber'
  return 'red'
}
export const EFFORT_COLOR_VAR = { green: 'var(--green)', amber: 'var(--yellow)', red: 'var(--red)' }
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
// Effort (RPE/RIR) is a feature: off for everyone when the admin turns it off, or when the member chose not to use it
// (lib/features.js). Already-logged ratings stay in the data; only the logging UI and the trends go quiet.
export const effortOf = S => {
  if (S && !uxOn(S, 'effort')) return 'none'
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  const mode = modeOf(cfg || { id })
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  return `${fmtNum(s.w || 0)}×${s.r || 0}` + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time' }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps' }
}
// "10", or "8-12" once a rep range (RoutineEdit's exConfigSheet) is set — the single number
// stays the real prescription (buildSets, progression) everywhere else; the range is purely a
// wider display/placeholder hint layered on top of it.
export const repsLabel = cfg =>
  cfg.targetRepsMin != null && cfg.targetRepsMax != null ? `${cfg.targetRepsMin}-${cfg.targetRepsMax}` : cfg.reps
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  const load = cfg.weight ? ' · ' + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  return `${n} × ${repsLabel(cfg)}${load}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

// A set's optional `type` — 'warmup' | 'failure' | 'drop' | undefined (undefined = normal). Only
// warmup and drop are excluded here: a warmup isn't real work, and a drop set's reps/weight are
// a deliberate continuation at reduced load, not comparable to the straight-set prescription.
// Failure sets are still full working sets and stay in.
export const workingSets = sets => (sets || []).filter(s => s.type !== 'warmup' && s.type !== 'drop')

// Derived from completed work only; topW remains a PR, never a starting-load override.
export function workingLoadEvidence(sets) {
  const done = workingSets(sets).filter(s => s.done)
  const first = done[0]
  const effort = s => s?.rpe ?? (s?.rir != null ? 10 - s.rir : null)
  const highEffort = done.some(s => s.feel === 'hard' || s.feel === 'fail' || effort(s) > 8)
  const supported = first && (first.feel === 'easy' || first.feel === 'good' || (effort(first) != null && effort(first) <= 8))
  return { first, weights: done.map(s => Number(s.w) || 0),
    weight: Number(first?.w) || 0, rpe: effort(first), highEffort,
    safeToIncrease: !!supported && !highEffort }
}

// V3 — up to `n` past appearances of one exercise, most recent first, for a quick "last few
// sessions" glance during a live workout. Same walk/filter lastEntryFor already did (front-to-
// back through S.workouts assuming chronological order — see insertWorkoutSorted's own comment),
// generalised to collect instead of return-on-first-match, so there is exactly one place that
// knows how to find "this exercise, historically" rather than two copies drifting apart.
// Searches by the EXACT exercise id on record for that workout, same as it always has — a
// mid-session substitution (Workout.jsx's replaceExercise) changes which id future sets log
// against, so a swapped exercise's own earlier history under its old id doesn't show up here
// either; that is the existing, unchanged behaviour, not a new gap this introduces.
export function recentEntriesFor(S, exId, n = 3) {
  const out = []
  for (let i = S.workouts.length - 1; i >= 0 && out.length < n; i--) {
    const workout = S.workouts[i]
    if (!countsForProgression(workout)) continue
    const en = (workout.entries || []).find(e => e.id === exId)
    if (!en) continue
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    const sets = workingSets(en.sets).filter(s => s.done)
    if (sets.length) out.push({ d: S.workouts[i].d, sets, target: en.target || null })
  }
  return out
}
export const lastEntryFor = (S, exId) => recentEntriesFor(S, exId, 1)[0] || null
// Inserts a workout by date instead of appending — a workout logged after the fact (see
// sheets.jsx's beginPastWorkout) can be older than ones already on file. lastEntryFor above,
// and e1rmSeries/best1RM in onerm.js, all read S.workouts front-to-back assuming chronological
// order (their own comments say so); a plain push would silently make a backdated log look like
// the most recent session for progression and PR purposes. Ties (same day) land after any
// existing entries for that day, matching what push already did for two same-day sessions.
export function insertWorkoutSorted(workouts, w) {
  const out = [...workouts]
  let i = out.length
  while (i > 0 && out[i - 1].d > w.d) i--
  out.splice(i, 0, w)
  return out
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => {
    if (!countsForProgression(w)) return
    ;(w.entries || []).forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w })
      if (e.topW && e.topW > best) best = e.topW
    }
    })
  })
  return best
}
// `exWeights` predates source ids and may be a manually confirmed cache. Keep it intact, but
// don't let a cache sourced from an excluded session (or an untraceable legacy cache for an
// exercise that now has excluded history) seed future progression.
export function trackedWeightFor(S, exId) {
  const cached = S?.exWeights?.[exId]
  if (!cached) return null
  if (cached.sourceWorkoutId) {
    const source = (S.workouts || []).find(w => w?.id === cached.sourceWorkoutId)
    if (source?.excludeFromProgression === true) return null
  } else if ((S.workouts || []).some(w => w?.excludeFromProgression === true && (w.entries || []).some(e => e.id === exId))) return null
  return cached
}
// The week currently in effect. An active program is the whole picture for the week it drives —
// a day it doesn't list is a rest day, not a peek at whatever the flat week has for that day —
// so this never merges the two. Falls back to the classic flat S.week (still written directly by
// the quick-plan generator and the AI Coach, unchanged) whenever no program is active.
export function activeWeek(S) {
  const p = S.activeProgramId && (S.programs || []).find(x => x.id === S.activeProgramId)
  return p ? (p.week || {}) : (S.week || {})
}
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso]
  if (ov === 'rest' || isMovedDayPlan(ov)) return null
  const overrideId = dayPlanRoutineId(ov)
  if (overrideId && S.routines.some(r => r.id === overrideId)) return overrideId
  const wd = new Date(iso + 'T12:00:00').getDay()
  return activeWeek(S)[wd] || null
}
export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg) {
  // Settings → Training → "Show previous results" — off means a fresh set starts at the
  // routine's own target only, not last time's/the tracked weight, so `prevAt` below always
  // misses and every mode falls back to its own `cfg.*` default a few lines down.
  const last = S.showPreviousResults !== false ? lastEntryFor(S, cfg.id) : null
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const sets = []
  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i)
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false })
    }
    return sets
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }
  // exWeights can be a maximum/PR. Completed positional work wins; tracked weight
  // is only a legacy fallback when no performed rep set exists.
  const conf = S.showPreviousResults !== false ? trackedWeightFor(S, cfg.id) : null
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    const w = usable ? usable.w : (conf && conf.w > 0 ? conf.w : cfg.weight)
    sets.push({ w, r: usable ? usable.r : cfg.reps, done: false })
  }
  // A routine-level dropset (RoutineEdit's exercise menu) always lands after the last working
  // set, at the same reps and a fixed 20% lighter — same rounding as the warmup ramp below, so
  // it's a number you can actually load. No working weight yet means nothing to drop from.
  const lastSet = sets[sets.length - 1]
  if (cfg.dropset && lastSet && lastSet.w > 0) {
    sets.push({ w: roundToPlate(lastSet.w * 0.8, S.unit), r: lastSet.r, done: false, type: 'drop' })
  }
  return S.warmupEnabled !== false ? [...warmupSets(sets[0].w, S.unit), ...sets] : sets
}
// Nearest half-plate (2.5kg or 5lb), so a generated weight is always actually loadable.
const roundToPlate = (w, unit) => {
  const step = unit === 'lb' ? 5 : 2.5
  return Math.round(w / step) * step
}
// Two ramp-up sets ahead of the working weight — 50%×8 then 75%×5. A brand-new exercise with
// no working weight yet has nothing to compute a ramp from, but the setting still means "show
// me warmup rows" — so they still appear, blank at 0, exactly like a fresh working set does
// when nothing is known yet (the profile fills them in the first time they actually do it).
export function warmupSets(workingWeight, unit) {
  if (!(workingWeight > 0)) return [
    { w: 0, r: 8, done: false, type: 'warmup' },
    { w: 0, r: 5, done: false, type: 'warmup' },
  ]
  return [
    { w: roundToPlate(workingWeight * 0.5, unit), r: 8, done: false, type: 'warmup' },
    { w: roundToPlate(workingWeight * 0.75, unit), r: 5, done: false, type: 'warmup' },
  ]
}
// Swaps which exercise one live entry's sets apply to — same semantics as Workout.jsx's own
// replaceExercise (sheets.jsx's alternativesSheet flow): only the id changes. `target`, `plan`
// and every set already there — including any already marked done — carry over completely
// untouched, exactly as the phone does it. Exported (Workout.jsx keeps its own inline version,
// tied to the store's update()) so the Bunker kiosk, which manages `active` as plain component
// state rather than through useStore, can reuse the identical rule instead of a second one.
export function swapEntryExercise(entries, idx, newId) {
  return entries.map((e, i) => i !== idx ? e : { ...e, id: newId })
}
export function workoutVolume(w) {
  let v = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done && s.type !== 'warmup') v += (s.w || 0) * (s.r || 0) }))
  return v
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
// kept as the name every caller already uses; the rule lives in lib/bodyweight.js
export const lastBW = latestBodyWeight
// Has the profile weighed in recently enough that the "quick check-in" before a workout would
// just be nagging? Noon-anchored dates (matching effectiveRoutineId's own convention) so a day
// count is never off by one across a DST transition.
export function hasRecentWeighIn(S, days = 15) {
  const bw = lastBW(S)
  if (!bw) return false
  const today = new Date(todayISO() + 'T12:00:00')
  const last = new Date(bw.d + 'T12:00:00')
  return Math.round((today - last) / 86400000) <= days
}

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}
