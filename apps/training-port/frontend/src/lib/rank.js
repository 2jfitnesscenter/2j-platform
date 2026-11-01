// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Strength rank — a 9-tier, bodyweight-adjusted rank per curated lift, rolled up into a
// rank per muscle, per muscle group, and one whole-physique rank.
//
// This app has only a handful of real users, nowhere near enough to rank someone against
// "everyone else at this gym" the way population-percentile apps do. Every rank here is
// instead computed against fixed, published-style strength-standard ratios (e1RM ÷
// bodyweight — the same idea powerlifting uses to compare weight classes), so it works
// from the very first logged set. Those ratio tables (STANDARDS below) are a reasonable
// approximation from well-known public strength benchmarks, not a licensed database —
// worth sanity-checking against real member performance before trusting them blindly.
//
// Naming note: lib/muscles.js already exports a `rankOf(load)` meaning "which muscles got
// worked, sorted" — an unrelated idea. Nothing here is ever called bare `rankOf`.

import { EXIDX } from './exercises.js'
import { musclesOf } from './muscles.js'
import { estimate1RM, bestKnownOneRM, oneRMTests } from './onerm.js'
import { lastBW } from './history.js'
import { countsForProgression } from './workout-policy.js'
import { t } from './i18n.js'

export const TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Ruby', 'Emerald', 'Diamond', 'Champion', 'Symmetric']
export const DIVISIONS = ['I', 'II', 'III']
const SYMMETRIC_INDEX = TIERS.length - 1

// One CSS custom property per tier (index.css) — flat, absolute colours, not an intensity
// ramp, so a tier reads as one specific thing everywhere it shows: the body map, the
// Profile badge, the exercise-rank cards inside Rank.jsx.
export const TIER_COLOR = {
  Iron: 'var(--tier-iron)', Bronze: 'var(--tier-bronze)', Silver: 'var(--tier-silver)',
  Gold: 'var(--tier-gold)', Ruby: 'var(--tier-ruby)', Emerald: 'var(--tier-emerald)',
  Diamond: 'var(--tier-diamond)', Champion: 'var(--tier-champion)', Symmetric: 'var(--tier-symmetric)',
}
// "Gold II", "Simétrico" (no division) — the one place a {tier, division} pair becomes text.
export const rankLabel = r => t(r.tier) + (r.division ? ' ' + r.division : '')

// public/ranks/rank_<tier>_<1|2|3>.webp — 25 illustrated emblems (Juanjo's own renders, with
// his gym's dumbbell motif), one per division except Symmetric, which has none. Filenames use
// plain digits instead of roman numerals to keep the URL free of case-sensitivity surprises.
const TIER_FILE = {
  Iron: 'iron', Bronze: 'bronze', Silver: 'silver', Gold: 'gold', Ruby: 'ruby',
  Emerald: 'emerald', Diamond: 'diamond', Champion: 'champion', Symmetric: 'symmetric',
}
const DIVISION_NUM = { I: 1, II: 2, III: 3 }
export const rankEmblemUrl = (tier, division) => division
  ? `/ranks/rank_${TIER_FILE[tier]}_${DIVISION_NUM[division]}.webp`
  : `/ranks/rank_${TIER_FILE[tier]}.webp`

// The curated lifts a rank can be computed for — not the whole exercise library. Each
// needs a published-style standard (STANDARDS below) to compare against, and most of the
// 1324-exercise dataset has no such standard to lean on.
// `bw: true` marks a lift whose logged `w` is added weight only (0 for a strict bodyweight
// set) — its effective load for ranking is bodyweight + w, not w alone (see liftRatio).
export const RANK_LIFTS = [
  { id: '0025', bw: false }, // Barbell Bench Press
  { id: '0043', bw: false }, // Barbell Back Squat ("barbell full squat")
  { id: '0032', bw: false }, // Barbell Deadlift
  { id: '1457', bw: false }, // Barbell Overhead Press ("...standing wide military press")
  { id: '0652', bw: true }, // Pull-up
  { id: '1326', bw: true }, // Chin-up
  { id: '0251', bw: true }, // Dip ("chest dip" — NOT 0814, which despite its name is a bench dip)
  { id: '0027', bw: false }, // Barbell Row
  { id: '0085', bw: false }, // Romanian Deadlift
  { id: '0031', bw: false }, // Barbell Curl
  { id: '1372', bw: false }, // Standing Barbell Calf Raise
]
const BW_LOADED = new Set(RANK_LIFTS.filter(l => l.bw).map(l => l.id))

