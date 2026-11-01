// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The member's side of Entrena tus Oposiciones: the state S.opposition = { v, plan, history } and what can be done with it, as pure functions that return the
// next state(s) (the screens call them inside update()). The plan pins the official profile it was built on; the training runs on the Premium engine (the
// current 5-week block is S.premium.active), so finished workouts, Coach and sync need nothing new. Nothing here deletes a workout, a routine or a snapshot.
import * as model from './opposition-model.js'
import * as pm from './premium-model.js'
import { activate, finish, premiumState } from './premium.js'

export const OPPOSITION_SLUG = 'entrena-tus-oposiciones'
export const COVER = { image: '/premium/covers/entrena-tus-oposiciones.jpg', alt: 'A swimmer in goggles mid-stroke in a pool', focal: { x: 50, y: 40 } }
const HISTORY_CAP = 6

/** The saved state, tolerant of anything: a malformed plan reads as "no plan". */
export function oppositionState(S) {
  const o = S?.opposition
  const plan = o && typeof o.plan === 'object' && o.plan && o.plan.profile && Array.isArray(o.plan.profile.tests) && o.plan.phases ? o.plan : null
  return { v: 1, plan, history: Array.isArray(o?.history) ? o.history : [] }
}

/** Is the running Premium instance a block of this plan? */
export const runsPlan = (S, plan = oppositionState(S).plan) => !!plan && String(premiumState(S).active?.programId || '').startsWith('opposition-' + plan.id)

/** What the screens need in one object. */
export function planView(S, now = Date.now()) {
  const { plan } = oppositionState(S)
  if (!plan) return null
  const workouts = S.workouts || []
  const inst = runsPlan(S, plan) ? premiumState(S).active : null
  const pos = inst ? pm.positionOf(inst, workouts) : null
  const adherence = inst ? pm.adherenceOf(inst, workouts, now) : null
  const summary = model.summarizePlan(plan, { now, adherence: planAdherenceOf(S, now) })
  const controlWeek = !!pos && pos.week === pos.weeks
  const evaluated = plan.evaluations.some(e => e.atBlock === plan.blockIndex)
  return {
    plan, inst, pos, summary, adherence, weeksLeft: model.weeksLeft(plan, now), calendarWeek: model.calendarWeek(plan, now),
    phase: summary.phase, controlWeek, blockDone: !!pos?.cycleComplete, evaluated, proposal: plan.proposal || null,
    canEvaluate: !!inst && (controlWeek || !!pos?.cycleComplete) && !evaluated, noBlock: !inst, finished: plan.status === 'finished',
  }
}

/** Plan-level adherence (percent): finished blocks plus the block under way. null until something was due. */
export function planAdherenceOf(S, now = Date.now()) {
  const { plan } = oppositionState(S)
  if (!plan) return null
  let done = 0, expected = 0
  for (const b of plan.blocks || []) { done += Number(b.completed) || 0; expected += Number(b.planned) || 0 }
  const inst = runsPlan(S, plan) ? premiumState(S).active : null
  if (inst) { const a = pm.adherenceOf(inst, S.workouts || [], now); done += a.done; expected += a.expected }
  return expected > 0 ? Math.min(100, Math.round(done * 100 / expected)) : null
}

/** Starts a plan. Returns { opposition, premium } (the next state of both) or { error, missing|issues }. A running Premium program closes into its history; the active planning is set aside by the caller. */
export function startPlan(S, args = {}) {
  const r = model.newPlan({ ...args, id: args.id })
  if (r.error) return r
  const { plan, block } = r
  const program = model.programFor(plan, block, { cover: COVER })
  const premium = activate(S, program, { now: args.now ?? Date.now(), id: args.instanceId })
  const cur = oppositionState(S)
  const history = cur.plan ? [...cur.history, closed(cur.plan, 'replaced', args.now ?? Date.now())].slice(-HISTORY_CAP) : cur.history
  return { opposition: { v: 1, plan, history }, premium }
}

const closed = (plan, reason, now) => ({ id: plan.id, profileId: plan.profileId, profileVersion: plan.profileVersion, name: plan.profile.name, startedAt: plan.startedAt, endedAt: now, reason, blocks: plan.blockIndex + 1, evaluations: plan.evaluations.length, marks: plan.marks })

/** Records a control: marks → per-test status against the official minimum, the target, the previous and the initial mark, with a projection. Proposes the next block; changes nothing else. */
export function submitEvaluation(S, results, { fatigue = 'normal', pain = false, now = Date.now() } = {}) {
  const cur = oppositionState(S)
  if (!cur.plan) return { error: 'no-plan' }
  const evaluation = model.evaluate(cur.plan, results, { now, adherence: planAdherenceOf(S, now), fatigue, pain })
  evaluation.atBlock = cur.plan.blockIndex
  if (Object.values(evaluation.perTest).every(x => x.value == null)) return { error: 'no-marks' }
  let plan = model.recordEvaluation(cur.plan, evaluation)
  plan.proposal = model.proposeNext(plan, evaluation, { now })
  return { opposition: { ...cur, plan }, evaluation }
}

