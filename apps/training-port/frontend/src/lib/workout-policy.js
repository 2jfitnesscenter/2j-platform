// A workout can remain in history and attendance/program counts while being excluded from
// performance-derived guidance. This is an additive field on the existing workout record.
export const countsForProgression = workout => workout != null && workout.excludeFromProgression !== true
export const progressionWorkouts = workouts => (Array.isArray(workouts) ? workouts : []).filter(countsForProgression)
