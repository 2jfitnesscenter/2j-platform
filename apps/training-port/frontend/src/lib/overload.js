// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Progressive Overload Coach — a live, per-set companion to lib/progression.js's routine-level
// policy engine, not a replacement for it. `nextPrescription` (progression.js) decides what
// weight a whole SESSION starts at, once, when the workout is built, and only for exercises
// whose routine actually opted into a progression rule. This module answers a narrower,
// always-on question instead: right now, mid-set, with last time's numbers in front of you,
// what's a sane next target, and did what you just did beat it? No TypeScript in this project
// (plain .js/.jsx, no tsconfig) — documented the same way every other lib/*.js module is.
import { stepWeight } from './equipment.js'
import { estimate1RM, bestKnownOneRM } from './onerm.js'
import { modeOf, recentEntriesFor, warmupSets, workingLoadEvidence } from './history.js'

/**
 * The two-branch coaching suggestion the brief asks for: hit the top of your rep target last
 * time -> suggest the next loadable weight up (lib/equipment.js's own stepWeight, so it's a
 * real barbell/dumbbell/machine jump, not a guessed "+1-2kg"), same reps; fell short -> hold
 * the weight and suggest one more rep. `topReps` is the exercise's configured rep ceiling (a
 * range's max, or the plain target reps) — null when there's no reference to compare against.
 */
export function suggestOverload(S, eq, last, topReps) {
  if (!last || !last.sets?.length) return null
  const evidence = workingLoadEvidence(last.sets)
  const ref = evidence.first
  if (!ref) return null
  if (!(ref.w > 0) || !(ref.r > 0)) return null
  const hitTop = topReps ? ref.r >= topReps : true
  return hitTop && !evidence.highEffort
    ? { w: stepWeight(S, eq, ref.w, 1), r: ref.r, strategy: 'weight' }
    : { w: ref.w, r: ref.r + 1, strategy: 'volume' }
}

/**
 * Did this just-logged set beat the equivalent one (same working-set position) from last time —
 * more weight at the same or better reps, or the same weight with more reps? Either counts as
 * "sobrecarga lograda"; a set with nothing to compare against (no prior set at that position)
 * never does.
 */
export function isOverloadSet(lastSet, set) {
  if (!lastSet || !set || !(set.w > 0) || !(set.r > 0)) return false
  if (!(lastSet.w > 0)) return false
  const moreWeight = set.w > lastSet.w && set.r >= lastSet.r
  const moreReps = set.w >= lastSet.w && set.r > lastSet.r
  return moreWeight || moreReps
}

/**
 * Does this set's estimated 1RM beat the exercise's best known 1RM on record? A weight-only
 * set (bodyweight, or more reps than onerm.js's REP_CAP can honestly estimate from) simply
 * never produces an estimate, so it never flags as a PR here — same restraint estimate1RM
 * itself applies everywhere else in the app.
 */
export function isPotentialPR(S, exId, set) {
  const est = estimate1RM(set.w, set.r)
  if (est == null) return false
  const best = bestKnownOneRM(S, exId)
  return best == null || est > best
}

