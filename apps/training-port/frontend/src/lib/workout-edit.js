import { workoutVolume } from './history.js'

const sameIds = (current, next) => Array.isArray(next) && current.length === next.length && current.every((entry, i) => entry?.id === next[i]?.id)
const finiteField = (value, name) => {
  if (value === '' || value == null) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${name}`)
  return number
}

export function editWorkoutEntries(workout, entries) {
  if (!workout || !sameIds(workout.entries || [], entries)) throw new Error('Workout exercises cannot be replaced in this edit')
  const normalized = entries.map((entry, i) => {
    if (!Array.isArray(entry.sets) || !entry.sets.length || entry.sets.length > 30) throw new Error('Invalid workout sets')
    const old = workout.entries[i]
    return { ...old, sets: entry.sets.map((set, si) => {
      if (!old.sets?.[si] && set.done !== true) throw new Error('A new set must be marked as completed')
      const out = { ...(old.sets?.[si] || {}), ...set }
      for (const key of ['w', 'r', 'sec', 'min', 'speed']) {
        const value = finiteField(set[key], key)
        if (value === undefined) delete out[key]
        else out[key] = value
      }
      out.done = set.done === true
      return out
    }) }
  })
  const next = { ...workout, entries: normalized }
  next.vol = workoutVolume(next)
  return next
}

export function recalculateWorkoutPRFlags(workouts) {
  const best = new Map()
  return (workouts || []).map(workout => {
    const prs = []
    if (workout.excludeFromProgression !== true) for (const entry of workout.entries || []) {
      const max = Math.max(0, Number(entry.topW) || 0, ...(entry.sets || []).filter(set => set.done).map(set => Number(set.w) || 0))
      if (max > 0) {
        if (max > (best.get(entry.id) || 0)) prs.push(entry.id)
        best.set(entry.id, Math.max(max, best.get(entry.id) || 0))
      }
    }
    return { ...workout, prs }
  })
}

export function setWorkoutExcluded(workouts, id, excluded) {
  const changed = (workouts || []).map(workout => workout.id === id
    ? { ...workout, ...(excluded ? { excludeFromProgression: true } : { excludeFromProgression: false }) }
    : workout)
  return recalculateWorkoutPRFlags(changed)
}

export function replaceWorkoutEntries(workouts, id, entries) {
  const changed = (workouts || []).map(workout => workout.id === id ? editWorkoutEntries(workout, entries) : workout)
  return recalculateWorkoutPRFlags(changed)
}

/** Rebuild a performance cache when its originating day/session is edited or excluded. */
export function reconcileExerciseWeightCache(exWeights, workouts, affectedWorkout) {
  const next = { ...(exWeights || {}) }
  const ids = new Set((affectedWorkout?.entries || []).map(e => e.id))
  ids.forEach(id => {
    const cached = next[id]
    if (!cached || cached.sourceWorkoutId !== affectedWorkout.id) return
    let best = null
    for (const w of workouts || []) {
      if (!w || w.excludeFromProgression === true) continue
      for (const entry of w.entries || []) {
        if (entry.id !== id) continue
        const max = Math.max(0, Number(entry.topW) || 0, ...(entry.sets || []).filter(s => s.done).map(s => Number(s.w) || 0))
        if (max > (best?.w || 0)) best = { w: max, d: w.d, sourceWorkoutId: w.id }
      }
    }
    if (best?.w > 0) next[id] = best
    else delete next[id]
  })
  return next
}
