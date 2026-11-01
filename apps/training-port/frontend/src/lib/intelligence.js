// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Intelligence 2J V2: bounded, read-only selectors over the existing user state.
// No provider call, parallel history, queue, or write to workouts/programs occurs here.
import { activeGymProfile, compatibleWithGym, gymRoutineCompatibility } from './gym-profiles.js'
import { getReplacementGroups } from './alternatives.js'
import { EXIDX } from './exercises.js'
import { stepWeight } from './equipment.js'
import { programProgress } from './guided-programs.js'
import { e1rmSeries, bestTestedOneRM } from './onerm.js'
import { forYou, memberContext } from './train2j.js'
import { workingLoadEvidence, effectiveRoutine } from './history.js'
import { isoOf } from './format.js'
import { progressionWorkouts } from './workout-policy.js'

const DAY = 86400000
const workSets = e => (e?.sets || []).filter(s => s.done && s.type !== 'warmup' && s.type !== 'drop')
const stamp = w => Number(w?.end || w?.start) || (w?.d ? Date.parse(`${w.d}T12:00:00`) : 0)
const effort = s => s.rpe ?? (s.rir != null ? 10 - s.rir : null)
const last = list => list[list.length - 1]
const repRange = target => {
  const top = Number(target?.targetRepsMax ?? target?.reps)
  return top > 0 ? [Math.min(Number(target?.targetRepsMin ?? target?.repsMin) || top, top), top] : null
}

export function intelligenceContext(S, { now = Date.now() } = {}) {
  const workouts = progressionWorkouts(S.workouts).filter(w => stamp(w) && stamp(w) <= now).slice(-36).map(w => ({
    d: w.d, start: w.start, end: w.end,
    src2j: w.src2j?.program ? { program: { programId: w.src2j.program.programId, sessionId: w.src2j.program.sessionId } } : undefined,
    entries: (w.entries || []).map(e => ({ id: e.id,
      target: e.target ? { sets: e.target.sets, reps: e.target.reps, repsMin: e.target.repsMin, targetRepsMin: e.target.targetRepsMin, targetRepsMax: e.target.targetRepsMax } : null,
      sets: (e.sets || []).map(s => ({ w: s.w, r: s.r, rpe: s.rpe, rir: s.rir, feel: s.feel, type: s.type, done: s.done })) })),
  }))
  const program = (S.programs || []).find(p => p.id === S.activeProgramId && p.source === 'guided-v2' && p.status === 'active') || null
  const progress = program ? programProgress(program, S.workouts || []) : null
  const activeGym = activeGymProfile(S)
  const declared = memberContext(S)
  return {
    now, workouts,
    program: program ? { id: program.id, catalogId: program.catalogId, status: program.status, sessionsPerWeek: program.sessionsPerWeek, name: program.name } : null,
    progress: progress ? { total: progress.total, completed: progress.completed, percent: progress.percent, next: progress.next } : null,
    gym: { id: activeGym.id, type: activeGym.type, availableEquipment: activeGym.availableEquipment },
    user: { goal: declared.goal, level: declared.level, restrictions: declared.restrictions,
      preferences: { unit: S.unit || 'kg', progressiveOverloadEnabled: S.enableProgressiveOverloadCoach !== false } },
    // Explicitly omit Health, Community, social messages and private notes. Existing Coach
    // consent/permissions remain the only route to provider context.
  }
}

