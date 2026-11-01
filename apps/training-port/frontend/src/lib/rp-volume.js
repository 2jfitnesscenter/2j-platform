// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Weekly Volume Zones — Renaissance Periodization-style MV/MEV/MAV/MRV landmarks (Israetel et
// al.'s hypertrophy volume framework), layered onto the same 12 MUSCLE_GROUPS the rest of the
// app already uses (body map, muscle recovery, the exercise pickers) — no third muscle
// taxonomy. Distinct from lib/training-zones.js's Z1-Z5, which classify a single SET's
// intensity (%1RM/RIR); this classifies a whole WEEK's accumulated set count per muscle group.
// Off by default (Settings → enableRpVolumeZones) — it's a bodybuilding/hypertrophy tool, not
// something every member needs turned on.
import { MUSCLE_GROUPS, loadOfWorkouts, loadOfActive } from './muscles.js'
import { countsForProgression } from './workout-policy.js'
import { weekKey, todayISO } from './format.js'
import { dateLocale } from './i18n.js'

export const LEVELS = ['beginner', 'intermediate', 'advanced']

// Every muscle's real MEV/MRV varies by individual — these are starting points for the three
// broad experience tiers (Settings' level picker), not a promise. `mav` is the low end of the
// "sweet spot" range (RP's own MAV is usually quoted as a range, e.g. "12-16"); its high end is
// simply `mrvMin`, so the five zones tile with no gaps or overlaps: [0,mv) below, [mv,mev) MV,
// [mev,mav) MEV, [mav,mrvMin) MAV, [mrvMin,mrvMax] MRV — and anything past mrvMax still reads
// as MRV (a hard ceiling reads the same as "right at it", not as some undefined sixth zone).
// Beginner ≈ intermediate − 25-30%, advanced ≈ intermediate + ~20%, per Israetel et al.'s own
// tiering; forearms/abs/glutes carry an mv of 0 at the lower tiers on purpose — those muscles
// pick up enough incidental volume from everything else that "zero direct sets" already reads
// as inside the effective range, not as neglect.
export const RP_VOLUME_DEFAULTS = {
  beginner: {
    chest: { mv: 4, mev: 6, mav: 8, mrvMin: 12, mrvMax: 14 },
    back: { mv: 4, mev: 6, mav: 10, mrvMin: 12, mrvMax: 16 },
    trapezius: { mv: 3, mev: 4, mav: 6, mrvMin: 10, mrvMax: 13 },
    deltoids: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 16 },
    biceps: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    triceps: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    forearm: { mv: 0, mev: 0, mav: 4, mrvMin: 6, mrvMax: 10 },
    quadriceps: { mv: 4, mev: 6, mav: 8, mrvMin: 12, mrvMax: 14 },
    hamstring: { mv: 3, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    gluteal: { mv: 0, mev: 2, mav: 6, mrvMin: 8, mrvMax: 12 },
    calves: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    abs: { mv: 0, mev: 2, mav: 6, mrvMin: 8, mrvMax: 12 },
  },
  intermediate: {
    chest: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 },
    back: { mv: 6, mev: 10, mav: 14, mrvMin: 18, mrvMax: 22 },
    trapezius: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    deltoids: { mv: 6, mev: 8, mav: 16, mrvMin: 20, mrvMax: 24 },
    biceps: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    triceps: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    forearm: { mv: 0, mev: 2, mav: 6, mrvMin: 10, mrvMax: 14 },
    quadriceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 18 },
    hamstring: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 16 },
    gluteal: { mv: 2, mev: 4, mav: 8, mrvMin: 12, mrvMax: 16 },
    calves: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    abs: { mv: 0, mev: 4, mav: 8, mrvMin: 12, mrvMax: 16 },
  },
  advanced: {
    chest: { mv: 8, mev: 10, mav: 14, mrvMin: 20, mrvMax: 24 },
    back: { mv: 8, mev: 12, mav: 16, mrvMin: 22, mrvMax: 26 },
    trapezius: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    deltoids: { mv: 8, mev: 12, mav: 18, mrvMin: 24, mrvMax: 28 },
    biceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    triceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    forearm: { mv: 0, mev: 4, mav: 8, mrvMin: 12, mrvMax: 18 },
    quadriceps: { mv: 8, mev: 10, mav: 14, mrvMin: 20, mrvMax: 22 },
    hamstring: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 },
    gluteal: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 20 },
    calves: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    abs: { mv: 0, mev: 6, mav: 10, mrvMin: 14, mrvMax: 20 },
  },
}

