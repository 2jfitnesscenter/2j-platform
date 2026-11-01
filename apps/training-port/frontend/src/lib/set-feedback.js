// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Series Feedback V1 — "how did that set feel?" after a logged set, and a conservative,
// deterministic suggestion for the NEXT set of the same exercise in this session only.
//
// It is a helper, never an automatic change: nothing is written unless the member accepts, and
// then only the next set's weight in S.active changes — never the routine, its target, the
// program or future workouts. Loads come from lib/equipment.js (stepWeight / realizableToward),
// the same real increments as the set pad and Progressive Overload V1, so a 5 kg machine stack
// never gets "+2.5". The feeling is stored on the set (`feel`, optional); it does not replace
// or rewrite RPE/RIR — a logged effort is only read as a brake (see `effortSaysHard`).
import { stepWeight, realizableToward } from './equipment.js'

export const FEELINGS = ['easy', 'good', 'hard', 'fail']
export const FEELING_LABEL = { easy: 'Very easy', good: 'Felt good', hard: 'Felt hard', fail: 'Couldn’t do it' }

const isWork = s => s && s.type !== 'warmup'
/** Rep target of an entry: [bottom, top]; null when the entry has no rep target. */
export function repTarget(entry) {
  const tg = entry?.target || {}
  const top = Number(tg.targetRepsMax || tg.reps) || null
  if (!top) return null
  const bottom = Math.min(Number(tg.targetRepsMin || tg.repsMin) || top, top)
  return [bottom, top]
}
// A logged effort that says the set was near the limit (RPE ≥ 9 or RIR ≤ 1) wins over "very
// easy": the suggestion then holds the weight instead of going up.
const effortSaysHard = set => (set.rpe != null && set.rpe >= 9) || (set.rir != null && set.rir <= 1)

/** Index of the next unfinished working set after `i`, or -1. */
export function nextWorkIndex(entry, i) {
  return entry.sets.findIndex((s, k) => k > i && !s.done && isWork(s))
}

/**
 * The set the feedback row is about right now: the latest finished working set that still has
 * an unfinished working set after it and is waiting for a feeling or a decision. -1 when none.
 */
export function feedbackIndex(entry, mode) {
  if (mode !== 'reps' || !entry?.sets?.length) return -1
  for (let i = entry.sets.length - 1; i >= 0; i--) {
    const s = entry.sets[i]
    if (!s.done || !isWork(s)) continue
    if (nextWorkIndex(entry, i) < 0) return -1
    return (!s.feel || !s.fbDone) ? i : -1
  }
  return -1
}

/**
 * Suggestion for the next working set after set `i`, from its feeling. null when there is
 * nothing to suggest (no feeling yet, no next set, no load, or the next set already matches).
 * @returns {{ nextIdx, from, to, kind: 'up'|'keep'|'down', why: [string, ...args] } | null}
 */
export function nextSetSuggestion(S, entry, i, eq) {
  const set = entry?.sets?.[i]
  if (!set || !set.done || !set.feel || !(set.w > 0)) return null
  const nextIdx = nextWorkIndex(entry, i)
  if (nextIdx < 0) return null
  const w = set.w, r = Number(set.r) || 0
  const [bottom, top] = repTarget(entry) || [r, r]
  let to = w, kind = 'keep', why = ['Keep the same load for the next set.']
  if (set.feel === 'easy') {
    if (r >= top && !effortSaysHard(set)) {
      const up = stepWeight(S, eq, w, 1)
      if (up > w) { to = up; kind = 'up'; why = ['All reps done and it felt very easy: one real step up.'] }
      else why = ['Already at the top of this equipment: keep the load.']
    } else if (r < top) why = ['Very easy but short of the rep target: keep the load and aim for {0} reps.', top]
    else why = ['Your logged effort was high: keep the load.']
  } else if (set.feel === 'hard') {
    if (r < bottom) {
      const down = stepWeight(S, eq, w, -1)
      if (down < w) { to = down; kind = 'down'; why = ['Hard and below the rep range: one step down.'] }
    } else why = ['Hard but within the rep range: keep the load.']
  } else if (set.feel === 'fail') {
    // About 10 % lighter, on a load the equipment can really make; at least one step down.
    // The 10 % is a practical 2J V1 heuristic for "reset and finish the set", not a universal
    // scientific rule; the member decides (accept/keep) and the program is never changed.
    const target = realizableToward(S, eq, w, w * 0.9)
    const oneDown = stepWeight(S, eq, w, -1)
    const down = target != null && target < w ? Math.min(target, oneDown) : oneDown
    if (down < w) { to = down; kind = 'down'; why = ['Couldn’t complete it: about 10 % lighter.'] }
  }
  const from = entry.sets[nextIdx].w || 0
  if (to === from) return null
  return { nextIdx, from, to, kind, why }
}

/** Record the feeling on set `i` (and reopen its decision). Pure mutation of the entry. */
export function setFeeling(entry, i, feel) {
  const s = entry.sets[i]
  if (!s || !FEELINGS.includes(feel)) return
  s.feel = feel
  delete s.fbDone
}
/** Accept: only the next working set's weight changes. */
export function acceptSuggestion(entry, i, sug) {
  if (!sug || !entry.sets[sug.nextIdx] || entry.sets[sug.nextIdx].done) return
  entry.sets[sug.nextIdx].w = sug.to
  entry.sets[i].fbDone = 'accepted'
}
/** Keep: nothing changes but the row closes. */
export function keepPlannedLoad(entry, i) {
  if (entry.sets[i]) entry.sets[i].fbDone = 'kept'
}
