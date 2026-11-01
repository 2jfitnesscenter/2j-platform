// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Home Alive — what Home should lead with RIGHT NOW, derived from the plan and the log (no new data, no stored flags).
import { effectiveRoutine } from './history.js'
import { isoOf } from './format.js'
import { postWorkoutEvents } from './mi2j.js'
import { describeEvent } from '../components/Mi2JEvents.jsx'

const HOUR = 3600e3

/** The next day (after `from`, within a week) that has a routine planned: { iso, routine, inDays } — for a rest day. */
export function nextPlannedSession(S, from = new Date()) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i)
    const iso = isoOf(d)
    const routine = effectiveRoutine(S, iso)
    if (routine) return { iso, date: d, routine, inDays: i }
  }
  return null
}

/** The latest finished workout if it ended less than `hours` ago (the "just finished" moment of Home); otherwise null. */
export function justFinished(S, now = Date.now(), hours = 3) {
  const w = (S.workouts || [])[(S.workouts || []).length - 1]
  return w && w.end && now - w.end >= 0 && now - w.end < hours * HOUR ? w : null
}

/** A record set in the last `hours` (default 36): { w, event: describeEvent(…) } for the best new PR of that workout — Home celebrates it briefly, then moves on. */
export function recentRecord(S, now = Date.now(), hours = 36) {
  const w = (S.workouts || [])[(S.workouts || []).length - 1]
  if (!w || !w.end || now - w.end > hours * HOUR || now - w.end < 0) return null
  let ev = null
  try { ev = postWorkoutEvents(S, w.id).find(e => e.type === 'pr') } catch { ev = null }
  if (!ev) return null
  const d = describeEvent(ev, S.unit)
  return { w, title: d.title, value: d.result }
}
