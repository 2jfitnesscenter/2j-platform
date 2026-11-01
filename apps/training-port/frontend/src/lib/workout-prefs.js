// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// How a member wants the live workout presented — the PREFERENCES layer, kept apart from the
// two layers a session actually carries (see views/Workout.jsx):
//   · prescription — entry.target (a snapshot of the routine slot, trainer note included) and
//     entry.plan (what the routine's progression policy decided, and why)
//   · result       — entry.sets (what was really lifted)
// Nothing read here is ever written into S.active; switching any of it mid-session only changes
// how the same session is drawn.
//
// Every key is optional in S and read with its default here, in one place, so a profile saved
// before a preference existed keeps exactly the behaviour it had (the detailed set list, images
// and sounds on, nothing auto-completed). New profiles get their own starting point from
// NEW_PROFILE_DEFAULTS instead — written once, the moment the post-registration wizard marks the
// profile onboarded, never onto an existing account.
import { uxOn } from './features.js'

export const WORKOUT_VIEWS = ['simple', 'detailed']

export function workoutPrefs(S) {
  return {
    view: S.workoutView === 'simple' ? 'simple' : 'detailed',
    images: S.showExerciseImages !== false,
    tips: S.showExerciseTips !== false,
    autoComplete: S.autoCompleteSets === true,
    // Rest alert: whether the end of a rest is announced at all. Sound reuses the long-standing
    // S.sound switch (it has always governed every workout beep); vibration is its own switch.
    restAlert: S.restAlert !== false,
    sound: !!S.sound,
    vibrate: S.restVibrate !== false,
    progression: S.enableProgressiveOverloadCoach !== false && uxOn(S, 'suggestions'),
  }
}

// The roadmap's starting point for a brand-new account. Real field names, no duplicates of
// anything DEF already declares: the four existing switches are simply set the other way, and
// the two new ones say "simple view" and "show the training guide before the first workout".
export const NEW_PROFILE_DEFAULTS = {
  warmupEnabled: false,
  enableBioimpedanceReminder: false,
  enableTrainingZones: false,
  enableProgressiveOverloadCoach: false,
  glass: true,
  workoutView: 'simple',
  workoutGuidePending: true,
}

// Called from the post-registration wizard only (views/PhysicalProfileWizard.jsx) — the one
// moment a profile is provably new. A profile that already trained is never touched.
export function applyNewProfileDefaults(s) {
  if ((s.workouts || []).length) return s
  Object.assign(s, NEW_PROFILE_DEFAULTS)
  return s
}

// The visual training guide opens before a new member's first REAL workout (not a backdated
// log) and never on its own for anyone else — existing profiles never carry the flag.
export const shouldShowWorkoutGuide = (S, { past = false } = {}) =>
  !past && S.workoutGuidePending === true && !(S.workouts || []).length
