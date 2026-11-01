// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The Workout Share Card's data prep — everything the visual component needs, computed once
// from the exact same values doFinishWorkout already hands to FinishSummary (w/prs/e1prs/
// newBadges). No extra history scan, no extra store read beyond what the finish screen itself
// already did.
import { EXIDX } from './exercises.js'
import { nameFor } from './i18n.js'
import { fmtDate, fmtDur, fmtVol } from './format.js'
import { workoutVolume, setsDone } from './history.js'
import { loadOfWorkouts, muscleOptsOf } from './muscles.js'
import { MASTER_BADGE_IMAGE } from './badges-data.js'

export function buildShareCardData(S, w, prs = [], e1prs = [], newBadges = []) {
  const prIds = new Set([...prs, ...e1prs.map(p => p.id)])
  // The best (heaviest × reps) completed working set per exercise, ranked by that same
  // volume so the lifts that actually drove the session surface first — not just entry order.
  const lifts = (w.entries || []).map(e => {
    const done = (e.sets || []).filter(s => s.done && s.type !== 'warmup' && s.w > 0 && s.r > 0)
    if (!done.length) return null
    const best = done.reduce((a, b) => b.w * b.r > a.w * a.r ? b : a, done[0])
    return { id: e.id, name: EXIDX[e.id] ? nameFor(EXIDX[e.id]) : e.id, w: best.w, r: best.r, vol: best.w * best.r, isPR: prIds.has(e.id) }
  }).filter(Boolean).sort((a, b) => b.vol - a.vol)

  const totalReps = (w.entries || []).reduce((n, e) =>
    n + (e.sets || []).filter(s => s.done && s.type !== 'warmup').reduce((m, s) => m + (s.r || 0), 0), 0)

  return {
    routineName: w.name || '',
    dateLabel: fmtDate(w.d, true),
    duration: fmtDur(w.end - w.start),
    volume: fmtVol(w.vol ?? workoutVolume(w), S.unit),
    sets: setsDone(w),
    totalReps,
    prCount: prIds.size,
    lifts,
    // Capped at 4 — a session can in theory unlock more, but the card has no room to list
    // them all and this is a highlight, not a ledger (the app's own badge screen is that).
    badges: (newBadges || []).slice(0, 4).map(b => ({ id: b.id, title: b.title, image: b.image })),
    muscleLoad: loadOfWorkouts([w], null, muscleOptsOf(S)),
    // Never put profile/body data on a share card; the training map alone is enough context.
    crest: MASTER_BADGE_IMAGE,
  }
}