// A member with only 2-3 of these logged shouldn't get a confident-looking global rank —
// but requiring nearly all 11 (this list is far shorter than the reference app's own
// database) would make the global rank effectively unreachable. 6 is a little over half.
export const GLOBAL_UNLOCK_MIN = 6

// 5 anchor ratios per lift, per sex — untrained/novice/intermediate/advanced/elite, in
// units of e1RM ÷ bodyweight. Linearly interpolated between (see stageFromRatio), same
// idiom as this file's sibling PCT_1RM_TABLE in onerm.js. For the three bodyweight-loaded
// lifts the ratio already includes bodyweight, so the floor is ~1.0 (barely completing one
// rep at bodyweight), not 0 — these are NOT the same shape as the barbell lifts' anchors.
export const STANDARDS = {
  '0025': { male: [0.5, 0.75, 1.0, 1.25, 1.5], female: [0.3, 0.45, 0.6, 0.75, 0.9] },
  '0043': { male: [0.75, 1.0, 1.25, 1.5, 1.75], female: [0.5, 0.75, 1.0, 1.25, 1.5] },
  '0032': { male: [1.0, 1.25, 1.5, 1.75, 2.0], female: [0.75, 1.0, 1.25, 1.5, 1.75] },
  '1457': { male: [0.35, 0.5, 0.65, 0.8, 0.95], female: [0.2, 0.3, 0.4, 0.5, 0.6] },
  '0652': { male: [1.0, 1.15, 1.35, 1.6, 2.0], female: [1.0, 1.08, 1.2, 1.35, 1.6] },
  '1326': { male: [1.0, 1.2, 1.4, 1.65, 2.05], female: [1.0, 1.1, 1.25, 1.4, 1.65] },
  '0251': { male: [1.0, 1.25, 1.5, 1.85, 2.3], female: [1.0, 1.15, 1.35, 1.55, 1.85] },
  '0027': { male: [0.5, 0.7, 0.9, 1.1, 1.3], female: [0.3, 0.45, 0.6, 0.75, 0.9] },
  '0085': { male: [0.75, 1.0, 1.25, 1.5, 1.75], female: [0.5, 0.7, 0.9, 1.1, 1.3] },
  '0031': { male: [0.3, 0.4, 0.5, 0.6, 0.7], female: [0.15, 0.22, 0.3, 0.38, 0.45] },
  '1372': { male: [0.6, 0.8, 1.0, 1.2, 1.4], female: [0.4, 0.55, 0.7, 0.85, 1.0] },
}

// Local, bodyweight-aware equivalent of onerm.js's bestKnownOneRM, for the 3 bw-loaded
// lifts only. Duplicates a little of onerm.js's set-scanning on purpose — onerm.js is
// deliberately exercise-database-agnostic, and "which exercises are bodyweight-loaded"
// is knowledge that belongs here, next to RANK_LIFTS, not there.
function bestKnownOneRMBW(S, exId, bw) {
  let best = -Infinity
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    const entry = (w.entries || []).find(e => e.id === exId)
    ;(entry?.sets || []).forEach(s => {
      if (!s.done) return
      const est = estimate1RM((s.w || 0) + bw, s.r)
      if (est !== null) best = Math.max(best, est)
    })
  })
  oneRMTests(S, exId).forEach(t => {
    const est = estimate1RM((t.w || 0) + bw, t.r)
    if (est !== null) best = Math.max(best, est)
  })
  return best === -Infinity ? null : best
}