export function intelligenceSignals(S, options = {}) {
  const ctx = intelligenceContext(S, options)
  const { now, workouts, program, progress } = ctx
  const programRecord = program && (S.programs || []).find(p => p.id === program.id)
  const signals = []
  const add = (type, key, facts, priority = 'medium') => signals.push({ type, key, facts, priority })
  if (program && progress?.next) {
    add('PROGRAM_NEXT_SESSION', program.id, { programId: program.id, session: progress.next,
      routine: { name: programRecord?.routineSnapshots?.[progress.next.routineId]?.name || null }, completed: progress.completed,
      total: progress.total, sessionsPerWeek: program.sessionsPerWeek }, 'high')
    const thisWeek = workouts.filter(w => now - stamp(w) < 7 * DAY && w.src2j?.program?.programId === program.id).length
    if (thisWeek >= Math.min(2, program.sessionsPerWeek || 3)) add('ADHERENCE_GOOD', program.id, { thisWeek }, 'low')
    const gap = (now - Math.max(workouts.length ? stamp(last(workouts)) : 0, Number(programRecord?.startedAt) || 0)) / DAY
    const missedAfter = Math.max(5, Math.ceil(7 / (program.sessionsPerWeek || 3)) + 2)
    if (gap >= missedAfter && gap < 14) add('MISSED_SESSION', program.id, { days: Math.floor(gap) }, 'medium')
  }
  if (workouts.length && now - stamp(last(workouts)) >= 14 * DAY)
    add('RETURN_AFTER_GAP', 'training', { days: Math.floor((now - stamp(last(workouts))) / DAY) }, 'high')

  const exposures = new Map()
  for (const workout of workouts.slice(-20)) for (const entry of workout.entries || []) {
    const sets = workSets(entry)
    if (!sets.length) continue
    const arr = exposures.get(entry.id) || []
    arr.push({ entry, sets, date: stamp(workout), d: workout.d })
    exposures.set(entry.id, arr.slice(-4))
  }
  for (const [exerciseId, history] of exposures) {
    const current = last(history)
    const ex = EXIDX[exerciseId]
    const range = repRange(current.entry.target)
    if (!ex || !range || now - current.date > 10 * DAY || !compatibleWithGym(S, ex) || ctx.user.restrictions.length) continue
    const [min, max] = range
    const [prior] = history.slice(-2)
    const reached = h => h && h.sets.length >= (h.entry.target?.sets || h.sets.length) && h.sets.every(s =>
      s.r >= max && s.feel !== 'hard' && s.feel !== 'fail' && (effort(s) == null || effort(s) <= 8) &&
      (s.feel === 'good' || s.feel === 'easy' || (effort(s) != null && effort(s) <= 8)))
    const failed = h => h && h.sets.some(s => s.feel === 'fail' || (s.r < min && effort(s) >= 9))
    const weight = workingLoadEvidence(current.sets).weight
    if (S.enableProgressiveOverloadCoach !== false && history.length >= 2 && weight > 0 && reached(current) && reached(prior) &&
      workingLoadEvidence(prior.sets).weight === weight) {
      const next = stepWeight(S, ex.eq, weight, 1)
      if (next > weight) add('PROGRESSION_READY', exerciseId, { exerciseId, weight, next, max, min, sessions: 2, evidenceAt: current.date }, 'high')
    } else if (history.length >= 2 && failed(current) && failed(prior))
      add('LOAD_TOO_HIGH', exerciseId, { exerciseId, sessions: 2, evidenceAt: current.date }, 'medium')

    if (history.length >= 3) {
      const three = history.slice(-3)
      const best = h => Math.max(...h.sets.map(s => Number(s.w) || 0))
      const reps = h => Math.max(...h.sets.map(s => Number(s.r) || 0))
      if (three.every(h => best(h) === best(three[0]) && reps(h) === reps(three[0])) && !signals.some(s => s.key === exerciseId))
        add('PLATEAU', exerciseId, { exerciseId, sessions: 3, evidenceAt: current.date }, 'medium')
    }
    if (history.length >= 2 && now - current.date <= 7 * DAY) {
      const series = e1rmSeries(S, exerciseId)
      const newest = last(series)
      const priorBest = Math.max(bestTestedOneRM(S, exerciseId)?.est1RM || 0, ...series.slice(0, -1).map(p => p.y))
      if (newest && newest.d === current.d && priorBest > 0 && newest.y > priorBest)
        add('PR_RECENT', exerciseId, { exerciseId, evidenceAt: current.date }, 'low')
    }
  }
  const planned = programRecord?.routineSnapshots?.[progress?.next?.routineId] ||
    (S.routines || []).find(r => r.id === S.active?.routineId) ||
    (S.dayPlan ? effectiveRoutine(S, isoOf(new Date(now))) : null)
  const today = isoOf(new Date(now))
  if (!program && planned && !S.active && !workouts.some(w => w.d === today))
    add('NEXT_SESSION', planned.id, { routineId: planned.id, routineName: planned.name }, 'high')
  const incompatible = (planned?.ex || []).find(e => EXIDX[e.id] && !compatibleWithGym(S, EXIDX[e.id]))
  if (incompatible) {
    // Equipment compatibility alone cannot prove a swap respects a declared restriction.
    const replacement = ctx.user.restrictions.length ? null : getReplacementGroups(S, incompatible.id).recommended.find(r => compatibleWithGym(S, r.ex))
    add('EQUIPMENT_CONFLICT', incompatible.id, { exerciseId: incompatible.id, replacementId: replacement?.ex.id || null, gymId: ctx.gym.id }, 'high')
  }
  if (!program && !S.active && Array.isArray(options.officialRoutines)) {
    const pick = forYou(options.officialRoutines.filter(r => r.official !== false), S,
      { lookup: id => EXIDX[id], now, max: 4 }).find(x => gymRoutineCompatibility(S, x.routine).compatible)
    if (pick) add('CONTENT_SUGGESTION', pick.routine.id,
      { routineId: pick.routine.id, routineName: pick.routine.name, reasons: pick.reasons }, 'low')
  }
  return signals
}

