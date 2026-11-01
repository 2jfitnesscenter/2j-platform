// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Mi 2J — the member's sporting identity, derived. Nothing here is a new source of truth:
// ranks come from lib/rank.js, badges from S.badges (lib/badges.js keeps it), records from the
// logged history (the same heaviest-set rule doFinishWorkout has always used for `w.prs`, and
// lib/onerm.js for estimated 1RMs), the streak from lib/history.js's streakWeeks. Home, the Mi 2J
// screens and the post-workout summary all read through these helpers, so the three surfaces
// can never disagree.
import { TIERS, DIVISIONS, RANK_GROUP_KEYS, RANK_GROUPS, RANK_LIFTS, allLiftRanks, groupRank, globalRank } from './rank.js'
import { BADGES, BADGE_BY_ID } from './badges-data.js'
import { evaluateBadges } from './badges.js'
import { estimate1RM, is1RMRecord } from './onerm.js'
import { modeOf, lastBW, streakWeeks, activeWeek } from './history.js'
import { musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'
import { weekKey, todayISO } from './format.js'
import { countsForProgression } from './workout-policy.js'

/* ------------------------------------------------------------------ ranks --- */

// The rank system is continuous underneath (lib/rank.js's 0-24 scale, 3 divisions per tier),
// so "how far into this division" is a real number, not a made-up bar: continuous − levelIndex.
export function nextRankOf(rank) {
  if (!rank || rank.division == null) return null            // Symmetric is the top
  const li = rank.levelIndex + 1
  if (li >= 24) return { tier: TIERS[TIERS.length - 1], division: null, levelIndex: 24 }
  return { tier: TIERS[Math.floor(li / 3)], division: DIVISIONS[li % 3], levelIndex: li }
}
export const rankProgress = rank => rank && rank.division != null ? Math.max(0, Math.min(1, rank.continuous - rank.levelIndex)) : 1
// What kind of step a rank change is: a new division inside the same tier (Ruby I → Ruby II),
// a new tier (Emerald III → Ruby I — the family changes, celebrated more), or a first rank.
export function rankChange(prev, next) {
  if (!next) return null
  if (!prev) return 'new'
  if (next.levelIndex <= prev.levelIndex) return null
  return prev.tier !== next.tier ? 'tier' : 'division'
}

// Everything the rank screens show, computed with one pass over the lifts.
export function rankSnapshot(S) {
  const hasBW = !!(lastBW(S)?.w > 0)
  const lifts = allLiftRanks(S)
  const global = globalRank(S, lifts)
  const groups = RANK_GROUP_KEYS.map(key => {
    const rank = groupRank(S, key, lifts)
    const slugs = RANK_GROUPS[key]
    const contributing = lifts.filter(l => l.rank && slugs.some(slug => (musclesOf(EXIDX[l.id]) || {})[slug] >= 1))
    const trainable = RANK_LIFTS.filter(l => slugs.some(slug => (musclesOf(EXIDX[l.id]) || {})[slug] >= 1)).map(l => l.id)
    return { key, rank, next: nextRankOf(rank), progress: rank ? rankProgress(rank) : 0, contributing, trainable }
  })
  return { hasBW, lifts, global, groups, rankedCount: lifts.filter(l => l.rank).length }
}

/* ---------------------------------------------------------------- records --- */

const isRepsEntry = e => modeOf({ ...(e.target || {}), id: e.id }) === 'reps'
// The heaviest completed set of one entry (ties: more reps) — the same "heaviest weight" rule
// doFinishWorkout uses to decide a PR.
function heaviestSet(entry) {
  let best = null
  ;(entry?.sets || []).forEach(s => {
    if (!s.done || !(s.w > 0)) return
    if (!best || s.w > best.w || (s.w === best.w && (s.r || 0) > best.r)) best = { w: s.w, r: s.r || 0 }
  })
  return best
}

// Per exercise: the real heaviest set on record (weight × reps, date), the heaviest before that
// one (so the step up can be shown honestly), and — separately, never mixed in — the best
// ESTIMATED 1RM. One chronological pass over the history.
export function personalRecords(S) {
  const by = new Map()
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    ;(w.entries || []).forEach(e => {
    if (!isRepsEntry(e)) return
    const set = heaviestSet(e)
    if (!set) return
    let rec = by.get(e.id)
    if (!rec) { rec = { id: e.id, best: null, previous: null, e1rm: null, sessions: 0 }; by.set(e.id, rec) }
    rec.sessions++
    if (!rec.best || set.w > rec.best.w || (set.w === rec.best.w && set.r > rec.best.r)) {
      if (rec.best && set.w > rec.best.w) rec.previous = rec.best
      rec.best = { ...set, d: w.d, workoutId: w.id }
    }
    ;(e.sets || []).forEach(s => {
      if (!s.done) return
      const est = estimate1RM(s.w, s.r)
      if (est != null && (!rec.e1rm || est > rec.e1rm.est)) rec.e1rm = { est, w: s.w, r: s.r, d: w.d }
    })
    })
  })
  return [...by.values()].sort((a, b) => (a.best.d < b.best.d ? 1 : a.best.d > b.best.d ? -1 : 0))
}

