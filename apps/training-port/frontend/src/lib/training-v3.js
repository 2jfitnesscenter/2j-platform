// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Training V3 — pure derivations over the live session (S.active) for the premium workout screen. Presentation only: nothing
// here writes state or decides what the member lifts. All figures are counts of what exists in the session.
import { exOr } from './exercises.js'
import { nameFor } from './i18n.js'

const isDone = e => !!e.sets.length && e.sets.every(s => s.done)
const unitDone = (entries, unit) => unit.every(i => entries[i] && isDone(entries[i]))

/** One entry per exercise unit (a superset is ONE unit): its exercise ids, whether every set is done, how many sets are done. */
export function unitsProgress(entries, units) {
  return units.map(unit => ({
    idx: unit[0], entries: unit, superset: unit.length > 1,
    done: unitDone(entries, unit),
    setsDone: unit.reduce((n, i) => n + (entries[i]?.sets.filter(s => s.done).length || 0), 0),
    setsTotal: unit.reduce((n, i) => n + (entries[i]?.sets.length || 0), 0),
  }))
}

/** The unit after `unitIdx` ("Next up"), or null on the last one. */
export function nextUnit(entries, units, unitIdx) {
  const u = units[unitIdx + 1]
  if (!u) return null
  const ex = u.map(i => exOr(entries[i].id))
  return { unitIndex: unitIdx + 1, entryIdx: u[0], superset: u.length > 1, names: ex.map(nameFor), ex: ex[0], sets: u.reduce((n, i) => n + entries[i].sets.length, 0) }
}

/** The very next set still to do in the session, starting from the current unit — what a rest timer should anticipate. */
export function nextTodoSet(active) {
  if (!active || !active.entries?.length) return null
  const entries = active.entries
  const order = entries.map((_, i) => i)
  const start = Math.min(active.cur || 0, entries.length - 1)
  for (const i of [...order.slice(start), ...order.slice(0, start)]) {
    const e = entries[i]
    const si = e.sets.findIndex(s => !s.done)
    if (si >= 0) return { entryIdx: i, setIdx: si, name: nameFor(exOr(e.id)), total: e.sets.length, sameExercise: i === start }
  }
  return null
}

/** The 4 quick values of the effort picker for each scale; the slider still allows every half step. */
export const EFFORT_QUICK = { rpe: [6, 7, 8, 9, 10], rir: [4, 3, 2, 1, 0] }
