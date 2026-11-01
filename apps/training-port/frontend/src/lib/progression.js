// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, workingSets, workingLoadEvidence, buildSets, cleanupSg, defaultConfig } from './history.js'
import { EXIDX, isUnavailable } from './exercises.js'
import { bestTestedOneRM, pctForReps } from './onerm.js'
import { realizableToward, stepWeight } from './equipment.js'
import { effortStats, effortSignal } from './autoreg.js'
import { activeDeload } from './fatigue.js'
import { todayISO } from './format.js'
import { countsForProgression } from './workout-policy.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'pct1rm', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', 'pct1rm'],
  time: ['off', 'time'],
  cardio: ['off', 'cardio']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  pct1rm: '% of your tested 1RM',
  time: 'Add time',
  cardio: 'Cardio progression'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  pct1rm: 'Weight is calculated straight from a 1RM test you logged (Actions → Start a test session) — not from how past sessions went.',
  time: 'Hold every set for the full duration and the target goes up.',
  cardio: 'Build duration by 1 minute to 30 minutes first. Then add 0.5 km/h. Repeated short sessions reduce the target slightly.'
}

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; the general linear policy gives you two more cracks at it first.
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
export const DEFAULT_SEC_INCREMENT = 5

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  // A routine's strength policy (usually linear) does not disable cardio. Cardio has its own
  // explicit per-exercise opt-out; an incompatible exercise override still safely resolves off.
  const pick = cfg?.prog || (routine && allowed.includes(routine.prog) ? routine.prog : undefined) || (m === 'reps' ? 'linear' : m === 'cardio' ? 'cardio' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

const round1 = v => Math.round(v * 10) / 10
// Snap to a loadable multiple of the step.
function snap(v, step) {
  if (!(step > 0)) return round1(v)
  return round1(Math.round(v / step) * step)
}
// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step.
// A policy decides the direction and size of a change; the equipment decides which load can
// actually be put on the bar/rack/stack. Every load a policy prescribes goes through here, with
// the same increments the set pad and the plate shortcut use (lib/equipment.js): a step up lands
// on the next realizable load at or above the policy's number, a deload on the realizable load at
// or below it. Already at the end of the equipment's range (the heaviest dumbbell) it stays
// there; a load the equipment rules don't describe at all (a custom exercise past a stack's
// limit) keeps the policy's own number, as before. Routines and the targets of finished workouts
// are never touched — this only shapes the prescription derived for a session.
function loadable(S, cfg, from, target) {
  const eq = EXIDX[cfg.id]?.eq
  if (from == null) {
    const up = realizableToward(S, eq, 0, target)
    if (up == null) return target
    const down = stepWeight(S, eq, up, -1)
    return down < up && target - down < up - target ? down : up
  }
  const r = realizableToward(S, eq, from, target)
  if (r != null) return r
  return stepWeight(S, eq, from, target > from ? 1 : -1) === from ? from : target
}
const topOfRange = (policy, w, reps) => ({ policy, kind: 'hold', weight: w, reps,
  why: ['Heaviest load this equipment offers — same weight, work the reps.'] })
const delta = (a, b) => Math.round((a - b) * 100) / 100

function deloadTo(cur, step) {
  let next = snap(cur * DELOAD_FACTOR, step)
  if (next >= cur) next = snap(cur - step, step)
  return Math.max(step, next)
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  // Warmup/drop sets don't represent the straight-set prescription — excluded so they can't
  // make a session read as a miss (or a false hit) against a target they were never trying to hit.
  const sets = workingSets((entry && entry.sets) || [])
  const planned = target.sets || sets.length
  const enough = sets.length >= planned

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, goal, held,
      weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  if (mode === 'cardio') {
    const goal = Math.max(0, Number(target.min) || 0)
    const goalSpeed = Math.max(0, Number(target.speed) || 0)
    const mins = sets.map(s => s.done ? Math.max(0, Number(s.min) || 0) : 0)
    const speeds = sets.map(s => s.done && s.speed != null && Number.isFinite(Number(s.speed)) ? Math.max(0, Number(s.speed)) : null)
    const hasSpeed = speeds.some(v => v != null)
    const durationOk = goal > 0 && enough && mins.length > 0 && mins.every(m => m >= goal)
    const speedOk = !goalSpeed || speeds.every(v => v == null || v >= goalSpeed)
    return {
      mode, goal, goalSpeed, mins, speeds, hasSpeed, durationOk, speedOk,
      best: Math.max(0, ...mins),
      ok: durationOk && speedOk
    }
  }
  const goal = target.reps || 0
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0))
  return {
    mode, goal, reps,
    ...workingLoadEvidence(sets),
    ...effortStats(sets),                                  // { effort (RPE scale), rated } — lib/autoreg.js
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal)
  }
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback) {
  const out = []
  ;(S.workouts || []).forEach(w => {
    if (!countsForProgression(w)) return
    const entry = (w.entries || []).find(e => e.id === exId)
    if (entry && !entry.target?.deload && entry.sets.some(s => s.done)) out.push({ d: w.d, ...readSession(entry, fallback) })
  })
  return out
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) break
    n++
  }
  return n
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said.
 */
function policyPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const inc = cfg.inc > 0 ? cfg.inc : (mode === 'time' ? DEFAULT_SEC_INCREMENT : defaultIncrement(cfg.id, unit))
  if (policy === 'off') return { policy, kind: 'off' }

  // Open-loop, unlike every other policy here: the weight comes straight from a tested 1RM plus
  // a target rep count and RIR, not from judging what happened last session — so it's computed
  // before any of the session-history machinery below even runs.
  if (policy === 'pct1rm') {
    const best = bestTestedOneRM(S, cfg.id)
    if (!best) return { policy, kind: 'off', why: ['No tested 1RM on file for this exercise yet — run one first (Actions → Start a test session).'] }
    const reps = cfg.reps || 5
    const rir = cfg.targetRIR != null ? cfg.targetRIR : 2
    const pct = pctForReps(reps, rir)
    const weight = loadable(S, cfg, null, snap(best.est1RM * pct, inc))
    return { policy, kind: 'hold', weight, reps, why: ['{0}% of your tested 1RM ({1} {2}) for {3} reps at RIR {4}.', Math.round(pct * 100), best.est1RM, unit, reps, rir] }
  }

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] }

  const stalls = stallCount(sessions)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  if (mode === 'cardio') {
    const goal = Math.max(1, Number(last.goal) || Number(cfg.min) || 20)
    const speed = Math.max(0, Number(last.goalSpeed) || Number(cfg.speed) || 0)
    const durationCeiling = Math.max(30, Number(cfg.min) || 0)
    const repeatedMisses = stalls >= 2
    if (!last.ok) {
      if (!repeatedMisses) return { policy, kind: 'hold', min: goal, speed: speed || undefined, why: ['Cardio target not completed — keep the same goal and build back up.'] }
      if (last.durationOk && !last.speedOk && speed > 0.5) {
        const nextSpeed = Math.max(0.5, round1(speed - 0.5))
        return { policy, kind: 'deload', min: goal, speed: nextSpeed, why: ['Two cardio sessions came up short — keep the time and ease the pace to {0} km/h.', nextSpeed] }
      }
      const nextMin = Math.max(5, goal - 1)
      return { policy, kind: 'deload', min: nextMin, speed: speed || undefined, why: ['Two cardio sessions came up short — reduce the time to {0} min, then build again.', nextMin] }
    }
    if (goal < durationCeiling) {
      const nextMin = Math.min(durationCeiling, goal + 1)
      return { policy, kind: 'up', min: nextMin, speed: speed || undefined, why: ['You completed the cardio time — add 1 minute, then build toward {0} min before increasing pace.', durationCeiling] }
    }
    if (!last.hasSpeed || !speed) return { policy, kind: 'hold', min: goal, why: ['Cardio time is at its ceiling. Log a speed so the next pace target can progress safely.'] }
    const nextSpeed = round1(speed + 0.5)
    return { policy, kind: 'up', min: goal, speed: nextSpeed, why: ['You reached {0} min — keep the time and increase pace by {1} km/h.', goal, nextSpeed - speed] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs
  // ahead of the individual policies because it is true for all of them; a rep range set on
  // top of it simply gets passed once you exceed it, which is the right moment to add load
  // or move to a harder variation anyway.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    if (last.ok && goal > 0) return { policy, kind: 'up', weight: 0, reps: goal + 1, why: ['Bodyweight — every rep last time, so go for {0} this time.', goal + 1] }
    return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] }
  }
  const previous = sessions[sessions.length - 2]
  if (last.ok && (!last.safeToIncrease || (policy === 'double' && (!previous?.ok || !previous.safeToIncrease || previous.weight !== w)))) {
    return { policy, kind: 'hold', weight: w, why: ['Repeat the first working load until two sessions support a safe increase.'] }
  }
  if (policy === 'double') {
    const top = cfg.reps || last.goal || 10
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top)
    if (last.ok) {
      const up = loadable(S, cfg, w, snap(w + inc, inc))
      if (up <= w) return topOfRange(policy, w, bottom)
      return { policy, kind: 'up', weight: up, reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', delta(up, w), unit, bottom] }
    }
    if (stalls >= deloadAt) {
      const dw = loadable(S, cfg, w, deloadTo(w, inc))
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + 1))
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    const up = loadable(S, cfg, w, snap(w + (dbl ? inc * 2 : inc), inc))
    if (up <= w) return topOfRange(policy, w)
    return {
      policy, kind: 'up', weight: up,
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, delta(up, w), unit]
        : ['Every rep last time — {0} {1} more.', delta(up, w), unit]
    }
  }
  if (stalls >= deloadAt) {
    const dw = loadable(S, cfg, w, deloadTo(w, inc))
    return {
      policy, kind: 'deload', weight: dw,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Autoregulation (lib/autoreg.js) as a small layer over a prescription that was already going UP on linear / double progression:
 *   grind → the sessions were completed but at RPE ≥ 9 (RIR ≤ 1) twice: hold the load; easy → completed and clearly easy (RPE ≤ 7) three times: a bigger step.
 * Every change carries its reason (why) and `auto` ('slower' | 'faster'). Turn it off with S.autoreg = false. Never touches a routine.
 */
function regulate(S, cfg, routine, p) {
  if (S.autoreg === false || (p.kind !== 'up' && p.kind !== 'hold') || !(p.weight > 0) || modeOf(cfg) !== 'reps' || (p.policy !== 'linear' && p.policy !== 'double')) return p
  const sessions = sessionsFor(S, cfg.id, cfg).filter(x => x.mode === 'reps')
  const last = sessions[sessions.length - 1]
  if (!last || !(last.weight > 0)) return p
  const sig = effortSignal(sessions)
  const unit = S.unit || 'kg'
  const w = last.weight
  if (sig.kind === 'grind' && p.weight >= w) {
    return { ...p, kind: 'hold', weight: w, reps: p.policy === 'double' ? (last.goal || cfg.reps || p.reps) : undefined, auto: 'slower',
      why: ['Completed twice, but at RPE {0} or higher (RIR 1 or less) — keep {1} {2} until it feels easier.', GRIND_LABEL, w, unit] }
  }
  if (sig.kind === 'easy' && p.kind === 'up') {
    // one more real step on top of the planned one (what the equipment can actually hold), never more than +15 % over the last load
    const inc = cfg.inc > 0 ? cfg.inc : defaultIncrement(cfg.id, unit)
    const bigger = loadable(S, cfg, p.weight, snap(p.weight + (p.weight - w), inc))
    if (bigger > p.weight && (bigger - w) / w <= 0.15) return { ...p, weight: bigger, auto: 'faster', why: ['Every rep, and clearly easy (RPE 7 or lower) three sessions running — {0} {1} more.', delta(bigger, w), unit] }
  }
  return p
}
const GRIND_LABEL = 9

// Preserve observed ramp/backoff positions; explicit %1RM remains its own prescription.
export function nextPrescription(S, cfg, routine) {
  const p = regulate(S, cfg, routine, policyPrescription(S, cfg, routine))
  if (p.weight == null || p.policy === 'pct1rm' || modeOf(cfg) !== 'reps') return p
  const latest = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === 'reps').at(-1)
  if (!latest?.weights?.length || latest.weights.every(w => w === latest.weight)) return p
  const offset = p.weight - latest.weight
  const eq = EXIDX[cfg.id]?.eq
  return { ...p, weights: latest.weights.map(w => offset === 0 ? w : (realizableToward(S, eq, w, Math.max(0, w + offset)) ?? w)) }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p) {
  if (!p || p.kind === 'off' || p.kind === 'first') return sets
  let workIndex = 0
  return sets.map(s => {
    // A warmup or dropset's weight is deliberately lighter than the working prescription — it
    // must not get overwritten with the same number the policy chose for the straight sets
    // around it.
    if (s.done || s.type === 'warmup' || s.type === 'drop') return s
    const out = { ...s }
    if (p.weight != null) out.w = p.weights?.[workIndex] ?? p.weights?.at(-1) ?? p.weight
    workIndex++
    if (p.reps != null) out.r = p.reps
    if (p.sec != null) out.sec = p.sec
    if (p.min != null) out.min = p.min
    if (p.speed != null) out.speed = p.speed
    return out
  })
}

// Cardio's effective target belongs to this workout entry, not the saved routine. Keeping it
// beside the existing target lets history judge the result against what was actually prescribed.
export function targetForPrescription(cfg, plan) {
  if (modeOf(cfg) !== 'cardio' || !plan || plan.kind === 'off' || plan.kind === 'first') return { ...cfg }
  return { ...cfg, ...(plan.min != null ? { min: plan.min } : {}), ...(plan.speed != null ? { speed: plan.speed } : {}) }
}

// Turns a routine into the `entries` a live session drives (S.active.entries and the finished
// workout it becomes) — hidden-exercise filtering, superset cleanup, a prescription per
// exercise and the sets that prescription actually produces. Was inlined twice, identically, in
// sheets.jsx's beginWorkout/beginPastWorkout; pulled out here so a THIRD caller (the Bunker
// kiosk building today's session for whoever just checked in) reuses the exact same logic
// instead of a hand-rolled approximation that quietly skips progression, supersets and cardio.
export function buildRoutineEntries(S, routine) {
  const usable = (routine ? routine.ex : []).filter(cfg => !isUnavailable(cfg.id)).map(cfg => ({ ...cfg }))
  cleanupSg(usable)
  return usable.map(cfg => {
    const plan = nextPrescription(S, cfg, routine)
    return withDeload(S, { id: cfg.id, sg: cfg.sg, target: targetForPrescription(cfg, plan), plan, sets: applyPrescription(buildSets(S, cfg), plan) })
  })
}

/**
 * The 1-week deload the member accepted (S.deload, lib/fatigue.js), applied on top of the freshly built entry: ~35 % fewer working sets, loads ~7.5 % lighter
 * (to a load the equipment can really hold), an RIR 3 target. The routine, its targets and the progression history are untouched — this only shapes the
 * session while the week lasts, the entry is flagged (target.deload) so progression, routine review and fatigue ignore it, and the next session after the
 * week is built from the normal plan again. No active deload → the entry comes back unchanged.
 */
export function withDeload(S, entry, today = todayISO()) {
  const d = activeDeload(S, today)
  if (!d) return entry
  const work = (entry.sets || []).filter(s => !s.done && s.type !== 'warmup' && s.type !== 'drop')
  const keep = Math.max(1, Math.round(work.length * (1 - d.volumeCut)))
  const eq = EXIDX[entry.id]?.eq
  let seen = 0
  const sets = (entry.sets || []).flatMap(s => {
    if (s.done || s.type === 'warmup' || s.type === 'drop') return [s]
    if (++seen > keep) return []
    const out = { ...s }
    if (out.w > 0) {
      const lighter = realizableToward(S, eq, out.w, out.w * (1 - d.loadCut))
      out.w = lighter != null && lighter < out.w ? lighter : out.w
    }
    return [out]
  })
  return {
    ...entry, sets,
    target: { ...entry.target, targetRIR: d.rir, deload: { from: d.from, until: d.until, rir: d.rir } },
    plan: { ...(entry.plan || {}), deload: true, auto: 'deload',
      why: ['Deload week: about {0} % fewer sets, a little lighter, aim for RIR {1}. Your normal plan comes back afterwards.', Math.round(d.volumeCut * 100), d.rir] },
  }
}

// One exercise picked ad hoc — no routine slot to inherit sets/reps/weight from, so it starts
// from defaultConfig() instead of a routine author's own cfg. Same per-exercise pipeline
// buildRoutineEntries runs for each of a routine's exercises (nextPrescription already treats a
// missing routine as "no routine-level policy to fall back on", not an error — see policyFor).
// Mirrors Workout.jsx's own mid-session "Add exercise" (the only other place this shape gets
// built by hand) so a freestyle Bunker session and a freestyle phone session prescribe alike.
export function buildFreeEntry(S, exId, routine) {
  const cfg = { id: exId, ...defaultConfig(exId) }
  const plan = nextPrescription(S, cfg, routine || null)
  return { id: cfg.id, target: targetForPrescription(cfg, plan), plan, sets: applyPrescription(buildSets(S, cfg), plan) }
}
