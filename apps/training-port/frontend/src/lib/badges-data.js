// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The badge catalogue — what exists to unlock, not who has unlocked it (that's S.badges,
// see lib/badges.js's evaluateBadges). No TypeScript in this project (plain .js/.jsx
// throughout, no tsconfig) — the shapes below are documented the same way every other
// lib/*.js module in this codebase documents its data (a JSDoc comment), not a .ts file.
//
// Badge shape:
//   id            — string, stable forever (used as the S.badges key — never rename)
//   category      — one of BADGE_CATEGORIES
//   title         — short name shown on the cell and in the unlock celebration
//   description   — the achievement/condition, spelled out ("Completa 10 entrenamientos")
//   icon          — a components/Icon.jsx name — fallback for a badge with no illustrated
//                    `image` (only 'exercises' category badges still rely on this; every other
//                    category now ships a commissioned PNG, see `image` below)
//   image         — public/badges/*.png path — a commissioned 3D-rendered badge illustration,
//                    shown instead of `icon` wherever one exists (BadgeCell/BadgeDetail/
//                    BadgeCelebrationModal all prefer `image` and fall back to `icon`)
//   conditionType — 'total_workouts' | 'weekly_streak' | 'total_volume_kg' | 'strength_score'
//                   | 'first_action' | 'specific_exercise_count'
//   threshold     — number for every numeric conditionType; for 'first_action' a string key
//                   into MILESTONE_CHECKS (lib/badges.js)
//   metric        — 'specific_exercise_count' only: 'distinct' (N different exercises ever
//                   logged) or 'repeat' (the same exercise logged in N different sessions) —
//                   two genuinely different conditions the brief asked to fit under one
//                   conditionType, so this is the discriminator between them
//
// UserBadge (S.badges[badgeId]):
//   badgeId       — string, matches a Badge.id
//   unlockedAt    — ISO timestamp string, or null while still locked
//   progress      — 0..1, how close to unlocking (for a progress bar) — always 1 once unlocked

export const BADGE_CATEGORIES = ['workouts', 'milestones', 'calendar', 'streaks', 'volume', 'strength', 'exercises', 'app']

export const CATEGORY_LABEL = {
  workouts: 'Workouts', milestones: 'Milestones', calendar: 'Calendar', streaks: 'Streaks',
  volume: 'Volume', strength: 'Strength', exercises: 'Exercises', app: 'App',
}
export const CATEGORY_ICON = {
  workouts: 'dumbbell', milestones: 'sparkles', calendar: 'calendar', streaks: 'flame',
  volume: 'barbell', strength: 'shield', exercises: 'exercises', app: 'star',
}
// A category's own "cover" badge (Badges.jsx's category strip + CategoryHeader).
export const CATEGORY_IMAGE = {
  workouts: '/badges/badge-workouts-main.png',
  milestones: '/badges/badge-milestones-main.png',
  calendar: '/badges/badge-calendar-main.png',
  streaks: '/badges/badge-streaks-main.png',
  volume: '/badges/badge-volume-main.png',
  strength: '/badges/badge-strength-main.png',
  exercises: '/badges/badge-exercises-main.png',
  app: '/badges/badge-app-main.png',
}
// The gym's own "master rank" badge, shown once in the Badges screen's header — not a member
// achievement (no S.badges entry, nothing to unlock), just the 2J crest presiding over the page.
export const MASTER_BADGE_IMAGE = '/badges/badge-2j-master.png'