/* ------------------------------------------------------ post-workout events --- */

// Most important first. Hero-worthy (`major`) are only the moments that change the member's
// family or overall standing: a new tier (e.g. Emerald → Ruby) or the overall rank unlocking.
export const EVENT_PRIORITY = { pr: 1, e1rm: 1.2, global: 2, rank: 2.1, lift: 2.5, badge: 3, streak: 4 }

// Streak weeks worth a post-workout moment: 2, 4, 8, 12, 26, 52, then every further year
// (104, 156 …). The streak itself shows as usual everywhere else.
export const STREAK_MILESTONES = [2, 4, 8, 12, 26, 52]
export const isStreakMilestone = weeks => STREAK_MILESTONES.includes(weeks) || (weeks > 52 && weeks % 52 === 0)

function heaviestBefore(S, exId) {
  let best = null
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    ;(w.entries || []).forEach(e => {
    if (e.id !== exId) return
    const set = heaviestSet(e)
    if (set && (!best || set.w > best.w || (set.w === best.w && set.r > best.r))) best = { ...set, d: w.d }
    if (e.topW > 0 && (!best || e.topW > best.w)) best = { w: e.topW, r: null, d: w.d }
    })
  })
  return best
}

/**
 * The events one finished workout produced, derived deterministically from the state that
 * contains it: "before" is the same state without that workout. Used right after a finish and,
 * identically, if the app was closed before the member saw them (lib/celebrations.js keeps only
 * the workout id and the badge ids that unlocked with it). Returns [] for an unknown workout.
 * `badgeIds` are the badges evaluateBadges reported as newly unlocked by that finish.
 */
