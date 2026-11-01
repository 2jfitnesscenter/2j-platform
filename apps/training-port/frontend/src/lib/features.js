// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Adaptive UX: what each member sees = what the ADMIN allows ∩ what the MEMBER chose ∩ what the DATA justifies.
//
//   1. Admin switches (server, GET /api/features → store.features): a feature the admin turned off is gone for
//      everybody and can never be re-enabled from here. Absent / not loaded / offline = ON (today's behaviour).
//   2. Member preferences (S.ux, in the member's own synced state — no second preference system): can only
//      narrow what the admin left on. `S.ux === null` means "never personalised": everything allowed is on.
//   3. Data: screens decide their own depth (e.g. no empty charts) — see the Stats modules.
//
// Nothing is ever deleted: hiding a feature keeps its data, and switching it back on restores it.

// Keep in sync with api/lib/features-store.js (a test compares the two lists).
export const FEATURE_KEYS = [
  'coach', 'suggestions', 'effort', 'volume', 'train2j', 'health', 'bioimpedance', 'recovery',
  'bodyweight', 'social', 'chat', 'friends', 'challenges', 'activity', 'timeline', 'premium',
]

// Admin screen: grouped, plain-language. `icon` is an existing Icon name.
export const FEATURE_GROUPS = [
  { title: 'Training', keys: [
    { key: 'effort', icon: 'flame', label: 'Effort (RPE / RIR)', sub: 'Rate how hard each set felt and see effort trends' },
    { key: 'volume', icon: 'chart', label: 'Volume analysis', sub: 'Weekly volume zones and training-zone breakdowns' },
    { key: 'suggestions', icon: 'sparkles', label: 'Suggestions & progression', sub: 'Contextual tips and next-load recommendations' },
    { key: 'train2j', icon: 'dumbbell', label: 'Train with 2J', sub: 'Official ready-to-start routines, programs and collections' },
    { key: 'premium', icon: 'trophy', label: 'Premium training programs', sub: 'Structured methods with cycles and a Training Max (new activations; a running program is never switched off)' },
  ] },
  { title: 'Health', keys: [
    { key: 'bodyweight', icon: 'scale', label: 'Body weight', sub: 'Weight log and evolution' },
    { key: 'bioimpedance', icon: 'figureStrength', label: 'Bioimpedance & measurements', sub: 'Body composition, tape measurements and scan reminders' },
    { key: 'health', icon: 'heart', label: 'Health & daily activity', sub: 'Steps, sleep, heart rate, Apple Health / Health Connect, Whoop' },
    { key: 'recovery', icon: 'bolt', label: 'Recovery', sub: 'Muscle recovery map and score' },
    { key: 'activity', icon: 'figureRun', label: 'Activity indicators', sub: 'Training, activity and recovery rings on Home' },
    { key: 'timeline', icon: 'chartLine', label: 'Progress timeline', sub: 'Recent sessions, records and milestones in Progress' },
  ] },
  { title: 'Experience', keys: [
    { key: 'coach', icon: 'sparkles', label: 'AI Coach', sub: 'Plan design and adjustments by the Coach (needs a provider)' },
    { key: 'social', icon: 'users', label: 'Social', sub: 'The Social tab: wall, moments, shared routines and ranking' },
    { key: 'friends', icon: 'person', label: 'Friends', sub: 'Friend requests and friend profiles' },
    { key: 'chat', icon: 'bell', label: 'Chat', sub: 'Chat with trainers and friends' },
    { key: 'challenges', icon: 'flag', label: 'Challenges & goals', sub: 'Gym challenges and shared goals' },
  ] },
]

// What a member can switch for themselves (a subset, plus `helps`, which is theirs alone — no admin switch).
export const USER_PREFS = ['effort', 'volume', 'suggestions', 'coach', 'recovery', 'bodyweight', 'bioimpedance', 'health', 'train2j', 'social', 'activity', 'timeline', 'helps']
// Features whose member choice is another preference.
const PREF_OF = { chat: 'social', friends: 'social', challenges: 'social' }

let admin = {}   // { key: boolean } from the server; absent = on
export function setAdminFeatures(map) { admin = map && typeof map === 'object' ? { ...map } : {} }
export const getAdminFeatures = () => admin
/** Allowed by the admin (default on). Unknown keys are allowed. */
export const allowedByAdmin = key => admin[key] !== false

/** The member's own choice for a feature (true when never personalised or never chosen). */
export function chosenByMember(S, key) {
  const pref = PREF_OF[key] || key
  if (!USER_PREFS.includes(pref)) return true
  const uses = S?.ux?.uses
  return uses ? uses[pref] !== false : true
}

/** Visible to this member: admin allows it AND the member did not turn it off. */
export const uxOn = (S, key) => allowedByAdmin(key) && chosenByMember(S, key)

/** `helps` (visual helps / first-use hints) is the member's alone. */
export const helpsOn = S => chosenByMember(S, 'helps')

/** Preferences the member can still see in the configurator: the admin-allowed ones (+ `helps`). */
export const configurable = () => USER_PREFS.filter(k => k === 'helps' || allowedByAdmin(k))

// Ready-made starting points for the visual onboarding (the member can adjust every card afterwards).
export const PRESETS = {
  simple: { effort: false, volume: false, suggestions: false, coach: false, recovery: false, bodyweight: false, bioimpedance: false, health: false, activity: false, timeline: false, train2j: true, social: true, helps: true },
  balanced: { effort: false, volume: false, suggestions: true, coach: false, recovery: true, bodyweight: true, bioimpedance: false, health: false, activity: true, timeline: false, train2j: true, social: true, helps: true },
  complete: { effort: true, volume: true, suggestions: true, coach: true, recovery: true, bodyweight: true, bioimpedance: true, health: true, activity: true, timeline: true, train2j: true, social: true, helps: true },
}

/** What to store in S.ux. `uses` only keeps the preferences the member can actually set. */
// `extra.progress` (optional) is the Progress-page layout (lib/progress-cards.js): stored only when it differs from the default, so an untouched profile stays untouched.
// `extra.home` (optional) is the Home layout (lib/home-blocks.js), stored under the same rule.
export const makeUx = (uses, now = Date.now(), extra = {}) => ({ v: 1, at: now, uses: Object.fromEntries(USER_PREFS.map(k => [k, uses?.[k] !== false])), ...(extra?.progress ? { progress: extra.progress } : {}), ...(extra?.home ? { home: extra.home } : {}), ...(extra?.guide ? { guide: extra.guide } : {}) })

/** Current choices for the configurator: S.ux when it exists, otherwise "everything on" (today's behaviour). */
export const currentUses = S => Object.fromEntries(USER_PREFS.map(k => [k, chosenByMember(S, k)]))