export const BADGES = [
  // ---------- workouts: total finished sessions (5 rungs — one commissioned image each) ----------
  { id: 'workouts_1', category: 'workouts', title: 'First step', description: 'Complete your first workout.', icon: 'dumbbell', image: '/badges/badge-workout-1.png', conditionType: 'total_workouts', threshold: 1 },
  { id: 'workouts_5', category: 'workouts', title: 'Finding a rhythm', description: 'Complete 5 workouts.', icon: 'dumbbell', image: '/badges/badge-workout-5.png', conditionType: 'total_workouts', threshold: 5 },
  { id: 'workouts_10', category: 'workouts', title: 'Consistency', description: 'Complete 10 workouts.', icon: 'dumbbell', image: '/badges/badge-workout-10.png', conditionType: 'total_workouts', threshold: 10 },
  { id: 'workouts_50', category: 'workouts', title: 'Habit forged', description: 'Complete 50 workouts.', icon: 'dumbbell', image: '/badges/badge-workout-50.png', conditionType: 'total_workouts', threshold: 50 },
  { id: 'workouts_100', category: 'workouts', title: 'Centurion', description: 'Complete 100 workouts.', icon: 'dumbbell', image: '/badges/badge-workout-100.png', conditionType: 'total_workouts', threshold: 100 },

  // ---------- milestones: a specific first, not a count ----------
  { id: 'milestone_superset', category: 'milestones', title: 'Double duty', description: 'Complete your first superset.', icon: 'link', image: '/badges/badge-first-superset.png', conditionType: 'first_action', threshold: 'first_superset' },
  { id: 'milestone_dropset', category: 'milestones', title: 'No mercy', description: 'Complete your first drop set.', icon: 'arrowDown', image: '/badges/badge-first-dropset.png', conditionType: 'first_action', threshold: 'first_dropset' },
  { id: 'milestone_cardio', category: 'milestones', title: 'Heart rate up', description: 'Log your first cardio session.', icon: 'figureRun', image: '/badges/badge-first-cardio.png', conditionType: 'first_action', threshold: 'first_cardio' },
  { id: 'milestone_failure', category: 'milestones', title: 'To the limit', description: 'Log your first set taken to failure (RIR 0 / RPE 10).', icon: 'flame', image: '/badges/badge-first-failure.png', conditionType: 'first_action', threshold: 'first_failure_set' },
  { id: 'milestone_fullbody', category: 'milestones', title: 'Full body', description: 'Complete a workout that trains every major muscle group.', icon: 'figureStrength', image: '/badges/badge-fullbody.png', conditionType: 'first_action', threshold: 'first_full_body' },

  // ---------- streaks: consecutive weeks with at least one workout (5 rungs) ----------
  { id: 'streak_1', category: 'streaks', title: 'Off the ground', description: 'Train in 1 week.', icon: 'flame', image: '/badges/badge-streak-1w.png', conditionType: 'weekly_streak', threshold: 1 },
  { id: 'streak_5', category: 'streaks', title: 'Real streak', description: 'Train 5 weeks in a row.', icon: 'flame', image: '/badges/badge-streak-5w.png', conditionType: 'weekly_streak', threshold: 5 },
  { id: 'streak_10', category: 'streaks', title: 'Unstoppable', description: 'Train 10 weeks in a row.', icon: 'flame', image: '/badges/badge-streak-10w.png', conditionType: 'weekly_streak', threshold: 10 },
  { id: 'streak_20', category: 'streaks', title: 'Ironclad', description: 'Train 20 weeks in a row.', icon: 'flame', image: '/badges/badge-streak-20w.png', conditionType: 'weekly_streak', threshold: 20 },
  { id: 'streak_50', category: 'streaks', title: 'Gym legend', description: 'Train 50 weeks in a row.', icon: 'flame', image: '/badges/badge-streak-50w.png', conditionType: 'weekly_streak', threshold: 50 },

  // ---------- volume: accumulated kg lifted, ever (rungs match the 5 commissioned images —
  // 10,000/50,000 dropped and 20,000 added versus the old 6-rung ladder) ----------
  { id: 'volume_5000', category: 'volume', title: 'First tonnes', description: 'Lift 5,000 kg in total.', icon: 'barbell', image: '/badges/badge-volume-5k.png', conditionType: 'total_volume_kg', threshold: 5000 },
  { id: 'volume_20000', category: 'volume', title: '20 tonnes', description: 'Lift 20,000 kg in total.', icon: 'barbell', image: '/badges/badge-volume-20k.png', conditionType: 'total_volume_kg', threshold: 20000 },
  { id: 'volume_100000', category: 'volume', title: '100 tonnes', description: 'Lift 100,000 kg in total.', icon: 'barbell', image: '/badges/badge-volume-100k.png', conditionType: 'total_volume_kg', threshold: 100000 },
  { id: 'volume_250000', category: 'volume', title: 'Quarter million', description: 'Lift 250,000 kg in total.', icon: 'barbell', image: '/badges/badge-volume-250k.png', conditionType: 'total_volume_kg', threshold: 250000 },
  { id: 'volume_1000000', category: 'volume', title: 'A million kilos', description: 'Lift 1,000,000 kg in total.', icon: 'barbell', image: '/badges/badge-volume-1m.png', conditionType: 'total_volume_kg', threshold: 1000000 },

  // ---------- exercises: breadth (distinct exercises) and depth (repeats of one) ----------
  { id: 'exercises_distinct_10', category: 'exercises', title: 'Explorer', description: 'Log 10 different exercises.', icon: 'exercises', image: '/badges/badge-exercise-explorer.png', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 10 },
  { id: 'exercises_distinct_25', category: 'exercises', title: 'Curious', description: 'Log 25 different exercises.', icon: 'exercises', image: '/badges/badge-exercise-curious.png', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 25 },
  { id: 'exercises_distinct_50', category: 'exercises', title: 'Encyclopedic', description: 'Log 50 different exercises.', icon: 'exercises', image: '/badges/badge-exercise-encyclopedic.png', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 50 },
  { id: 'exercises_distinct_100', category: 'exercises', title: 'Catalogue master', description: 'Log 100 different exercises.', icon: 'exercises', image: '/badges/badge-exercise-master.png', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 100 },
  { id: 'exercises_repeat_10', category: 'exercises', title: 'Getting the hang of it', description: 'Train the same exercise across 10 different sessions.', icon: 'reset', image: '/badges/badge-exercise-repeat-10.png', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 10 },
  { id: 'exercises_repeat_25', category: 'exercises', title: 'Old friends', description: 'Train the same exercise across 25 different sessions.', icon: 'reset', image: '/badges/badge-exercise-repeat-25.png', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 25 },
  { id: 'exercises_repeat_50', category: 'exercises', title: 'Inseparable', description: 'Train the same exercise across 50 different sessions.', icon: 'reset', image: '/badges/badge-exercise-repeat-50.png', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 50 },

  // ---------- strength: the global strength score (lib/badges.js's strengthScore, 0-300) ----------
  { id: 'strength_100', category: 'strength', title: 'Solid base', description: 'Reach a strength score of 100.', icon: 'shield', image: '/badges/badge-strength-100.png', conditionType: 'strength_score', threshold: 100 },
  { id: 'strength_150', category: 'strength', title: 'On the rise', description: 'Reach a strength score of 150.', icon: 'shield', image: '/badges/badge-strength-150.png', conditionType: 'strength_score', threshold: 150 },
  { id: 'strength_200', category: 'strength', title: 'Notable strength', description: 'Reach a strength score of 200.', icon: 'shield', image: '/badges/badge-strength-200.png', conditionType: 'strength_score', threshold: 200 },
  { id: 'strength_250', category: 'strength', title: 'Elite', description: 'Reach a strength score of 250.', icon: 'shield', image: '/badges/badge-strength-250.png', conditionType: 'strength_score', threshold: 250 },
  // 300 = strengthScore's absolute ceiling (globalRank's `continuous` capped at its 24-point
  // "Symmetric" sentinel, rescaled) — genuinely reachable, not just a round number past Elite.
  { id: 'strength_master', category: 'strength', title: 'Master level', description: 'Reach the maximum strength score of 300.', icon: 'shield', image: '/badges/badge-strength-master.png', conditionType: 'strength_score', threshold: 300 },

  // ---------- calendar: workout frequency per week/month (lib/badges.js's
  // maxWeeklyWorkoutDays/maxMonthlyWorkoutDays — best-ever count of distinct days trained in a
  // single Mon-Sun week / calendar month, deduped so two sessions the same day count once) ----------
  { id: 'calendar_3w', category: 'calendar', title: 'Weekly rhythm', description: 'Train 3 times in a single week.', icon: 'calendar', image: '/badges/badge-cal-3w.png', conditionType: 'weekly_workout_days', threshold: 3 },
  { id: 'calendar_4w', category: 'calendar', title: 'Dialed in', description: 'Train 4 times in a single week.', icon: 'calendar', image: '/badges/badge-cal-4w.png', conditionType: 'weekly_workout_days', threshold: 4 },
  { id: 'calendar_5w', category: 'calendar', title: 'All in', description: 'Train 5 times in a single week.', icon: 'calendar', image: '/badges/badge-cal-5w.png', conditionType: 'weekly_workout_days', threshold: 5 },
  { id: 'calendar_15m', category: 'calendar', title: 'Monthly grind', description: 'Train 15 times in a single month.', icon: 'calendar', image: '/badges/badge-cal-15m.png', conditionType: 'monthly_workout_days', threshold: 15 },
  { id: 'calendar_20m', category: 'calendar', title: 'Relentless', description: 'Train 20 times in a single month.', icon: 'calendar', image: '/badges/badge-cal-20m.png', conditionType: 'monthly_workout_days', threshold: 20 },

  // ---------- app: community/app-usage actions. Every one but the last has a real trigger
  // wired (see lib/badges.js's MILESTONE_CHECKS): first_friend (Friends.jsx's accept),
  // first_measurement (any weight/girth/composition log), first_favorite (Plan.jsx's routine
  // star), first_share (printing/exporting a routine — RoutineEdit.jsx, Plan.jsx, PlanTools).
  // app_gym_location stays 'not_yet_tracked': it needs the gym's real coordinates and a
  // geolocation-permission decision this catalogue can't make on its own. ----------
  { id: 'app_friend', category: 'app', title: 'Not alone', description: 'Add a friend in 2J Fitness Center.', icon: 'star', image: '/badges/badge-app-friend.png', conditionType: 'first_action', threshold: 'first_friend' },
  { id: 'app_favorite', category: 'app', title: 'A favorite', description: 'Mark a routine as a favorite.', icon: 'star', image: '/badges/badge-app-favorite.png', conditionType: 'first_action', threshold: 'first_favorite' },
  { id: 'app_share', category: 'app', title: 'Spread the word', description: 'Share or export a routine.', icon: 'star', image: '/badges/badge-app-share.png', conditionType: 'first_action', threshold: 'first_share' },
  { id: 'app_measurement', category: 'app', title: 'Know your body', description: 'Log a body measurement.', icon: 'star', image: '/badges/badge-app-measurement.png', conditionType: 'first_action', threshold: 'first_measurement' },
  { id: 'app_gym_location', category: 'app', title: 'Home turf', description: "Check the 2J Fitness Center gym location.", icon: 'star', image: '/badges/badge-app-gym-location.png', conditionType: 'not_yet_tracked' },
]

export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]))
export const BADGES_BY_CATEGORY = Object.fromEntries(BADGE_CATEGORIES.map(c => [c, BADGES.filter(b => b.category === c)]))

// The celebration modal's accent — gold/cyan/emerald, reusing the app's own existing semantic
// tokens (var(--yellow)/var(--teal)/var(--green), the same three effortColor already uses for
// "intensity") rather than introducing new hex literals that would fight a member's chosen
// accent color. Derived from catalogue position, not stored per badge: the single highest
// threshold in a numbered ladder (workouts_200, volume_1000000…) reads as the prestige "gold"
// one, everything else alternates cyan/emerald for variety. A milestone has no ladder to be
// "highest" in, so it just cycles the same way.
const ACCENT_CYCLE = ['cyan', 'emerald']
export const ACCENT_COLOR_VAR = { gold: 'var(--yellow)', cyan: 'var(--teal)', emerald: 'var(--green)' }
export function badgeAccent(b) {
  const list = BADGES_BY_CATEGORY[b.category] || []
  const idx = list.indexOf(b)
  if (list.length > 1 && idx === list.length - 1) return 'gold'
  return ACCENT_CYCLE[Math.max(0, idx) % ACCENT_CYCLE.length]
}