// Settings → level picker, plus v2's future per-muscle +/- calibration — both write into the
// same shape (`{ [muscleGroupKey]: { mv, mev, mav, mrvMin, mrvMax } }`), overriding the
// selected level's defaults one muscle at a time. v1 never writes S.rpVolumeOverrides itself
// (no calibration UI yet), but already reads it here so a v2 needs no migration.
export function landmarksFor(S, groupKey) {
  const level = LEVELS.includes(S.trainingLevel) ? S.trainingLevel : 'intermediate'
  return (S.rpVolumeOverrides && S.rpVolumeOverrides[groupKey]) || RP_VOLUME_DEFAULTS[level][groupKey]
}

export const ZONE_ORDER = ['below', 'mv', 'mev', 'mav', 'mrv']
export const ZONE_META = {
  below: { code: '—', color: 'var(--blue)', label: 'Under-trained' },
  mv: { code: 'MV', color: 'var(--green)', label: 'Maintenance zone' },
  mev: { code: 'MEV', color: 'var(--yellow)', label: 'Growth zone' },
  mav: { code: 'MAV', color: 'var(--orange)', label: 'Adaptive zone — the sweet spot' },
  mrv: { code: 'MRV', color: 'var(--red)', label: 'Recovery limit' },
}

// Which of the five zones `sets` (this week's accumulated count for one muscle group) lands
// in, against that group's own landmarks.
export function zoneForVolume(sets, lm) {
  if (!lm) return null
  if (sets < lm.mv) return 'below'
  if (sets < lm.mev) return 'mv'
  if (sets < lm.mav) return 'mev'
  if (sets < lm.mrvMin) return 'mav'
  return 'mrv'
}

// Collapses an 18-slug load (lib/muscles.js's loadOf family) down to the 12 MUSCLE_GROUPS by
// summing each group's own slugs — the same grouping Library.jsx's "by muscle" browser and
// ExerciseBrowser's filter already use, just totalled instead of just matched.
export function rollupToGroups(load) {
  const out = {}
  MUSCLE_GROUPS.forEach(g => { out[g.key] = g.slugs.reduce((sum, s) => sum + (load[s] || 0), 0) })
  return out
}

// This week's effective-set count per muscle group — finished workouts that landed in the
// current calendar week (lib/format.js's weekKey, same "current week" the Stats screen's own
// Muscle Balance card already uses). Split from the still-open session's own contribution
// (weeklyGroupVolumeActive, below) so a caller that re-renders on every keystroke — Workout.jsx's
// live logger bar — can memoize this half against S.workouts (which only changes when a workout
// actually finishes, gets imported, or is deleted) instead of re-filtering the user's whole
// history every time a weight field changes. Reuses loadOfWorkouts as-is — no second history
// scanner — and the same countSecondary/secondaryFactor opts (muscleOptsOf(S)) the body map and
// recovery already read, so a half-credited secondary muscle means the same thing here that it
// means everywhere else in the app.
export function weeklyGroupVolumeFinished(S, opts) {
  const wk = weekKey(todayISO())
  const finishedThisWeek = (S.workouts || []).filter(w => countsForProgression(w) && weekKey(w.d) === wk)
  return rollupToGroups(loadOfWorkouts(finishedThisWeek, null, opts))
}

// The still-open session's own sets-so-far, rolled up the same way — bounded by the size of
// the current workout (a handful of exercises), so unlike the history half above there's no
// real cost to computing this fresh on every render; it's what makes the bar move the instant
// a set is checked, rather than waiting for the workout to finish.
export function weeklyGroupVolumeActive(S, opts) {
  return S.active ? rollupToGroups(loadOfActive(S.active, opts)) : {}
}

// Convenience wrapper combining both — what a caller that only renders once per visit (Stats.jsx's
// summary card) wants; no reason to split the memoization there the way the logger needs to.
export function weeklyGroupVolume(S, opts) {
  const finished = weeklyGroupVolumeFinished(S, opts)
  const active = weeklyGroupVolumeActive(S, opts)
  const out = {}
  MUSCLE_GROUPS.forEach(g => { out[g.key] = (finished[g.key] || 0) + (active[g.key] || 0) })
  return out
}

// Which muscle group an exercise is "for", as far as this feature is concerned — its single
// highest-weighted slug (from musclesOf), rolled up to that slug's group. An exercise trains
// more than one muscle, but the logger's bar (like the spec's own mockup) shows one group per
// exercise, not a stack of bars — the dominant one is the one a lifter actually thinks of the
// exercise as "for" (a bench press is a chest exercise, even though triceps get real work too).
export function primaryGroupOf(musclesLoad) {
  let best = null, bestW = 0
  Object.entries(musclesLoad).forEach(([slug, w]) => { if (w > bestW) { best = slug; bestW = w } })
  if (!best) return null
  const g = MUSCLE_GROUPS.find(g => g.slugs.includes(best))
  return g ? g.key : null
}