/** e1RM ÷ bodyweight for one curated lift, or null if unrankable (no bodyweight logged
 *  yet, or no qualifying set/test on record). */
export function liftRatio(S, exId) {
  const bw = lastBW(S)?.w
  if (!(bw > 0)) return null
  const est = BW_LOADED.has(exId) ? bestKnownOneRMBW(S, exId, bw) : bestKnownOneRM(S, exId)
  return est > 0 ? est / bw : null
}

// Continuous stage 0-4 from a ratio against one lift's 5 anchors.
function stageFromRatio(ratio, anchors) {
  if (ratio <= anchors[0]) return 0
  if (ratio >= anchors[4]) return 4
  for (let i = 0; i < 4; i++) {
    if (ratio <= anchors[i + 1]) return i + (ratio - anchors[i]) / (anchors[i + 1] - anchors[i])
  }
  return 4
}

// Turn a continuous 0-24 value (4 intervals x 6 levels, or 24 = the Symmetric sentinel)
// into a displayable {tier, division}.
function levelToRank(continuous) {
  const capped = Math.min(24, Math.max(0, continuous))
  if (capped >= 24) return { tier: TIERS[SYMMETRIC_INDEX], division: null, levelIndex: 24, continuous: 24 }
  const li = Math.min(23, Math.floor(capped))
  return { tier: TIERS[Math.floor(li / 3)], division: DIVISIONS[li % 3], levelIndex: li, continuous: capped }
}

/** Rank for one lift, given its ratio (from liftRatio) and sex. Null if ratio is null or
 *  this lift has no standard for that sex. */
export function rankOfLift(exId, ratio, sex) {
  if (ratio == null) return null
  const anchors = (STANDARDS[exId] || {})[sex === 'female' ? 'female' : 'male']
  if (!anchors) return null
  // 4 anchor-intervals x 6 levels each = the 24 sub-Symmetric levels.
  return levelToRank(stageFromRatio(ratio, anchors) * 6)
}

/** Every curated lift's current rank: [{ id, rank }], rank null = not yet rankable. */
export function allLiftRanks(S) {
  return RANK_LIFTS.map(({ id }) => ({ id, rank: rankOfLift(id, liftRatio(S, id), S.body) }))
}

// Total done, non-warmup sets ever logged for one exercise — how much say its rank gets
// in its muscle's rank. Warmup sets are excluded here for the same reason lib/muscles.js's
// loadOfWorkouts excludes them from training load: a warmup was never meant to represent
// real effort. (liftRatio/bestKnownOneRM, by contrast, intentionally do NOT filter warmups
// out when finding a lift's own best set — that already matches onerm.js's existing
// best1RM behaviour, and a warmup is never going to be the heaviest set anyway.)
function totalSetsFor(S, exId) {
  let n = 0
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    const e = (w.entries || []).find(x => x.id === exId)
    ;(e?.sets || []).forEach(s => { if (s.done && s.type !== 'warmup') n++ })
  })
  return n
}

/**
 * One muscle's rank: a sets-weighted average of every curated lift that trains it
 * (primary weight 1, secondary weight 0.4, from musclesOf — the same weighting the rest
 * of the app already uses for training load), over lifts that already have a rank.
 * Null ("no data yet") if no curated lift trains this muscle at all, or none logged
 * enough to rank — several MUSCLES slugs (trapezius, serratus, obliques, adductors,
 * hip-flexors, tibialis) are never trained by RANK_LIFTS and will always read null;
 * that's a scope limit of the curated list, not a bug.
 */
