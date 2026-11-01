/** Day-plan markers keep the existing string value contract and add no separate planner state. */
export const movedDayValue = (target, routineId) => `moved:${target}:${routineId}`

export function parseMovedDay(value) {
  const match = /^moved:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(value || ''))
  return match ? { to: match[1], routineId: match[2] } : null
}

export function dayPlanRoutineId(value) {
  if (typeof value !== 'string') return null
  return parseMovedDay(value)?.routineId || (value === 'rest' ? null : value || null)
}

export const isMovedDayPlan = value => !!parseMovedDay(value)
