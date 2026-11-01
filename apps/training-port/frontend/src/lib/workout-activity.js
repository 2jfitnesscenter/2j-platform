// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
export const WORKOUT_INACTIVITY_MS = 60 * 60 * 1000
export const INACTIVITY_FINISH_REASON = 'inactivity_timeout'

// Only workout edits/navigation, never clock ticks, polling or unrelated preferences.
export function workoutActivityKey(active) {
  if (!active || active.past) return null
  const { id, cur, entries, swaps, guided, guidedLog } = active
  return JSON.stringify({ id, cur, entries, swaps, guided, guidedLog })
}
export function lastWorkoutActivity(active) {
  const value = active?.lastActivityAt ?? active?.start
  return Number.isFinite(value) && value > 0 ? value : null
}
export function workoutInactive(active, now = Date.now()) {
  const at = lastWorkoutActivity(active)
  return !!active && !active.past && at !== null && now - at >= WORKOUT_INACTIVITY_MS
}
export function stampWorkoutActivity(before, after, now = Date.now()) {
  if (!after || after.past) return after
  if (workoutActivityKey(before) !== workoutActivityKey(after)) return { ...after, lastActivityAt: now }
  return { ...after, ...(before?.lastActivityAt ? { lastActivityAt: before.lastActivityAt } : {}) }
}
export function inactivityFinishMetadata(active, now = Date.now()) {
  // Existing statistics use end-start. New tracked sessions exclude the idle tail;
  // legacy sessions have no reliable last-edit evidence and keep the normal end convention.
  return { finishReason: INACTIVITY_FINISH_REASON, finishedAt: now,
    end: Number.isFinite(active.lastActivityAt) ? Math.max(active.start, Math.min(now, active.lastActivityAt)) : now }
}

// The existing Bunker finish payload, shared unchanged by kiosk and server sweep.
export function buildFinishedWorkout(active, end = Date.now()) {
  const w = { id: active.id, d: active.d, start: active.start, end,
    routineId: active.routineId, name: active.name, bw: active.bw,
    entries: active.entries.map(e => ({ id: e.id, sets: e.sets, target: e.target, topW: e.topW || null })).filter(e => e.sets.some(s => s.done)),
    prs: [], ...(active.src2j ? { src2j: active.src2j } : {}), ...(active.premium ? { premium: active.premium } : {}) }
  w.vol = w.entries.reduce((n, e) => n + e.sets.reduce((v, s) => v + (s.done && s.type !== 'warmup' ? (s.w || 0) * (s.r || 0) : 0), 0), 0)
  return w
}