// `liftRanks` (optional) is allLiftRanks(S) computed once by a caller that needs many muscles
// or groups at a time (Mi 2J, the post-workout summary) — same result, without rescanning the
// whole history once per muscle.
export function muscleRank(S, slug, liftRanks = allLiftRanks(S)) {
  let num = 0, den = 0
  liftRanks.forEach(({ id, rank }) => {
    if (!rank) return
    const w = (musclesOf(EXIDX[id]) || {})[slug]
    if (!w) return
    const sets = totalSetsFor(S, id)
    if (!sets) return
    num += w * sets * rank.continuous
    den += w * sets
  })
  return den ? levelToRank(num / den) : null
}

// The 18 MUSCLES slugs -> 6 rank groups, covering every slug exactly once.
export const RANK_GROUPS = {
  chest: ['chest'],
  back: ['upper-back', 'lower-back', 'trapezius', 'serratus'],
  shoulders: ['deltoids'],
  arms: ['biceps', 'triceps', 'forearm'],
  legs: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'],
  core: ['abs', 'obliques'],
}
export const RANK_GROUP_KEYS = Object.keys(RANK_GROUPS)
// i18n source keys — 'Chest'/'Shoulders'/'Core' already exist in locales/es.js from other
// features; 'Back' already means "go back" (nav button) elsewhere, so this reuses
// 'Back muscles' (added this session for the exercise library) instead of colliding with it.
export const RANK_GROUP_NAME = { chest: 'Chest', back: 'Back muscles', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core' }

/** A group's rank: plain mean of its muscles' rank, over muscles that have one. musclesOf
 *  never weights muscles against each other within a region either, so this mirrors that
 *  rather than inventing a second weighting scheme. Null if none of the group's muscles
 *  has any data yet. */
export function groupRank(S, groupKey, liftRanks = allLiftRanks(S)) {
  const vals = (RANK_GROUPS[groupKey] || []).map(slug => muscleRank(S, slug, liftRanks)).filter(Boolean).map(r => r.continuous)
  return vals.length ? levelToRank(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

/**
 * Whole-physique rank: the plain mean of every rankable curated lift's continuous rank —
 * averaging, not taking the best, is what makes "a complete physique outweighs one strong
 * lift" literally true. Gated behind GLOBAL_UNLOCK_MIN so 2-3 logged lifts don't produce a
 * misleadingly confident single number.
 */
export function globalRank(S, liftRanks = allLiftRanks(S)) {
  const ranks = liftRanks.map(x => x.rank).filter(Boolean)
  if (ranks.length < GLOBAL_UNLOCK_MIN) return { locked: true, rankedCount: ranks.length, needed: GLOBAL_UNLOCK_MIN }
  const avg = ranks.reduce((s, r) => s + r.continuous, 0) / ranks.length
  return { locked: false, rankedCount: ranks.length, ...levelToRank(avg) }
}

/**
 * "Did this exercise rank up?" for the post-workout summary — computed the same way
 * onerm.js's is1RMRecord computes a PR (before-vs-after, purely from history), so no
 * persisted "last seen rank" state is needed. Call with `st` = the store state from
 * BEFORE the just-finished workout `w` is pushed into s.workouts.
 */
export function rankUpsFor(st, w) {
  const bw = lastBW(st)?.w
  if (!(bw > 0)) return []
  const ups = []
  RANK_LIFTS.forEach(({ id, bw: isBW }) => {
    const entry = w.entries.find(e => e.id === id)
    if (!entry) return
    const prevRatio = liftRatio(st, id)
    const prevRank = rankOfLift(id, prevRatio, st.body)
    let bestNow = prevRatio ? prevRatio * bw : -Infinity
    entry.sets.forEach(s => {
      if (!s.done) return
      const est = estimate1RM(isBW ? (s.w || 0) + bw : (s.w || 0), s.r)
      if (est !== null) bestNow = Math.max(bestNow, est)
    })
    if (bestNow <= 0) return
    const newRank = rankOfLift(id, bestNow / bw, st.body)
    if (newRank && (!prevRank || newRank.levelIndex > prevRank.levelIndex)) ups.push({ id, prevRank, newRank })
  })
  return ups
}
