// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The badge evaluator — turns a profile's real history into unlock/progress state for every
// badge in badges-data.js. Every conditionType except 'first_action'-by-superset is a pure
// function of S (the whole store state), recomputed from scratch on every call rather than
// tracked incrementally — simplest to get right, and the only way that's automatically also
// correct for a CSV/Apple Health import that adds many workouts at once, or for an existing
// profile with years of history from before this feature shipped (see ensureBadgesCurrent).
import { BADGES } from './badges-data.js'
import { streakWeeks, modeOf } from './history.js'
import { weekKey } from './format.js'
import { rirOf } from './effort.js'
import { loadOfWorkouts, muscleOptsOf } from './muscles.js'
import { globalRank } from './rank.js'
import { GROUPS, GROUP_MUSCLES } from './recovery.js'
import { countsForProgression } from './workout-policy.js'

export const totalWorkouts = S => (S.workouts || []).length
export const totalVolumeKg = S => (S.workouts || []).filter(countsForProgression).reduce((a, w) => a + (w.vol || 0), 0)

// { weekKey/monthKey: Set of distinct workout dates } — deduped by calendar day first (two
// sessions logged the same day count once, per the Calendar badges' own "don't double-count a
// day" rule), then bucketed. weekKey (lib/format.js) is the same Mon-Sun ISO-week key
// streakWeeks already uses; a month bucket is just `w.d`'s own 'YYYY-MM' prefix — `w.d` is
// already a local calendar date (not a UTC timestamp), so no timezone conversion is needed for
// either bucket, and both stay correct across a CSV import or a backdated past-workout log the
// same way every other badge condition here does (a full re-scan of S.workouts, nothing tracked
// incrementally).
function workoutDaysByBucket(S, keyFn) {
  const map = {}
  ;(S.workouts || []).forEach(w => {
    const k = keyFn(w.d)
    ;(map[k] || (map[k] = new Set())).add(w.d)
  })
  return map
}
export const maxWeeklyWorkoutDays = S => Math.max(0, ...Object.values(workoutDaysByBucket(S, weekKey)).map(s => s.size))
export const maxMonthlyWorkoutDays = S => Math.max(0, ...Object.values(workoutDaysByBucket(S, d => d.slice(0, 7))).map(s => s.size))

// globalRank's own 0-24 continuous scale (lib/rank.js — 4 tiers-worth of intervals × 6
// divisions), rescaled to 0-300 so the brief's 100/150/200/250 thresholds land at sensible
// points across it (roughly Silver/Gold/Diamond/near-max) instead of introducing a second,
// unrelated strength formula. 0 while locked (fewer than GLOBAL_UNLOCK_MIN ranked lifts) —
// same gate the Rank screen itself uses, so a strength badge never unlocks off less data
// than the Rank screen would trust.
export function strengthScore(S) {
  const r = globalRank(S)
  return r.locked ? 0 : Math.round(r.continuous / 24 * 300)
}

// { exerciseId: number of distinct workouts it appears in with at least one done set } —
// the shared source for both exercise-breadth ("10 different exercises") and exercise-depth
// ("the same one 25 times") badges.
export function exerciseSessionCounts(S) {
  const counts = {}
  ;(S.workouts || []).forEach(w => {
    const seen = new Set()
    ;(w.entries || []).forEach(e => { if ((e.sets || []).some(s => s.done)) seen.add(e.id) })
    seen.forEach(id => { counts[id] = (counts[id] || 0) + 1 })
  })
  return counts
}
export const distinctExerciseCount = S => Object.keys(exerciseSessionCounts(S)).length
export const maxExerciseRepeatCount = S => Math.max(0, ...Object.values(exerciseSessionCounts(S)))

// A workout counts as "full body" once it has at least one done, non-warmup set touching
// each of recovery.js's four movement-pattern groups (push/pull/legs/core) — the same
// grouping the /recovery screen already uses to summarise a session, rather than inventing
// a second push/pull/legs taxonomy just for this badge.
export function isFullBodyWorkout(S, w) {
  const load = loadOfWorkouts([w], null, muscleOptsOf(S))
  return GROUPS.every(g => GROUP_MUSCLES[g].some(slug => (load[slug] || 0) > 0))
}
const hasDropSet = w => (w.entries || []).some(e => (e.sets || []).some(s => s.done && s.type === 'drop'))
const hasFailureSet = w => (w.entries || []).some(e => (e.sets || []).some(s => s.done && rirOf(s) === 0))
const hasCardio = w => (w.entries || []).some(e => modeOf({ ...(e.target || {}), id: e.id }) === 'cardio')

