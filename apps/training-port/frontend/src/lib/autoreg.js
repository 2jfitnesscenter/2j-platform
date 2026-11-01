// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Autoregulation — a small layer ON TOP of lib/progression.js (not a second engine): how hard the completed sessions really felt can nudge the next load.
// One scale: RPE higher = harder, RIR lower = harder (RPE = 10 − RIR). Never decided by one set or one session; always with a visible reason.
//   easy   the last 3 sessions were all completed (every rep) and each had ≥ 2 rated sets averaging RPE ≤ 7 (RIR ≥ 3) → the planned step may be bigger
//          (one more real step on top of the planned one, at most +15 % over the last load), only on policies that were already going up
//   grind  the last 2 sessions were completed but averaged RPE ≥ 9 (RIR ≤ 1) on ≥ 2 rated sets each → hold the load instead of adding more
//   nothing otherwise (unrated sessions, a single session, mixed signals)
export const EASY_RPE = 7
export const GRIND_RPE = 9
export const MIN_RATED = 2

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** RPE-scale effort of one set, or null when none was logged. */
export const setEffort = s => (num(s?.rpe) != null ? s.rpe : num(s?.rir) != null ? 10 - s.rir : null)

/** { effort, rated } of a session's done working sets: the mean effort and how many sets carried one. */
export function effortStats(sets) {
  const e = (sets || []).filter(s => s && s.done && s.type !== 'warmup' && s.type !== 'drop').map(setEffort).filter(x => x != null)
  return { effort: e.length ? e.reduce((a, b) => a + b, 0) / e.length : null, rated: e.length }
}

/** sessions: oldest first, each { ok, effort, rated } (lib/progression.js readSession). → { kind: 'easy' | 'grind' | null, effort } */
export function effortSignal(sessions) {
  const usable = s => s && s.ok && s.rated >= MIN_RATED && s.effort != null
  const last3 = (sessions || []).slice(-3)
  if (last3.length === 3 && last3.every(s => usable(s) && s.effort <= EASY_RPE)) return { kind: 'easy', effort: Math.max(...last3.map(s => s.effort)) }
  const last2 = (sessions || []).slice(-2)
  if (last2.length === 2 && last2.every(s => usable(s) && s.effort >= GRIND_RPE)) return { kind: 'grind', effort: Math.min(...last2.map(s => s.effort)) }
  return { kind: null, effort: null }
}
