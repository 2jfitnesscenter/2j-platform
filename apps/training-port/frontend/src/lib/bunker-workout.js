import { buildFinishedWorkout } from './workout-activity.js'
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { supersetUnits } from './history.js'

// Same history fields as the phone finish. Preserve the source receipt used by Guided Programs.
export const buildBunkerFinishedWorkout = buildFinishedWorkout

export function nextAfterBunkerSet(entries, entryIndex, setIndex) {
  const unit = supersetUnits(entries).find(u => u.includes(entryIndex)) || [entryIndex]
  if (unit.length === 1) return { rest: true, nextEntry: null }
  const nextEntry = unit.find(idx => idx !== entryIndex && entries[idx].sets[setIndex] && !entries[idx].sets[setIndex].done)
  return nextEntry === undefined ? { rest: true, nextEntry: null } : { rest: false, nextEntry }
}

// Derived only from one panel's own in-memory session. This is display progress, not a
// persistence marker or a second workout state.
export function bunkerProgress(entries = []) {
  const rows = Array.isArray(entries) ? entries : []
  const totalSets = rows.reduce((n, e) => n + (Array.isArray(e?.sets) ? e.sets.length : 0), 0)
  const doneSets = rows.reduce((n, e) => n + (Array.isArray(e?.sets) ? e.sets.filter(s => s?.done).length : 0), 0)
  const trackable = rows.filter(e => Array.isArray(e?.sets) && e.sets.length > 0)
  const doneExercises = trackable.filter(e => e.sets.every(s => s?.done)).length
  return { doneSets, totalSets, doneExercises, totalExercises: trackable.length, percent: totalSets ? Math.round(doneSets / totalSets * 100) : 0 }
}

// The kiosk's rest before it was prescription-aware — still the fallback for any exercise whose
// routine carries no rest of its own (older routines, freestyle, exercises added at the kiosk).
export const BUNKER_REST_FALLBACK = 90

/**
 * Rest after a set at the Bunker (Constructor V2.1): the rest the trainer prescribed, like the
 * phone (Workout.jsx restSecondsFor). A superset rests once, after its pair, with the pair's own
 * prescription (its last exercise's, as the builder stores it; else the longest in the pair).
 * A guided block (circuit/intervals/HIIT/mobility) is logged set by set here and rests what its
 * timing says between rounds. Nothing prescribed → the fallback, exactly as before.
 */
export function bunkerRestSec(entries, entryIndex, guidedBlocks = [], fallback = BUNKER_REST_FALLBACK) {
  const e = entries?.[entryIndex]
  if (!e) return fallback
  const g = e.target?.blk ? (guidedBlocks || []).find(b => b.iid === e.target.blk) : null
  if (g?.timing) {
    const s = g.timing.roundRest > 0 ? g.timing.roundRest : g.timing.rest
    return s > 0 ? s : fallback
  }
  const unit = supersetUnits(entries).find(u => u.includes(entryIndex)) || [entryIndex]
  const rest = i => Number(entries[i]?.target?.rest) > 0 ? Number(entries[i].target.rest) : 0
  const last = rest(unit[unit.length - 1])
  if (last) return last
  const any = Math.max(0, ...unit.map(rest))
  return any || fallback
}