/* ---------------------------------------------------------------------------------------------
 * Intelligent progression V1 — the same assistant, grown from one chip into an explained
 * recommendation. Deterministic and read-only: it looks at the member's own recent sessions of
 * THIS exercise id (lib/history.js's recentEntriesFor — working sets actually done, warmups and
 * drops excluded), the prescription snapshot (entry.target), the real RPE/RIR logged and the
 * loadable increments of the equipment (stepWeight), and says what it would do next and why.
 * It never writes anything: applying it is the member's explicit choice, and even then only the
 * live session's unfinished sets change — never the routine (see acceptRecommendation).
 *
 * Rules, in order (first match wins). `W` is the first completed working weight of the last session, `min`/`max`
 * the rep target (a range, or the single prescribed number for both), "in range" means every
 * prescribed set was done with at least `min` reps, "top" every set with at least `max`.
 *   1. no previous session, or not a weight × reps exercise → no recommendation
 *   2. last two sessions both short of the range at ≥ W     → lower the weight one step
 *   3. last session short of the range at RPE 10 (failure)  → lower the weight one step
 *   4. last session short of the range                      → keep W, aim for `min`
 *   5. top of the range but RPE ≥ 9.5                       → keep W (consolidate first)
 *   6. top of the range                                     → one loadable step up, reps back
 *                                                             to `min` (bodyweight or top of
 *                                                             the rack: one more rep instead)
 *   7. inside the range (min < max) but RPE ≥ 9.5           → keep W and the same reps
 *   8. inside the range                                     → keep W, one more rep (≤ max)
 * Confidence, from the evidence behind the decision — never a made-up percentage:
 *   high   — the previous session showed the same outcome at the same weight, or (for a step
 *            up) an RPE ≤ 8 was logged
 *   low    — a single session on record and no RPE logged at all
 *   medium — everything else, and always for a step down or an RPE-driven hold
 * ------------------------------------------------------------------------------------------- */
const rpeOf = s => s.rpe != null ? s.rpe : s.rir != null ? 10 - s.rir : null
const fmt = v => String(Math.round(v * 100) / 100)

function readRecent(sets, target, min, max) {
  const reps = sets.map(s => s.r || 0)
  const low = reps.length ? Math.min(...reps) : 0
  const complete = sets.length >= (target.sets || sets.length)
  const rpes = sets.map(rpeOf).filter(v => v != null)
  return {
    ...workingLoadEvidence(sets), W: workingLoadEvidence(sets).weight, reps, low,
    rpe: rpes.length ? Math.max(...rpes) : null,
    inRange: complete && low >= min,
    top: complete && low >= max,
  }
}

export function recommendProgression(S, entry, eq) {
  const target = entry.target || {}
  if (modeOf({ ...target, id: entry.id }) !== 'reps') return null
  const max = target.targetRepsMax ?? target.reps ?? null
  if (!(max > 0)) return null
  const min = Math.min(target.targetRepsMin ?? target.repsMin ?? max, max)
  const recent = recentEntriesFor(S, entry.id, 2)
  if (!recent.length) return null
  const unit = S.unit || 'kg'
  const last = readRecent(recent[0].sets, target, min, max)
  const prev = recent[1] ? readRecent(recent[1].sets, target, min, max) : null
  const bw = !(last.W > 0)
  const sameAs = test => !!prev && prev.W === last.W && test(prev)
  const conf = support => support ? 'high' : (!prev && last.rpe == null ? 'low' : 'medium')
  const repsTxt = last.reps.join(', ')
  const out = (kind, w, r, confidence, why) => ({ kind, w, r, confidence, why,
    ...(last.weights.some(x => x !== last.W) ? { weights: last.weights.map(x => w === last.W ? x : (stepWeight(S, eq, x, w > last.W ? 1 : -1))) } : {}) })

  if (!last.inRange) {
    if (!bw && prev && !prev.inRange && prev.W >= last.W) {
      const w = stepWeight(S, eq, last.W, -1)
      if (w < last.W) return out('down', w, min, 'medium', ['Two sessions in a row short of {0} reps with {1} {2} — step down and build back up.', min, fmt(last.W), unit])
    }
    if (!bw && last.rpe != null && last.rpe >= 10) {
      const w = stepWeight(S, eq, last.W, -1)
      if (w < last.W) return out('down', w, min, 'medium', ['Last time went to failure (RPE 10) without reaching {0} reps — step down a little.', min])
    }
    return out('hold', last.W, min, conf(sameAs(p => !p.inRange)), bw
      ? ['Last time: {0} reps. Same target until every set reaches {1}.', repsTxt, min]
      : ['Last time with {0} {1}: {2} reps. Stay here until every set reaches {3}.', fmt(last.W), unit, repsTxt, min])
  }
  if (last.highEffort && last.inRange) return out('hold', last.W, last.low, 'medium', ['High RPE or difficult feedback — repeat the first working load.'])
  if (last.top) {
    if (last.highEffort || (last.rpe != null && last.rpe >= 9.5)) return out('hold', last.W, max, 'medium',
      ['You hit the target, but at RPE {0} — consolidate {1} {2} before adding load.', fmt(last.rpe), fmt(last.W), unit])
    const twice = sameAs(p => p.top)
    const support = last.safeToIncrease && (!twice || prev.safeToIncrease)
    if (!bw && !support) return out('hold', last.W, max, 'low', ['Repeat the first working load until two sessions support a safe increase.'])
    if (bw) return out('reps', 0, max + 1, conf(support), ['Every set reached {0} reps — go for {1}.', max, max + 1])
    const w = stepWeight(S, eq, last.W, 1)
    if (w <= last.W) return out('reps', last.W, max + 1, conf(support), ['Top of the range with the heaviest load available — add a rep instead.'])
    return out('up', w, min, conf(support), twice
      ? ['You completed {0} {1} × {2} within the target in your last two sessions.', fmt(last.W), unit, repsTxt]
      : ['You completed {0} {1} × {2} within the target last time.', fmt(last.W), unit, repsTxt])
  }
  if (last.rpe != null && last.rpe >= 9.5) return out('hold', last.W, last.low, 'medium',
    ['Inside the range, but at RPE {0} — same numbers again before pushing.', fmt(last.rpe)])
  return out('reps', last.W, Math.min(max, last.low + 1), conf(sameAs(p => p.inRange) && (last.rpe == null || last.rpe <= 9)),
    ['Inside the {0}-{1} range ({2}) — one more rep before adding weight.', min, max, repsTxt])
}