/* ============================ v2: analytics screen ============================ */
// Everything below is for the "Volume analytics" detail screen (Progress → tap the weekly
// volume card) — past weeks, a monthly rollup, and per-muscle calibration. None of it runs on
// every keystroke the way the logger's bar does, so none of it needs the split-and-memoize
// treatment weeklyGroupVolumeFinished got; a plain useMemo keyed on S.workouts at the call site
// is enough (see views/RpVolumeStats.jsx).

// Monday and Sunday of the week `offset` weeks before this one (0 = the current week) — the
// one date computation every "which week" helper below shares, so they can't disagree with
// each other or with lib/format.js's own weekKey about where a week starts.
function weekDates(offset) {
  const base = new Date(todayISO() + 'T12:00:00')
  base.setDate(base.getDate() - offset * 7)
  const day = (base.getDay() + 6) % 7   // 0=Mon..6=Sun, same shift weekKey itself uses
  const monday = new Date(base)
  monday.setDate(base.getDate() - day)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { monday, sunday }
}

// "14-20 sep" within one month, "31 ago-6 sep" when the week crosses a month boundary — the
// historical matrix's own column headers.
export function weekRangeLabel(offset) {
  const { monday, sunday } = weekDates(offset)
  const sameMonth = monday.getMonth() === sunday.getMonth()
  const withMonth = d => d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
  const dayOnly = d => String(d.getDate())
  return `${sameMonth ? dayOnly(monday) : withMonth(monday)}-${withMonth(sunday)}`
}

// This week (offset 0, including the still-open session) or a past week (finished workouts
// only — there's nothing "still open" about a week that's already over) per muscle group.
export function groupVolumeForWeek(S, offset, opts) {
  if (offset === 0) return weeklyGroupVolume(S, opts)
  const { monday } = weekDates(offset)
  const wk = weekKey(monday.toISOString().slice(0, 10))
  const finishedThatWeek = (S.workouts || []).filter(w => countsForProgression(w) && weekKey(w.d) === wk)
  return rollupToGroups(loadOfWorkouts(finishedThatWeek, null, opts))
}

// The average weekly set count across every week whose Monday falls in the current calendar
// month — a mesocycle-length view without hand-picking a day count that doesn't map cleanly
// onto "weeks", since months don't hold a whole number of them. Scans up to 6 weeks back, a
// safe margin past the 4-5 a real month ever has; the ones that land in an earlier month are
// simply skipped rather than causing a second, differently-shaped code path.
export function monthlyGroupVolume(S, opts) {
  const now = new Date(todayISO() + 'T12:00:00')
  const offsetsInMonth = []
  for (let offset = 0; offset < 6; offset++) {
    const { monday } = weekDates(offset)
    if (monday.getMonth() === now.getMonth() && monday.getFullYear() === now.getFullYear()) offsetsInMonth.push(offset)
  }
  const sums = {}
  MUSCLE_GROUPS.forEach(g => { sums[g.key] = 0 })
  offsetsInMonth.forEach(offset => {
    const vol = groupVolumeForWeek(S, offset, opts)
    MUSCLE_GROUPS.forEach(g => { sums[g.key] += vol[g.key] || 0 })
  })
  const out = {}
  const n = offsetsInMonth.length || 1
  MUSCLE_GROUPS.forEach(g => { out[g.key] = sums[g.key] / n })
  return out
}

// How many of the 12 groups currently sit in each of the five zones — the mesocycle summary
// card's "N optimal, N under, N over" tally. `volumeByGroup` is whatever period the caller is
// looking at (this week, a past week, or the monthly average), already computed.
export function zoneCounts(S, volumeByGroup) {
  const counts = { below: 0, mv: 0, mev: 0, mav: 0, mrv: 0 }
  MUSCLE_GROUPS.forEach(g => {
    const zone = zoneForVolume(volumeByGroup[g.key] || 0, landmarksFor(S, g.key))
    counts[zone]++
  })
  return counts
}

/* ============================ v2: per-muscle calibration ============================ */
// Keeps mv <= mev < mav < mrvMin <= mrvMax as a member nudges one threshold at a time with the
// calibration screen's own +/- buttons — a press that would break the ordering just doesn't
// move that field, rather than silently reordering the others out from under whatever they
// were just set to. `delta` is the step (already signed — negative to decrement).
export function clampLandmark(lm, field, delta) {
  const next = { ...lm, [field]: Math.max(0, lm[field] + delta) }
  if (field === 'mv' && next.mv > next.mev) return lm
  if (field === 'mev' && (next.mev < next.mv || next.mev >= next.mav)) return lm
  if (field === 'mav' && (next.mav <= next.mev || next.mav >= next.mrvMin)) return lm
  if (field === 'mrvMin' && (next.mrvMin <= next.mav || next.mrvMin > next.mrvMax)) return lm
  if (field === 'mrvMax' && next.mrvMax < next.mrvMin) return lm
  return next
}