// The five 'first_action' milestones. Four are plain history scans (true the moment any past
// or present workout qualifies — CSV imports included). The superset check is the exception:
// a finished workout's entries drop their superset grouping (`sg`) once saved (see
// doFinishWorkout, sheets.jsx — only the live/just-finished session still has it), so that one
// only ever fires from `justFinishedLiveEntries`, never retroactively from S.workouts alone.
// An old workout that happened to include a superset before this feature existed just won't
// retroactively unlock it — there's genuinely no data left to detect it from.
const MILESTONE_CHECKS = {
  first_superset: (S, ctx) => (ctx.justFinishedLiveEntries || []).some(e => !!e.sg),
  first_dropset: S => (S.workouts || []).some(hasDropSet),
  first_cardio: S => (S.workouts || []).some(hasCardio),
  first_failure_set: S => (S.workouts || []).some(hasFailureSet),
  first_full_body: S => (S.workouts || []).some(w => isFullBodyWorkout(S, w)),
  // Friends live server-side, not in S (see lib/friends-api.js) — nothing here to re-scan
  // retroactively, so acceptFriendRequest's own success handler (views/Friends.jsx) sets this
  // one-way flag itself, the same moment it calls evaluateBadges. Once set, stays set.
  first_friend: S => !!S.badgeFlags?.addedFriend,
  // Fully retroactive — weight, girths and body-fat/muscle readings all count ("peso, contornos
  // o grasa"), and both stores already hold full history, so a CSV/Health import can unlock
  // this one same as a live log can.
  first_measurement: S => (S.bodyweight || []).length > 0 || Object.keys(S.measurements || {}).some(k => (S.measurements[k] || []).length > 0),
  // Fully retroactive — `fav` lives on the routine itself (views/Plan.jsx's star toggle), so an
  // imported plan that already carries a favourite (a future plan-share revision might) would
  // unlock this too, same as any of the other first_action checks.
  first_favorite: S => (S.routines || []).some(r => r.fav),
  // Sharing/printing a routine is an action, not a fact left behind in S.routines — same
  // situation as first_friend above, so the print button itself (RoutineEdit.jsx, Plan.jsx,
  // sheets.jsx's PlanTools) sets this one-way flag right before evaluating.
  first_share: S => !!S.badgeFlags?.sharedRoutine,
}

// One badge's current { value, target, unlocked } against S (+ ctx for the live-only checks).
function evalCondition(b, S, ctx) {
  switch (b.conditionType) {
    case 'total_workouts': { const v = totalWorkouts(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'weekly_streak': { const v = streakWeeks(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'total_volume_kg': { const v = totalVolumeKg(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'strength_score': { const v = strengthScore(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'weekly_workout_days': { const v = maxWeeklyWorkoutDays(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'monthly_workout_days': { const v = maxMonthlyWorkoutDays(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'specific_exercise_count': {
      const v = b.metric === 'repeat' ? maxExerciseRepeatCount(S) : distinctExerciseCount(S)
      return { value: v, target: b.threshold, unlocked: v >= b.threshold }
    }
    case 'first_action': {
      const check = MILESTONE_CHECKS[b.threshold]
      const done = !!check && check(S, ctx)
      return { value: done ? 1 : 0, target: 1, unlocked: done }
    }
    // 'not_yet_tracked' (currently just app_gym_location — needs the gym's real coordinates
    // and a geolocation-permission decision, see badges-data.js's comment on it) hits this
    // default on purpose: the art and copy ship today, the unlock condition ships later.
    default: return { value: 0, target: 1, unlocked: false }
  }
}

/**
 * Re-evaluates every badge against S (which must already include whatever just
 * happened — the new workout pushed, the import merged in). Returns the next S.badges map
 * and the badges that transitioned from locked to unlocked just now (for the celebration —
 * see sheets.jsx's celebrateBadges). Call from inside the same update() mutation that just
 * changed S.workouts, assigning the result back to s.badges (see doFinishWorkout/doImport).
 *
 * `justFinishedLiveEntries` — the just-finished session's *pre-save* entries (S().active's,
 * before doFinishWorkout strips them down) — is the one piece of context that can't be read
 * back out of S itself; omit it (e.g. when evaluating after an import) and superset detection
 * simply can't fire this round, which is correct — an import never carries that information.
 */
export function evaluateBadges(S, { justFinishedLiveEntries } = {}) {
  const prev = S.badges || {}
  const next = { ...prev }
  const newlyUnlocked = []
  BADGES.forEach(b => {
    if (prev[b.id]?.unlockedAt) return   // already unlocked — never re-evaluates, never locks back
    const { value, target, unlocked } = evalCondition(b, S, { justFinishedLiveEntries })
    const progress = target > 0 ? Math.max(0, Math.min(1, value / target)) : (unlocked ? 1 : 0)
    if (unlocked) {
      const unlockedAt = new Date().toISOString()
      next[b.id] = { badgeId: b.id, unlockedAt, progress: 1 }
      newlyUnlocked.push({ ...b, unlockedAt })
    } else if (progress !== (prev[b.id]?.progress || 0)) {
      next[b.id] = { badgeId: b.id, unlockedAt: null, progress }
    }
  })
  return { badges: next, newlyUnlocked }
}

/**
 * The evaluateBadges-inside-an-update() dance (see doFinishWorkout/doImport in sheets.jsx)
 * pulled out for the App-category triggers that live outside sheets.jsx — Plan.jsx's favourite
 * toggle, RoutineEdit.jsx's/Plan.jsx's/PlanTools' print-a-routine buttons, Friends.jsx's accept.
 * `mutate`, if given, runs first inside the same update() (e.g. to flip `r.fav` or set a
 * badgeFlags one-way flag) so the evaluation below already sees it. Returns newlyUnlocked,
 * ready to hand straight to celebrateBadges.
 */
export function evaluateBadgesIn(update, mutate) {
  let newlyUnlocked = []
  update(s => {
    if (mutate) mutate(s)
    const res = evaluateBadges(s)
    s.badges = res.badges
    newlyUnlocked = res.newlyUnlocked
  })
  return newlyUnlocked
}