/** The block the stored proposal stands for (for the preview and for confirming it). */
export const proposedBlock = plan => (plan?.proposal ? model.blockFor(plan, plan.proposal) : null)

/** Confirms the proposal: the finished block is recorded in the plan and the next one starts on the Premium engine. The previous block's workouts stay in the log. */
export function confirmProposal(S, { now = Date.now(), instanceId } = {}) {
  const cur = oppositionState(S)
  const plan = cur.plan
  if (!plan?.proposal) return { error: 'no-proposal' }
  const inst = runsPlan(S, plan) ? premiumState(S).active : null
  const pos = inst ? pm.positionOf(inst, S.workouts || []) : null
  const finished = { index: plan.blockIndex, phase: inst?.snapshot?.definition?.weeks?.[0]?.phase || null, planned: pos?.totalInCycle ?? 0, completed: pos?.completedInCycle ?? 0, skipped: pos?.skippedInCycle ?? 0, endedAt: now }
  const block = proposedBlock(plan)
  const nextPlan = model.applyProposal(plan, plan.proposal, finished)
  const program = model.programFor(nextPlan, block, { cover: COVER })
  const prem = premiumState(S)
  const base = inst ? finish(S, { now }) : prem                         // the finished block goes into the Premium history as "finished"
  const premium = activate({ ...S, premium: base }, program, { now, id: instanceId })
  return { opposition: { ...cur, plan: nextPlan }, premium }
}

/** The plan has no block running (the member switched or finished the Premium program): start the current block again from where the plan is. Nothing else changes. */
export function resumeBlock(S, { now = Date.now(), instanceId } = {}) {
  const cur = oppositionState(S)
  const plan = cur.plan
  if (!plan || runsPlan(S, plan)) return { error: 'running' }
  const startWeek = Math.min(plan.weeksTotal, model.calendarWeek(plan, now))
  const block = model.buildBlock({ profile: plan.profile, plan, blockIndex: plan.blockIndex, startWeek, marks: plan.marks, levels: plan.levels })
  const program = model.programFor(plan, block, { cover: COVER })
  return { opposition: cur, premium: activate(S, program, { now, id: instanceId }) }
}

/** Declines the proposal (the member keeps repeating the current block: nothing changes, the evaluation stays recorded). */
export function dismissProposal(S) {
  const cur = oppositionState(S)
  if (!cur.plan) return cur
  return { ...cur, plan: { ...cur.plan, proposal: null } }
}

/** Moves the plan to a newer version of the profile. Only on the member's confirmation; the version it was built on stays in plan.profileHistory. */
export function moveToVersion(S, profile, { now = Date.now() } = {}) {
  const cur = oppositionState(S)
  if (!cur.plan || profile?.id !== cur.plan.profileId || profile.version <= cur.plan.profileVersion) return cur
  return { ...cur, plan: model.moveToVersion(cur.plan, profile, { now }) }
}

/** Ends the plan. The Premium block in progress is closed into its history; the plan goes to the history; workouts and records are untouched. */
export function endPlan(S, { now = Date.now() } = {}) {
  const cur = oppositionState(S)
  if (!cur.plan) return { opposition: cur, premium: premiumState(S) }
  const premium = runsPlan(S, cur.plan) ? finish(S, { now }) : premiumState(S)
  return { opposition: { v: 1, plan: null, history: [...cur.history, closed(cur.plan, 'ended', now)].slice(-HISTORY_CAP) }, premium }
}

/** Is a newer version of the plan's profile available in the catalogue? */
export const newerVersion = (plan, profiles = []) => {
  const p = (profiles || []).find(x => x.id === plan?.profileId)
  return p && p.version > plan.profileVersion ? p : null
}

/** The member asked for the next block again (they dismissed the proposal, or came back later): the same deterministic proposal, from the last control. */
export function reproposeNext(S, { now = Date.now() } = {}) {
  const cur = oppositionState(S)
  const last = cur.plan?.evaluations?.[cur.plan.evaluations.length - 1]
  if (!last) return cur
  return { ...cur, plan: { ...cur.plan, proposal: model.proposeNext(cur.plan, last, { now }) } }
}

/** "3:24", "3:24.5" or "204" → seconds for a time test; a plain number otherwise. null when it is not a number. */
export function parseMark(text, kind) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const m = /^(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(s)
  if (m && kind === 'time') { const sec = Number(m[1]) * 60 + Number(m[2]); return Number(m[2]) < 60 ? sec : null }
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}
/** A mark as people write it: 204 s → "3:24" for runs, reps and metres as they are. */
export function formatMark(test, v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  if (test.kind === 'time' && v >= 60) return model.fmtTime(v)
  if (test.kind === 'time') return `${v} s`
  if (test.kind === 'hold') return `${v} s`
  if (test.kind === 'distance') return `${v} m`
  return String(v)
}
