import { EXIDX } from './exercises.js'
import { cleanupSg, effectiveRoutineId, modeOf } from './history.js'
import { isoOf } from './format.js'
import { dayPlanRoutineId, isMovedDayPlan, movedDayValue, parseMovedDay } from './day-plan.js'
import { isInMuscleGroup, MUSCLE_GROUPS } from './muscles.js'
import { checkinAdvice, checkinOn } from './checkin.js'

const clone = value => JSON.parse(JSON.stringify(value))
const roundHalf = n => Math.round(n * 2) / 2
const norm = value => String(value || '').trim().toLowerCase()

function muscleKeys(cfg) {
  const ex = EXIDX[cfg?.id] || {}
  return new Set([ex.tg, ex.mg, ...(ex.sm || [])].map(norm).filter(Boolean))
}

function isExplicitAnchor(cfg) {
  const p = cfg?.priority
  return modeOf(cfg) === 'cardio' || cfg?.basic === true || cfg?.compound === true || cfg?.core === true ||
    cfg?.anchor === true || cfg?.required === true || cfg?.mandatory === true || p === true ||
    ['anchor', 'primary', 'high', 'priority'].includes(norm(p)) || !!cfg?.restriction || !!cfg?.injury
}

function servesPriority(cfg, priority) {
  const aliases = { quads: 'quadriceps', glutes: 'gluteal', hamstrings: 'hamstring', shoulders: 'deltoids' }
  const key = aliases[priority] || priority
  return muscleKeys(cfg).has(norm(priority)) || muscleKeys(cfg).has(norm(key)) ||
    (MUSCLE_GROUPS.some(group => group.key === key) && isInMuscleGroup(EXIDX[cfg?.id] || cfg, key))
}

export function expressAnchorIds(routine, S = {}) {
  const exercises = routine?.ex || []
  const priorities = new Set((S.priorityMuscles || []).map(norm))
  const checkin = checkinOn(S)
  return exercises.filter((cfg, i) => i === 0 || isExplicitAnchor(cfg) || checkinAdvice(checkin, EXIDX[cfg.id] || cfg)?.zones.length > 0 ||
    [...priorities].some(priority => servesPriority(cfg, priority))).map(x => x.id)
}

function estimateEntryMinutes(cfg, S = {}) {
  const sets = Math.max(1, Number(cfg.sets) || 1)
  const mode = modeOf(cfg)
  if (mode === 'cardio') return Math.max(1, Number(cfg.min) || 20) * sets
  const rest = restMinutes(cfg, S)
  const work = mode === 'time' ? Math.max(0.25, (Number(cfg.sec) || 45) / 60) : Math.max(0.25, (Number(cfg.reps) || 10) * 0.06)
  const warmup = S.warmupEnabled !== false && mode === 'reps' && Number(cfg.weight) > 0 ? 2 : 0
  const dropset = cfg.dropset ? 1 : 0
  return 1 + (sets + warmup + dropset) * (work + rest)
}

function restMinutes(cfg, S = {}) {
  const seconds = cfg?.rest != null ? Number(cfg.rest) : S.restSec != null ? Number(S.restSec) : 90
  return Math.max(0, Number.isFinite(seconds) ? seconds : 90) / 60
}

export function estimateRoutineMinutes(routine, S = {}) {
  if (!routine?.ex?.length) return 0
  const total = routine.ex.reduce((sum, cfg) => sum + estimateEntryMinutes(cfg, S), 0)
  const groups = new Map()
  routine.ex.forEach(x => { if (x.sg) groups.set(x.sg, [...(groups.get(x.sg) || []), x]) })
  const savings = [...groups.values()].filter(pair => pair.length === 2 && (Number(pair[0].sets) || 1) === (Number(pair[1].sets) || 1))
    .reduce((sum, pair) => sum + Math.min(restMinutes(pair[0], S), restMinutes(pair[1], S)) / 2, 0)
  return roundHalf(Math.max(0, total - savings))
}

function compatibleSuperset(a, b, S) {
  if (!a || !b || modeOf(a) !== 'reps' || modeOf(b) !== 'reps') return false
  const am = muscleKeys(a), bm = muscleKeys(b)
  if (!am.size || !bm.size) return false
  const ae = norm(EXIDX[a.id]?.eq), be = norm(EXIDX[b.id]?.eq)
  return restMinutes(a, S) > 0 && restMinutes(b, S) > 0 && ae === be &&
    ![...am].some(m => bm.has(m)) && (Number(a.sets) || 1) === (Number(b.sets) || 1)
}