// Does the live session already prescribe exactly this? Then there is nothing to offer.
export function recommendationMatches(entry, rec) {
  const work = entry.sets.filter(s => s.type !== 'warmup' && s.type !== 'drop' && !s.done)
  return work.length > 0 && work.every((s, i) => (s.w || 0) === (rec.weights?.[i] ?? rec.weights?.at(-1) ?? rec.w) && (s.r || 0) === rec.r)
}

// Offered only for a live session, before the exercise's first working set, once per exercise,
// and only when it would actually change something.
export function recommendationFor(S, entry, eq, { past = false } = {}) {
  if (past || S.enableProgressiveOverloadCoach === false || entry.rec) return null
  if (entry.sets.some(s => s.done && s.type !== 'warmup')) return null
  const rec = recommendProgression(S, entry, eq)
  return rec && !recommendationMatches(entry, rec) ? rec : null
}

// "Use recommendation": the unfinished working sets of THIS session take the numbers, and a
// still-untouched warmup ramp is rebuilt for the new load. The routine, entry.target and
// entry.plan stay exactly as they were; the choice is remembered on the entry so the card is not
// offered again, and it does not survive into the finished workout (doFinishWorkout copies only
// id/sets/topW/target).
export function acceptRecommendation(entry, rec, unit) {
  let workIndex = 0
  entry.sets.forEach(s => {
    if (s.done || s.type === 'warmup' || s.type === 'drop') return
    s.w = rec.weights?.[workIndex] ?? rec.weights?.at(-1) ?? rec.w
    workIndex++
    s.r = rec.r
  })
  const warm = entry.sets.filter(s => s.type === 'warmup')
  if (warm.length && !warm.some(s => s.done) && rec.w > 0) {
    const ramp = warmupSets(rec.w, unit)
    if (ramp.length === warm.length) {
      let k = 0
      entry.sets = entry.sets.map(s => s.type === 'warmup' ? ramp[k++] : s)
    }
  }
  entry.rec = { kind: rec.kind, w: rec.w, r: rec.r, status: 'accepted' }
}
// "Keep plan": nothing changes but the card is dismissed for this exercise in this session.
export function keepPlan(entry, rec) {
  entry.rec = { kind: rec.kind, w: rec.w, r: rec.r, status: 'kept' }
}
