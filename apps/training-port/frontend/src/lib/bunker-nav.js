// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { supersetUnits } from './history.js'

/* Navigation inside ONE Bunker panel's own session. Everything here is derived from that panel's entries and cursor; nothing is global,
 * nothing is stored, and nothing writes sets: moving between exercises only ever changes `cur`. */

const sets = e => (Array.isArray(e?.sets) ? e.sets : [])
const isDone = e => sets(e).length > 0 && sets(e).every(s => s?.done)

/** The whole session as a list: where each exercise stands (done / current / next / todo) and which superset it belongs to. */
export function bunkerOutline(entries = [], cur = 0) {
  const rows = Array.isArray(entries) ? entries : []
  const next = upNext(rows, cur)
  return rows.map((e, index) => {
    const total = sets(e).length, done = sets(e).filter(s => s?.done).length
    const state = index === cur ? 'current' : done === total && total > 0 ? 'done' : index === next ? 'next' : 'todo'
    return { index, id: e?.id, done, total, state }
  })
}

/** The superset partners of `idx` (including itself), in order; just [idx] for a lone exercise. */
export function bunkerUnit(entries = [], idx = 0) {
  return supersetUnits(entries).find(u => u.includes(idx)) || [idx]
}

/** The next exercise still to do: the first unfinished one after the current unit, else the first unfinished one before it. null when nothing is left. */
export function upNext(entries = [], cur = 0) {
  const rows = Array.isArray(entries) ? entries : []
  const unit = bunkerUnit(rows, cur)
  const after = rows.findIndex((e, i) => i > unit[unit.length - 1] && !isDone(e) && sets(e).length > 0)
  if (after !== -1) return after
  const before = rows.findIndex((e, i) => i < unit[0] && !isDone(e) && sets(e).length > 0)
  return before !== -1 ? before : null
}

/** Manual previous / next (plain neighbours, finished or not): the buttons can always go back without caring what was done. */
export function stepTargets(entries = [], cur = 0) {
  const n = Array.isArray(entries) ? entries.length : 0
  return { prev: cur > 0 ? cur - 1 : null, next: cur < n - 1 ? cur + 1 : null }
}

/** Moves the cursor and nothing else: the SAME entries come back, so no set, weight or note can be lost by navigating. */
export function goToExercise(active, idx) {
  const n = active?.entries?.length || 0
  if (!n) return active
  const cur = Math.max(0, Math.min(Number(idx) || 0, n - 1))
  return active.cur === cur ? active : { ...active, cur }
}

/** What a compact card shows for one panel's session: position, current set, the target, the effort (RPE/RIR) and the next exercise — all derived, nothing stored. */
export function compactFacts(entries = [], cur = 0, { effortKind = 'none' } = {}) {
  const rows = Array.isArray(entries) ? entries : []
  const e = rows[cur]
  if (!e) return null
  const ss = sets(e)
  const done = ss.filter(s => s?.done).length
  const tg = e.target || {}
  const lo = tg.targetRepsMin, hi = tg.targetRepsMax
  const reps = lo && hi && lo !== hi ? lo + '-' + hi : (tg.reps ?? ss[0]?.r ?? null)
  const mode = tg.mode === 'cardio' ? 'cardio' : tg.mode === 'time' ? 'time' : 'reps'
  const working = ss.find(s => !s?.done) || ss[ss.length - 1]
  let rpe = null
  if (effortKind !== 'none' && Number.isFinite(Number(working?.[effortKind])) && working?.[effortKind] !== null) rpe = { kind: effortKind, value: Number(working[effortKind]) }
  else { const m = /RPE\s*(\d+(?:[.,]\d)?)/i.exec(String(tg.note || e.note || '')); if (m) rpe = { kind: 'rpe', value: Number(m[1].replace(',', '.')), planned: true } }
  const nxt = upNext(rows, cur)
  return {
    position: cur + 1, total: rows.length, setNo: Math.min(done + 1, ss.length || 1), setTotal: ss.length, done,
    target: mode === 'cardio' ? { mode, min: ss[0]?.min ?? null } : { mode, sets: tg.sets ?? ss.length, reps },
    rpe, nextId: nxt === null ? null : rows[nxt].id, unit: bunkerUnit(rows, cur),
  }
}

/** Columns for the compact grid: few rows (3 on a small screen, 2 on a tall one), never narrower than a readable card. */
export function compactCols(n, width = 1920, height = 1080) {
  if (n <= 1) return 1
  if (n <= 2) return 2
  const rows = height >= 950 ? 2 : 3
  const maxCols = Math.max(2, Math.floor(width / 270))
  return Math.max(2, Math.min(maxCols, Math.ceil(n / rows)))
}
