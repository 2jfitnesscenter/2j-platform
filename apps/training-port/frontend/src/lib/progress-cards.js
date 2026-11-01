// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The blocks of the Progress page as a CLOSED catalogue, and the member's choice about them. The choice lives where every other personalisation lives, in S.ux
// (lib/features.js), as two optional lists — S.ux.progress = { order?: string[], hidden?: string[] }:
//   · absent (S.ux === null, a legacy profile, or never touched)  → the page is exactly what it always was: every block, in the default order;
//   · hidden: blocks the member turned off (their data is never touched);  order: the member's sequence — ids it does not know are ignored and blocks it does not list
//     (e.g. a block added in a later release) keep their default place, so an old choice can never hide something new or break the page.
// Each block still applies its own feature/data gates inside Stats.jsx; this only decides "shown by choice" and "where". The header, the period cover, the follow-up card and the
// recent-workouts list are structural and not part of the catalogue.
export const PROGRESS_CARDS = [
  { id: 'insights', label: 'Highlights', icon: 'sparkles' },
  { id: 'last', label: 'Last workout', icon: 'history' },
  { id: 'recovery', label: 'Muscle recovery', icon: 'heart', feature: 'recovery' },
  { id: 'composition', label: 'Body composition', icon: 'figureStrength', feature: 'bioimpedance' },
  { id: 'weight', label: 'Body weight', icon: 'scale', feature: 'bodyweight' },
  { id: 'activity', label: 'Activity map', icon: 'flame' },
  { id: 'muscles', label: 'Muscles & volume', icon: 'dumbbell' },
  { id: 'timeline', label: 'Progress timeline', icon: 'chartLine', feature: 'timeline' },
  { id: 'cardio', label: 'Cardio tests', icon: 'figureRun' },
  { id: 'effort', label: 'Effort & training zones', icon: 'bolt' },
  { id: 'exercise', label: 'Exercise progress', icon: 'trophy' },
  { id: 'health', label: 'Health & WHOOP', icon: 'heart', feature: 'health' },
]
export const PROGRESS_IDS = PROGRESS_CARDS.map(c => c.id)
const KNOWN = new Set(PROGRESS_IDS)

/** The stored choice, cleaned: known ids only, no repeats. Anything malformed is ignored (→ defaults). */
export function normalizeProgress(p) {
  const list = x => (Array.isArray(x) ? [...new Set(x.filter(i => typeof i === 'string' && KNOWN.has(i)))] : [])
  return { order: list(p?.order), hidden: list(p?.hidden) }
}

/** The member's sequence merged with the defaults: listed blocks first in their order; any block they do not list goes after its default predecessor. */
export function progressOrder(S) {
  const { order } = normalizeProgress(S?.ux?.progress)
  const out = [...order]
  PROGRESS_IDS.forEach((id, i) => {
    if (out.includes(id)) return
    let at = 0
    for (let k = i - 1; k >= 0; k--) { const p = out.indexOf(PROGRESS_IDS[k]); if (p >= 0) { at = p + 1; break } }
    out.splice(at, 0, id)
  })
  return out
}

/** Blocks to draw, in order (the member's hidden ones removed). Feature/data gates are applied by the page itself. */
export function visibleProgressCards(S) {
  const { hidden } = normalizeProgress(S?.ux?.progress)
  return progressOrder(S).filter(id => !hidden.includes(id))
}

/** What to store for a layout: nothing when it equals the default (so an untouched profile stays untouched). */
export function progressChoice(order, hidden) {
  const o = normalizeProgress({ order }).order, h = normalizeProgress({ hidden }).hidden
  const isDefault = !h.length && o.length === PROGRESS_IDS.length && o.every((id, i) => id === PROGRESS_IDS[i])
  return isDefault ? undefined : { order: o, hidden: h }
}

/* ---------------------------------------------------------------- recommended layout by goal (only ever APPLIED on an explicit action) */
// A goal only decides which blocks come first and which features a preset turns on, at the moment the member applies a preset, finishes the first setup or presses
// "Restore recommended settings". It is never read afterwards: changing the goal later never moves anything, and nothing here is used by an AI.
const GOAL_PLANS = {
  hypertrophy: { first: ['muscles', 'exercise', 'weight'], uses: { volume: true }, ifLogged: ['bodyweight'] },
  fatloss: { first: ['weight', 'activity', 'composition'], uses: { bodyweight: true, bioimpedance: true, health: true, activity: true } },
  power: { first: ['exercise', 'insights', 'muscles'], uses: { volume: true, suggestions: true } },
  longevity: { first: ['activity', 'health', 'last'], uses: { health: true, recovery: true, activity: true } },
}
export const goalPlanOf = goal => GOAL_PLANS[goal] || null

/** { uses, progress } — `base` is a preset's uses (lib/features.js PRESETS[id]); `progress` is what to store in S.ux.progress (undefined = the default layout). */
export function recommendedFor(S, base, { minimal = false, logged = {} } = {}) {
  const plan = goalPlanOf(S?.coach?.profile?.goal)
  const uses = { ...base }
  if (plan && !minimal) {                     // "just train" stays minimal whatever the goal
    Object.assign(uses, plan.uses)
    for (const k of plan.ifLogged || []) if (logged[k]) uses[k] = true
  }
  const first = plan && !minimal ? plan.first : []
  const order = [...first, ...PROGRESS_IDS.filter(id => !first.includes(id))]
  return { uses, progress: progressChoice(order, []) }
}
