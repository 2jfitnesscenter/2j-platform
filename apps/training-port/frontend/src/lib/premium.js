// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The member's side of Premium Training Programs: the state S.premium = { v, active, history } and what can be done with it, as pure functions that return
// the next state (the screens call them inside update()). A running program lives entirely in the member's own state — its definition is pinned in the
// snapshot — so hiding, archiving or switching off the catalogue never reaches it. Finished workouts, PRs and saved routines are never touched.
import * as model from './premium-model.js'
import { memberContext } from './train2j.js'
import { gymRoutineCompatibility } from './gym-profiles.js'

export const premiumState = S => {
  const p = S?.premium
  return { v: 1, active: p && typeof p.active === 'object' && p.active && p.active.snapshot?.definition ? p.active : null, history: Array.isArray(p?.history) ? p.history : [] }
}
const HISTORY_CAP = 40
const keep = h => h.slice(-HISTORY_CAP)

/** Starts a program. A running one is closed into the history first (reason "switched") — never silently overwritten, and its workouts stay in the log. */
export function activate(S, program, { tm = {}, unit = S?.unit || 'kg', now = Date.now(), id } = {}) {
  const cur = premiumState(S)
  const history = cur.active ? keep([...cur.history, model.historyEntry(cur.active, S?.workouts || [], { reason: 'switched', now })]) : cur.history
  return { v: 1, active: model.newInstance(program, { id, now, tm, unit }), history }
}
export function finish(S, { now = Date.now() } = {}) {
  const cur = premiumState(S)
  if (!cur.active) return cur
  return { v: 1, active: null, history: keep([...cur.history, model.historyEntry(cur.active, S?.workouts || [], { reason: 'finished', now })]) }
}
const on = (S, fn) => { const cur = premiumState(S); return cur.active ? { ...cur, active: fn(cur.active) } : cur }
export const pause = (S, now = Date.now()) => on(S, i => model.pauseInstance(i, now))
export const resume = (S, now = Date.now()) => on(S, i => model.resumeInstance(i, now))
export const skip = (S, now = Date.now()) => on(S, i => model.skipSession(i, S?.workouts || [], now))
export const setTM = (S, lift, value, now = Date.now()) => on(S, i => model.setTrainingMax(i, lift, value, { now }))
export const nextCycle = (S, { accept = true, overrides = {}, now = Date.now() } = {}) => on(S, i => model.advanceCycle(i, S?.workouts || [], { accept, overrides, now }))

/** The state card of a running program, ready to show. */
export function runningView(S, now = Date.now()) {
  const { active } = premiumState(S)
  if (!active) return null
  const workouts = S.workouts || []
  const pos = model.positionOf(active, workouts)
  return {
    inst: active, pos, progress: model.progressOf(active, workouts), plan: pos.session ? model.planSession(active, workouts) : null,
    proposal: pos.cycleComplete ? model.proposalFor(active, workouts) : null, missing: model.missingTrainingMax(active), summary: model.summarize(active, workouts, now),
  }
}

/* ------------------------------------------------------------------------------------------------ catalogue: compatibility + recommendation */
export const exercisesOf = def => [...new Set((def?.weeks || []).flatMap(w => w.sessions.flatMap(s => s.blocks.map(b => (b.lift ? (def.lifts || []).find(l => l.key === b.lift)?.exercise : b.exercise)))).filter(Boolean))]

/** Can this gym equip the method? Never hides a program: "partial" says some exercises will need another choice. */
export function compatibility(S, program) {
  const ids = program.setup?.exercises || exercisesOf(program.programDefinition)
  return gymRoutineCompatibility(S, { ex: ids.map(id => ({ id })) })
}