function pairSafeAccessories(exercises, anchors, S) {
  const paired = []
  for (let i = 0; i + 1 < exercises.length; i++) {
    const a = exercises[i], b = exercises[i + 1]
    if (anchors.has(a.id) || anchors.has(b.id) || a.sg || b.sg || !compatibleSuperset(a, b, S)) continue
    const id = `express-${paired.length + 1}`
    a.sg = id; b.sg = id; paired.push([a.id, b.id]); i++
  }
  return paired
}

/** Build a session-only routine copy. The caller never writes `routine` back to S.routines. */
export function previewExpressSession(routine, minutes, S = {}) {
  if (![15, 25, 40].includes(Number(minutes)) || !routine?.ex?.length) return null
  const sessionRoutine = clone(routine)
  const anchors = new Set(expressAnchorIds(routine, S))
  const changes = { removed: [], reducedSets: [], removedDropSets: [], shortenedWarmups: [], supersets: [] }
  const goal = Number(minutes)
  const estimate = () => {
    const timed = clone(sessionRoutine)
    cleanupSg(timed.ex)
    pairSafeAccessories(timed.ex, anchors, S)
    return estimateRoutineMinutes(timed, S)
  }
  const accessories = () => sessionRoutine.ex.filter(x => !anchors.has(x.id))

  // First remove optional drop work, then trim accessory sets. Each action preserves the
  // movement itself; no exercise with an anchor/priority/restriction marker is removed.
  for (const cfg of [...accessories()].reverse()) {
    if (estimate() <= goal) break
    if (cfg.dropset) { delete cfg.dropset; changes.removedDropSets.push(cfg.id) }
  }
  for (const cfg of [...accessories()].reverse()) {
    while (estimate() > goal && (Number(cfg.sets) || 1) > 1) {
      const from = Number(cfg.sets) || 1
      cfg.sets = from - 1
      const previous = changes.reducedSets.find(x => x.id === cfg.id)
      if (previous) previous.to = cfg.sets
      else changes.reducedSets.push({ id: cfg.id, from, to: cfg.sets })
    }
  }
  // With accessories reduced to one set, remove the least-priority accessories from the end.
  // Basics/anchors are not deleted; their volume is only reduced as a last resort below.
  for (const cfg of [...sessionRoutine.ex].reverse()) {
    if (estimate() <= goal) break
    if (anchors.has(cfg.id)) continue
    sessionRoutine.ex = sessionRoutine.ex.filter(x => x.id !== cfg.id)
    changes.removed.push({ id: cfg.id, reason: 'accessory' })
  }
  cleanupSg(sessionRoutine.ex)
  for (const cfg of [...sessionRoutine.ex].reverse()) {
    if (estimate() <= goal) break
    if (!anchors.has(cfg.id)) continue
    while (estimate() > goal && (Number(cfg.sets) || 1) > 1) {
      const from = Number(cfg.sets) || 1
      cfg.sets = from - 1
      const previous = changes.reducedSets.find(x => x.id === cfg.id)
      if (previous) previous.to = cfg.sets
      else changes.reducedSets.push({ id: cfg.id, from, to: cfg.sets })
    }
  }

  // Existing warm-up preference is untouched. The session copy retains only the final ramp
  // set for non-anchor exercises; the main movement keeps its full warm-up.
  changes.supersets = pairSafeAccessories(sessionRoutine.ex, anchors, S)
  const estimatedMin = estimateRoutineMinutes(sessionRoutine, S)
  return {
    routine: sessionRoutine,
    info: {
      kind: 'express', minutes: goal, estimatedMin,
      keptExerciseIds: sessionRoutine.ex.map(x => x.id), anchorIds: [...anchors],
      removed: changes.removed, reducedSets: changes.reducedSets,
      removedDropSets: changes.removedDropSets, shortenedWarmups: changes.shortenedWarmups,
      supersets: changes.supersets, overBudget: estimatedMin > goal,
      reason: 'accessories_first'
    },
  }
}

/** Applied after normal routine prescription building; only the active session is affected. */
export function shortenExpressWarmups(entries, expressInfo) {
  if (!expressInfo) return { entries, shortenedWarmups: [] }
  const anchors = new Set(expressInfo.anchorIds || [])
  const shortenedWarmups = []
  const next = entries.map(entry => {
    if (anchors.has(entry.id)) return entry
    const warmups = entry.sets.filter(s => s.type === 'warmup')
    if (warmups.length < 2) return entry
    shortenedWarmups.push(entry.id)
    let warmupIndex = 0
    return { ...entry, sets: entry.sets.filter(s => s.type !== 'warmup' || ++warmupIndex === warmups.length) }
  })
  return { entries: next, shortenedWarmups }
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}
export function movedFromForDate(S, iso, routineId) {
  return Object.entries(S?.dayPlan || {}).find(([, value]) => {
    const move = parseMovedDay(value)
    return move?.to === iso && move.routineId === routineId
  })?.[0] || null
}

