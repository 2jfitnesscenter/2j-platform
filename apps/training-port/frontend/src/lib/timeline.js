// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Progress timeline: the member's latest sessions with what each one earned (records, ranks, achievements), newest first.
// Pure derivation over S.workouts — no new stored data. Visibility = admin 'timeline' ∧ member preference ∧ data presence.
import { postWorkoutEvents } from './mi2j.js'
import { setsDone } from './history.js'
import { uxOn } from './features.js'
import { healthMoments } from './health-v2.js'

// Badges are stamped with their unlock time, not the workout id: the ones unlocked while/just after this session.
const badgesOf = (S, w) => Object.keys(S.badges || {}).filter(id => { const at = Date.parse(S.badges[id]?.unlockedAt); return Number.isFinite(at) && w.start && at >= w.start && at <= (w.end || w.start) + 10 * 60 * 1000 })

/** [{ id, d, name, sets, vol, events: [{type,…}] }] — at most `max` sessions; [] when off or when there is no history. */
export function progressTimeline(S, { max = 6 } = {}) {
  if (!uxOn(S, 'timeline')) return []
  const ws = (S.workouts || []).slice(-max).reverse()
  return ws.map(w => ({
    id: w.id, d: w.d, name: w.name, sets: setsDone(w), vol: w.vol || 0,
    events: postWorkoutEvents(S, w.id, badgesOf(S, w)),     // records, ranks, achievements and streak milestones (all rare enough not to be noise)
  }))
}

/** Health timeline: the latest sessions (with their records) merged with the member's real body moments — a relevant weight
 *  change and body-composition scans — newest first and capped, so it reads as history rather than a log of every reading.
 *  Same 'timeline' gates as progressTimeline. */
export function healthTimeline(S, { max = 8 } = {}) {
  if (!uxOn(S, 'timeline')) return []
  const sessions = progressTimeline(S, { max }).map(i => ({ kind: 'workout', ...i }))
  return [...sessions, ...healthMoments(S, { max })].sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0).slice(0, max)
}