// What each declared goal looks for. Nothing is inferred: goal and experience come from the member's Coach profile or their plan.
const GOAL_TAGS = {
  hypertrophy: ['hypertrophy', 'strength-muscle'], toning: ['recomposition', 'hypertrophy'], fatloss: ['recomposition', 'conditioning', 'health'], power: ['strength', 'strength-muscle'],
  longevity: ['health', 'conditioning'], plyometrics: ['conditioning', 'strength-muscle'], padel: ['conditioning', 'health'], basketball: ['conditioning', 'strength-muscle'], examfitness: ['conditioning'],
}
const GENTLE_GOALS = new Set(['fatloss', 'longevity', 'toning', 'examfitness', 'padel'])   // never lead with an advanced strength system
const RANK = { beginner: 0, intermediate: 1, advanced: 2 }

export function recommendation(S, program) {
  const prof = S?.coach?.profile || {}
  const ctx = memberContext(S || {})
  const goal = prof.goal || null
  const tags = program.goalTags || []
  const beginner = ['new', 'returning'].includes(prof.experience) || ctx.level === 'beginner'
  const level = beginner ? 'beginner' : prof.experience === 'regular' ? 'intermediate' : null
  const reasons = []
  let score = 0
  if (goal && GOAL_TAGS[goal]?.some(t => tags.includes(t))) { score += 3; reasons.push('goal') }
  if (level != null) {
    const gap = RANK[program.level] - RANK[level]
    if (gap <= 0) { score += 1; reasons.push('level') } else { score -= 2 * gap; reasons.push('too-advanced') }
  }
  const days = Number(prof.daysPerWeek)
  if (days > 0 && program.daysPerWeek <= days) { score += 1; reasons.push('days') } else if (days > 0) { score -= 1; reasons.push('more-days') }
  const strengthOnly = tags.includes('strength') && !tags.some(t => ['recomposition', 'health', 'conditioning'].includes(t))
  if (GENTLE_GOALS.has(goal) && (strengthOnly || program.level === 'advanced')) { score = Math.min(score, 0); reasons.push('not-for-goal') }
  if (ctx.restrictions.length) reasons.push('restrictions')
  const recommended = score >= 3 && !reasons.includes('too-advanced') && !reasons.includes('not-for-goal') && !reasons.includes('more-days')
  return { score, reasons, recommended, caution: reasons.includes('too-advanced') || reasons.includes('restrictions') || reasons.includes('more-days') }
}

export const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'recommended', label: 'Recommended for you' }, { key: 'hypertrophy', label: 'Hypertrophy' }, { key: 'strength', label: 'Strength' },
  { key: 'strength-muscle', label: 'Strength + muscle' }, { key: 'recomposition', label: 'Fat loss / recomposition' }, { key: 'conditioning', label: 'Conditioning' },
]
/** Filter + order: featured first, then the recommended ones, then the catalogue order the gym set. */
export function filterCatalog(S, programs, { goal = 'all', level = 'all', days = 'all' } = {}) {
  const rows = programs.map(p => ({ p, rec: recommendation(S, p) }))
    .filter(({ p, rec }) => (goal === 'all' || (goal === 'recommended' ? rec.recommended : (p.goalTags || []).includes(goal)))
      && (level === 'all' || p.level === level) && (days === 'all' || p.daysPerWeek === Number(days)))
  return rows.map((r, i) => ({ ...r, i })).sort((a, b) => Number(!!b.p.featured) - Number(!!a.p.featured) || Number(b.rec.recommended) - Number(a.rec.recommended) || a.i - b.i)
}

/* ------------------------------------------------------------------------------------------------ replacing the active plan */
/** The member's active planning (a program they are following), or null. Premium programs bring their own periodisation, so starting one replaces it. */
export function activePlanOf(S) {
  const p = (S?.programs || []).find(x => x.id === S?.activeProgramId)
  return p && !['completed', 'abandoned'].includes(p.status) ? { id: p.id, name: p.name } : null
}
/** Called on a draft state when a Premium program starts over an active plan: the plan is set aside, never deleted (the program stays saved, a guided program is paused, history and workouts are untouched). */
export function setAsidePlan(S) {
  const plan = activePlanOf(S)
  if (!plan) return null
  const prog = S.programs.find(x => x.id === plan.id)
  if (prog.source === 'guided-v2' && prog.status === 'active') prog.status = 'paused'
  S.activeProgramId = null
  return plan
}