function majorGroups(routine) {
  const large = new Set(['chest', 'back', 'shoulders', 'upper legs', 'lower legs'])
  return new Set((routine?.ex || []).map(x => norm((EXIDX[x.id] || {}).bp)).filter(x => large.has(x)))
}
function routineForWorkout(S, workout) {
  return (S.routines || []).find(r => r.id === workout?.routineId) || (workout?.entries?.length ? { ex: workout.entries } : null)
}
function overlaps(a, b) { return [...a].some(x => b.has(x)) }
function dateDistance(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) }

/** Derived suggestion from the existing effective week/dayPlan and workouts; no stored planner state. */
export function weekReorderSuggestion(S, today) {
  if (!S || S.active) return null
  const lookbackStart = addDays(today, -7)
  const adjacentEnd = addDays(today, 8)
  const workoutByDate = new Map()
  for (const workout of S.workouts || []) {
    if (!workout.d || workout.d < lookbackStart || workout.d > adjacentEnd) continue
    if (!workoutByDate.has(workout.d)) workoutByDate.set(workout.d, [])
    workoutByDate.get(workout.d).push(workout)
  }
  const completed = new Set(workoutByDate.keys())
  const missed = []
  for (let date = lookbackStart; date < today; date = addDays(date, 1)) {
    const rid = S.dayPlan?.[date] !== undefined ? (S.dayPlan[date] === 'rest' || isMovedDayPlan(S.dayPlan[date]) ? null : dayPlanRoutineId(S.dayPlan[date])) : null
    const effectiveId = rid || (S.dayPlan?.[date] === undefined ? effectiveRoutineId(S, date) : null)
    if (!effectiveId || completed.has(date) || isMovedDayPlan(S.dayPlan?.[date])) continue
    const routine = (S.routines || []).find(r => r.id === effectiveId)
    if (routine) missed.push({ date, routineId: routine.id, routine })
  }
  const missedSession = missed[0]
  if (!missedSession) return null
  const groups = majorGroups(missedSession.routine)
  const planned = date => {
    const wid = workoutByDate.get(date)?.[0]
    if (wid) return routineForWorkout(S, wid)
    if (date < today) return null // a scheduled session that was missed is not recovery work
    const id = effectiveRoutineId(S, date)
    return (S.routines || []).find(r => r.id === id) || null
  }
  const candidates = []
  for (let date = today; date <= addDays(today, 7); date = addDays(date, 1)) {
    if (S.dayPlan?.[date] !== undefined || completed.has(date) || effectiveRoutineId(S, date) ||
        (S.active && S.active.d === date)) continue
    const previous = planned(addDays(date, -1)), next = planned(addDays(date, 1))
    const conflict = [previous, next].some((r, i) => r && overlaps(groups, majorGroups(r)) &&
      Math.abs(dateDistance(i === 0 ? addDays(date, -1) : addDays(date, 1), date)) < 2)
    if (conflict) continue
    candidates.push({ date, reason: 'open_recovery_safe', routineId: missedSession.routineId })
  }
  if (candidates.length) return { ...missedSession, target: candidates[0].date, reason: 'open_recovery_safe', expressAvailable: false }
  return { ...missedSession, target: today, reason: 'no_recovery_safe_gap', expressAvailable: true }
}

export function applyWeekReorder(dayPlan, suggestion) {
  if (!suggestion || !suggestion.routineId || !suggestion.date || !suggestion.target || suggestion.expressAvailable) return null
  const next = { ...(dayPlan || {}) }
  if (next[suggestion.target] !== undefined) return null
  next[suggestion.date] = movedDayValue(suggestion.target, suggestion.routineId)
  next[suggestion.target] = suggestion.routineId
  return next
}

export function clearRescheduleAtDate(dayPlan, date) {
  const next = { ...(dayPlan || {}) }
  const own = parseMovedDay(next[date])
  if (own) {
    if (next[own.to] === own.routineId) delete next[own.to]
    delete next[date]
  }
  for (const [source, value] of Object.entries(next)) if (parseMovedDay(value)?.to === date) delete next[source]
  return next
}

export function sessionHistoryMetadata(active) {
  return {
    ...(active?.sessionPlan ? { sessionPlan: active.sessionPlan } : {}),
    ...(active?.rescheduledFrom ? { rescheduledFrom: active.rescheduledFrom } : {})
  }
}
