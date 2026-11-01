// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Sugerencias 2J" (Constructor V2.1) — a deterministic block recommender for gaps in a program.
// No model, no second engine: it reads the validator's own count of DIRECT weekly sets per
// muscle group (validation.stats.weeklySets — timed interval bouts and mobility already left out),
// compares it with what the 2J protocol programs for the goal and level, and offers library blocks
// that already pass the protocol for this member. It never edits the program and never claims
// something is "missing": indirect work is not modelled, so the wording is about direct presence.
import { WEEKLY_SETS, filterBlocks } from './protocol/index.js'

// Areas a suggestion can be about — each maps to the muscle groups the validator counts and the
// block focuses that train them (primary focus first).
export const AREAS = [
  { key: 'posterior', label: 'Posterior chain', groups: ['glutes', 'hamstrings'], focus: ['posterior', 'glutes', 'hamstrings'], big: true },
  { key: 'quads', label: 'Quads', groups: ['quads'], focus: ['quads', 'lower'], big: true },
  { key: 'chest', label: 'Chest', groups: ['chest'], focus: ['chest', 'push'], big: true },
  { key: 'back', label: 'Back muscles', groups: ['back'], focus: ['back', 'pull'], big: true },
  { key: 'shoulders', label: 'Shoulders', groups: ['shoulders'], focus: ['shoulders'] },
  { key: 'arms', label: 'Arms', groups: ['biceps', 'triceps'], focus: ['arms', 'biceps', 'triceps'] },
  { key: 'calves', label: 'Calves', groups: ['calves'], focus: ['calves'] },
  { key: 'core', label: 'Core', groups: ['abs'], focus: ['abs'], core: true },
]

// Which goals look at which areas, and how: hypertrophy compares with the weekly envelope; the
// others only point out an area with no direct work at all (they are not volume-driven goals).
const SCOPE = {
  hypertrophy: a => true,
  general: a => a.big || a.core,
  endurance: a => a.big || a.core,
  beginner: a => a.big || a.core,
  strength: a => a.big,
  power: () => false,
}

/**
 * @param {object} p { weeklySets, goal, level, blocks (library), days (# of trained days),
 *                     exclude? (Set of block ids already in the plan), unavailableEq?, validate? }
 *   `validate(block)` → the protocol verdict for that block under the member's restrictions;
 *   blocks that FAIL for this member are never suggested.
 * @returns [{ key, label, status: 'none'|'low', sets: { group: n }, envelope, blocks: [block] }]
 */
export function suggestBlocks({ weeklySets = {}, goal, level, blocks = [], days = 0, exclude = new Set(), unavailableEq = [], validate, maxAreas = 3, perArea = 3 }) {
  if (!days || !goal || !level) return []
  const inScope = SCOPE[goal] || SCOPE.general
  const env = goal === 'hypertrophy' ? WEEKLY_SETS[level] || null : null
  const bad = new Set(unavailableEq)
  const out = []
  for (const a of AREAS) {
    if (!inScope(a)) continue
    const sets = Object.fromEntries(a.groups.map(g => [g, weeklySets[g] || 0]))
    const lowest = Math.min(...Object.values(sets))
    const status = lowest === 0 ? 'none' : env && lowest < env[0] ? 'low' : null
    if (!status) continue
    const lv = level === 'advanced' ? ['advanced', 'intermediate'] : [level]
    // Core blocks are accessory work the library writes for the general goal: a core gap in any
    // goal is offered those. Every other area only gets blocks built for the program's own goal.
    const goals = a.core ? [goal, 'general'] : [goal]
    const candidates = blocks.filter(b => goals.includes(b.goal) && filterBlocks([b], { goal: b.goal }).length)
      .filter(b => lv.includes(b.level) && a.focus.includes(b.focus) && !exclude.has(b.id))
      .filter(b => !(b.equipment || []).some(eq => bad.has(eq)))
      .filter(b => !validate || validate(b).result !== 'FAIL')
      .sort((x, y) => (a.focus.indexOf(x.focus) - a.focus.indexOf(y.focus)) || (lv.indexOf(x.level) - lv.indexOf(y.level))
        || ((y.official ? 1 : 0) - (x.official ? 1 : 0)) || ((x.estimatedMinutes || 0) - (y.estimatedMinutes || 0)))
    if (!candidates.length) continue
    out.push({ key: a.key, label: a.label, status, sets, envelope: env, blocks: candidates.slice(0, perArea) })
  }
  // An area with no direct work at all comes before one that is only light; big areas first.
  const rank = s => (s.status === 'none' ? 0 : 2) + (AREAS.find(a => a.key === s.key).big ? 0 : 1)
  return out.sort((x, y) => rank(x) - rank(y)).slice(0, maxAreas)
}