const order = { high: 0, medium: 1, low: 2 }
export function intelligenceRecommendations(S, options = {}) {
  const now = options.now || Date.now()
  const signals = intelligenceSignals(S, { now, officialRoutines: options.officialRoutines })
  const program = (S.programs || []).find(p => p.id === S.activeProgramId)
  const values = signals.map(signal => {
    const { type, key, facts, priority } = signal
    const exercise = facts.exerciseId && EXIDX[facts.exerciseId]
    const base = { id: `i2j:${type}:${key}`, type, priority, source: 'training-history', confidence: 'medium', createdAt: now,
      expiresAt: facts.evidenceAt ? facts.evidenceAt + (type === 'PR_RECENT' ? 7 : 10) * DAY : null, facts,
      relatedExerciseId: facts.exerciseId || null, relatedProgramId: facts.programId || null }
    switch (type) {
      case 'PROGRAM_NEXT_SESSION': return { ...base, title: 'Continue your program', summary: facts.routine?.name || program?.name || 'Next session',
        reason: `Session ${facts.completed + 1} of ${facts.total} is next. Continue when you can; no catch-up sessions are required.`, source: 'active-program', confidence: 'high', action: { label: 'View program', route: `/train2j/program/${program?.catalogId}` } }
      case 'NEXT_SESSION': return { ...base, title: 'Your session today', summary: facts.routineName,
        reason: 'This routine is scheduled in your existing plan for today. Start it when you are ready; nothing has changed automatically.', source: 'active-plan', confidence: 'high', relatedRoutineId: facts.routineId, action: { label: 'View plan', route: '/plan' } }
      case 'PROGRESSION_READY': return { ...base, title: `${exercise?.n || 'Exercise'}: ready to progress`, summary: `Consider ${facts.next} ${S.unit || 'kg'} next time`,
        reason: `You reached ${facts.max} reps in two sessions at ${facts.weight} ${S.unit || 'kg'} without high effort or negative feedback. The next load matches your equipment increment.`, confidence: 'high', action: { label: 'Review in workout', route: S.active ? '/workout' : '/plan' } }
      case 'LOAD_TOO_HIGH': return { ...base, title: `Review ${exercise?.n || 'your load'}`, summary: 'Consider holding or adjusting your target',
        reason: 'Two recent sessions included a failed set or high effort below the rep range. Nothing has been changed.', action: { label: 'View history', route: '/stats' } }
      case 'PLATEAU': return { ...base, title: `Review ${exercise?.n || 'your progression'}`, summary: 'Three similar exposures',
        reason: 'Your best load and reps were unchanged across three sessions. This is a training pattern, not a diagnosis.', confidence: 'low', action: { label: 'View progress', route: '/stats' } }
      case 'EQUIPMENT_CONFLICT': return { ...base, title: 'Equipment differs from your plan', summary: `${exercise?.n || 'An exercise'} may not fit this training place`,
        reason: `The active Gym Profile does not include the required equipment category.${facts.replacementId ? ' A compatible alternative exists in the current swap engine.' : ''} Your routine has not changed.`, source: 'gym-profile', confidence: 'high', action: { label: 'Review alternatives', route: S.active ? '/workout' : '/plan' } }
      case 'RETURN_AFTER_GAP': return { ...base, title: 'Welcome back to training', summary: 'Resume at your own pace',
        reason: `Your last logged workout was ${facts.days} days ago. Consider an easier return if needed; your program and loads remain unchanged.`, confidence: 'high', action: { label: 'View your plan', route: '/plan' } }
      case 'MISSED_SESSION': return { ...base, title: 'Continue when ready', summary: 'Your next program session is waiting',
        reason: `Your last workout was ${facts.days} days ago. Continue with the next logical session; no double session is required.`, source: 'active-program', action: { label: 'View program', route: `/train2j/program/${program?.catalogId}` } }
      case 'PR_RECENT': return { ...base, title: `A recent best in ${exercise?.n || 'your workout'}`, summary: 'Build on your progress',
        reason: 'Your estimated best improved against previous logged sessions. A PR alone does not mean you should raise the load immediately.', action: { label: 'View progress', route: '/stats' } }
      case 'ADHERENCE_GOOD': return { ...base, title: 'Good program consistency', summary: `${facts.thisWeek} sessions this week`,
        reason: 'Your completed workouts count toward the active program. Continue with the next planned session.', source: 'active-program', action: { label: 'View program', route: `/train2j/program/${program?.catalogId}` } }
      case 'CONTENT_SUGGESTION': return { ...base, title: 'An official 2J session for you', summary: facts.routineName,
        reason: 'This existing 2J routine fits your declared goal or level, restrictions and available equipment. Your plan has not changed.', source: 'official-2j-content', relatedRoutineId: facts.routineId, action: { label: 'View routine', route: `/train2j/r/${facts.routineId}` } }
      default: return null
    }
  }).filter(Boolean)
  // A return after a long gap takes precedence over progression/plateau based on older exposures.
  const returning = values.some(v => v.type === 'RETURN_AFTER_GAP')
  const sorted = values.filter(v => !returning || !['PROGRESSION_READY', 'PLATEAU', 'LOAD_TOO_HIGH'].includes(v.type))
    .sort((a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id))
  const seen = new Set()
  return sorted.filter(v => {
    const key = v.relatedExerciseId || v.id
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, options.max || 3)
}
