// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure helpers of the Entrena con 2J admin Studio: publication state, filtering, ordering and the
// totals a program editor shows. The server (api/lib/guided-store.js) stays the authority on
// what may be saved; these only shape what an admin sees and sends.
import { norm } from './library/core.js'

export const STATUSES = ['draft', 'active', 'hidden']
export const STATUS_LABEL = { draft: 'Draft', active: 'Active', hidden: 'Hidden' }
export const PURPOSES = ['warmup', 'cooldown', 'recovery', 'stretch', 'finisher']
export const PURPOSE_LABEL = { warmup: 'Warm-up', cooldown: 'Cool-down', recovery: 'Recovery', stretch: 'Stretching', finisher: 'Finisher' }

/** draft → not published yet; hidden → withdrawn; active → members see it. */
export const statusOf = x => x?.draft ? 'draft' : x?.active === false ? 'hidden' : 'active'

export function filterAdmin(list, { q = '', status = 'all', category = 'all', featured = false } = {}, nameOf = x => x.name) {
  const needle = norm(q)
  return list.filter(x => (status === 'all' || statusOf(x) === status)
    && (category === 'all' || x.category === category)
    && (!featured || !!x.featured)
    && (!needle || norm(nameOf(x)).includes(needle) || norm(x.id).includes(needle) || norm(x.subtitle || '').includes(needle)))
}

export const countByStatus = list => list.reduce((c, x) => { c[statusOf(x)]++; return c }, { draft: 0, active: 0, hidden: 0 })

/** Move `id` one place up (-1) or down (+1) in `ids`; unchanged at the ends. */
export function moveId(ids, id, dir) {
  const i = ids.indexOf(id), j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]]
  return next
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const emptyProgram = () => ({ name: '', description: '', goal: 'general', level: 'beginner', cover: 'strength', featured: false, status: 'draft',
  weeks: [{ sessions: [] }] })

/** Sessions, minutes and the first routine a week-by-week plan refers to that no longer exists. */
export function programTotals(program, routinesById) {
  let sessions = 0, minutes = 0, missing = null
  for (const w of program.weeks || []) for (const s of w.sessions || []) {
    sessions++
    const r = routinesById.get ? routinesById.get(s.routineId) : routinesById[s.routineId]
    if (!r) { missing = missing || s.routineId; continue }
    minutes += r.estimatedMinutes || 0
  }
  return { sessions, minutes, missing, weeks: (program.weeks || []).length }
}

/** Next free day (0-6) of a week, preferring Mon-Wed-Fri-like spacing. */
export function nextDay(week) {
  const used = new Set((week.sessions || []).map(s => s.day))
  for (const d of [1, 3, 5, 2, 4, 6, 0]) if (!used.has(d)) return d
  return null
}

/** A copy of week `i` appended after it (sessions are plain refs, so a copy is cheap and safe). */
export function duplicateWeek(weeks, i) {
  const copy = JSON.parse(JSON.stringify(weeks[i]))
  return [...weeks.slice(0, i + 1), copy, ...weeks.slice(i + 1)]
}

export const VISIBILITY_LABEL = { active: 'Visible', hidden: 'Hidden', draft: 'Draft' }

/**
 * The direct visibility switch of a row: ON publishes (active), OFF hides. Uses the existing store
 * calls and endpoints only; the server stays the authority (a routine or program that does not
 * pass its publishing checks is refused with its reason, and the switch stays where it was).
 * kind: 'routine' | 'program' | 'collection' (blocks have their own setActive).
 */
export async function setVisible(g, kind, item, on) {
  if (kind === 'routine') return g.setStatus(item.id, on ? 'active' : 'hidden')
  if (kind === 'program') { const { routines: _r, routineIds: _i, ...program } = item; return g.saveProgram({ ...program, status: on ? 'active' : 'hidden' }) }
  if (kind === 'collection') return g.saveCollection({ ...item, active: !!on })
  throw new Error('unknown kind ' + kind)
}