export function postWorkoutEvents(S, workoutId, badgeIds = []) {
  const w = (S.workouts || []).find(x => x.id === workoutId)
  if (!w) return []
  const before = { ...S, workouts: S.workouts.filter(x => x.id !== workoutId) }
  const events = []
  const push = (type, key, data, major = false) => events.push({ id: `${workoutId}:${type}:${key}`, type, priority: EVENT_PRIORITY[type], major, data })

  // Records: the workout's own `prs` (doFinishWorkout's heaviest-weight rule), but only against a
  // real previous best — a first-ever log of an exercise is a baseline, not a record.
  const prIds = new Set()
  ;(countsForProgression(w) ? w.prs || [] : []).forEach(id => {
    const entry = w.entries.find(e => e.id === id)
    const now = heaviestSet(entry)
    const prev = heaviestBefore(before, id)
    if (!now || !prev || !(prev.w > 0) || !(now.w > prev.w)) return
    prIds.add(id)
    push('pr', id, { exId: id, now, prev })
  })
  // A better estimated 1RM without a heavier set (same weight, more reps) — labelled as an
  // estimate everywhere it shows.
  ;(countsForProgression(w) ? w.entries : []).forEach(e => {
    if (prIds.has(e.id) || !isRepsEntry(e)) return
    const rec = is1RMRecord(before, e.id, e)
    if (rec && rec.prev > 0) push('e1rm', e.id, { exId: e.id, est: rec.est, w: rec.w, r: rec.r, prev: rec.prev })
  })

  // Ranks — only with a bodyweight on file (lib/rank.js needs it for every ratio).
  if (lastBW(S)?.w > 0) {
    const liftsB = allLiftRanks(before), liftsA = allLiftRanks(S)
    const gB = globalRank(before, liftsB), gA = globalRank(S, liftsA)
    if (gB.locked && !gA.locked) push('global', 'unlock', { prev: null, next: gA, change: 'new' }, true)
    else if (!gA.locked && !gB.locked && gA.levelIndex > gB.levelIndex) {
      const change = rankChange(gB, gA)
      push('global', 'up', { prev: gB, next: gA, change }, change === 'tier')
    }
    RANK_GROUP_KEYS.forEach(key => {
      const prev = groupRank(before, key, liftsB), next = groupRank(S, key, liftsA)
      const change = rankChange(prev, next)
      if (change) push('rank', key, { group: key, prev, next, change }, change === 'tier')
    })
    // A single lift's step only when none of the groups it trains already told the story
    // (bench press moving the chest group is one event, not two).
    const movedGroups = new Set(events.filter(e => e.type === 'rank').map(e => e.data.group))
    liftsA.forEach(({ id, rank }) => {
      if (!w.entries.some(e => e.id === id)) return
      const trains = RANK_GROUP_KEYS.filter(k => RANK_GROUPS[k].some(slug => (musclesOf(EXIDX[id]) || {})[slug] >= 1))
      if (trains.some(k => movedGroups.has(k))) return
      const prev = liftsB.find(l => l.id === id)?.rank || null
      const change = rankChange(prev, rank)
      if (change && change !== 'new') push('lift', id, { exId: id, prev, next: rank, change })
    })
  }

  badgeIds.forEach(id => {
    const b = BADGE_BY_ID[id]
    const state = (S.badges || {})[id]
    if (b && state?.unlockedAt) push('badge', id, { badge: b, unlockedAt: state.unlockedAt })
  })

  // Constancy, never blame: celebrated only when the streak (streakWeeks, unchanged) has just
  // grown onto a milestone — not on every first session of a week.
  const s0 = streakWeeks(before), s1 = streakWeeks(S)
  if (s1 > s0 && isStreakMilestone(s1)) push('streak', String(s1), { weeks: s1 })

  return events.sort((a, b) => a.priority - b.priority)
}
export const heroEvent = events => events.find(e => e.major) || null

/* ------------------------------------------------------------------ home --- */

export function weekSummary(S, iso = todayISO()) {
  const wk = weekKey(iso)
  const days = new Set((S.workouts || []).filter(w => weekKey(w.d) === wk).map(w => w.d))
  return { done: days.size, sessions: (S.workouts || []).filter(w => weekKey(w.d) === wk).length, planned: Object.values(activeWeek(S)).filter(Boolean).length, streak: streakWeeks(S) }
}

// The latest workout's most important event, if it is recent — Home's "last step forward".
export function latestAdvance(S, { days = 10, iso = todayISO() } = {}) {
  const ws = S.workouts || []
  const last = ws[ws.length - 1]
  if (!last) return null
  const age = (new Date(iso + 'T12:00:00') - new Date(last.d + 'T12:00:00')) / 86400000
  if (age > days) return null
  const ev = postWorkoutEvents(S, last.id).find(e => e.type !== 'streak')
  return ev ? { ...ev, d: last.d } : null
}

// Home's "close to": the rank group nearest its next division (only once it is past half way),
// else the locked badge closest to unlocking (from the same evaluation the Badges screen uses).
export function closestGoal(S, snapshot = rankSnapshot(S)) {
  const group = snapshot.groups.filter(g => g.rank && g.next && g.progress >= 0.5).sort((a, b) => b.progress - a.progress)[0]
  if (group) return { type: 'rank', group }
  const badge = closestBadges(S, 1)[0]
  return badge && badge.progress >= 0.5 ? { type: 'badge', ...badge } : null
}

// Locked badges by how close they are, without writing anything (evaluateBadges is pure).
export function closestBadges(S, n = 3) {
  const { badges } = evaluateBadges(S)
  return BADGES.map(b => ({ badge: b, progress: badges[b.id]?.unlockedAt ? 1 : (badges[b.id]?.progress || 0) }))
    .filter(x => x.progress < 1 && x.progress > 0 && x.badge.conditionType !== 'not_yet_tracked')
    .sort((a, b) => b.progress - a.progress).slice(0, n)
}
export const unlockedBadges = S => BADGES.filter(b => S.badges?.[b.id]?.unlockedAt)
  .map(b => ({ badge: b, unlockedAt: S.badges[b.id].unlockedAt }))
  .sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))
