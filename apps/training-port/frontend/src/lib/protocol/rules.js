// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// 2J Training Protocol — the machine-readable half.
//
// Three places describe the protocol and they must not drift apart:
//   docs/TRAINING_PROTOCOL_2J.md   the human specification (why, in prose)
//   docs/EVIDENCE.md               the bibliography, one record per 2J-EVD-* id
//   this file                      the numbers the product actually runs on
// lib/protocol/protocol-docs.test.js checks that every rule and evidence id here appears in
// those two documents, so a rule cannot be added in code without being written down.
//
// This folder is plain JavaScript with no imports from the rest of the app: scripts/
// sync-protocol.mjs copies it verbatim to api/lib/protocol/ (same arrangement as the Coach's
// library.json), so the server validates with exactly the code the builder shows.
//
// Kinds: 'evidence' — a rule whose substance comes from the cited literature;
//        'heuristic' — a 2J product decision, informed by the literature but not a finding
//        of it (block size, preferred rep zones, rest table, duration estimate…).
// Never present a heuristic as science. Never read a preferred zone as a physiological limit.

export const PROTOCOL_VERSION = '1.0'
export const PROTOCOL_NAME = '2J Training Protocol'

// The 2J effort scale shown to members and trainers: four anchors, not the 1-10 continuum.
// It is not converted to RIR here — RPE 8 is "hard", not "exactly 2 reps in reserve".
export const RPE_2J = [4, 6, 8, 10]
export const RPE_LABEL = {
  4: 'Comfortable to finish',
  6: 'A bit harder, but you finish clean',
  8: 'Hard — costs real effort to finish',
  10: 'Maximum — no rep left, needs real recovery',
}

export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const GOALS = ['hypertrophy', 'strength', 'general', 'endurance', 'power', 'beginner']
export const BLOCK_TYPES = ['strength', 'superset', 'circuit', 'cardio', 'interval', 'hiit', 'mobility']
// Types this version can build, validate and train today. Since Constructor V2.1 every type
// is trainable: the timed ones run in the guided executor (lib/guided.js).
export const BLOCK_TYPES_READY = ['strength', 'superset', 'cardio', 'circuit', 'interval', 'hiit', 'mobility']
// Timed ("guided") block types: their timing lives on the block (lib/protocol/blocks.js timing).
export const GUIDED_TYPES = ['circuit', 'interval', 'hiit', 'mobility']
// A timed work bout inside an interval/HIIT block (Tabata included) is a round, not a strength
// working set: rounds are bounded here instead of by SETS, and never counted as direct weekly
// sets (2J-HEU-INTERVAL-ROUNDS). Circuits and mobility keep the normal set rules.
export const ROUNDS = { allow: [1, 10] }
export const ROUND_TYPES = ['interval', 'hiit']

// Exercise classes the rep zones are keyed on (lib/protocol/classify.js decides them):
//   compound_free    heavy/technical free-weight multi-joint (barbell squat, bench, deadlift)
//   compound_stable  guided multi-joint (machines, smith, leg press, pulldown, cable row)
//   secondary        lighter multi-joint (dumbbell presses, lunges, pull-ups, dips)
//   isolation        single-joint (curls, extensions, raises, flys, leg curl, calf raise)
// 'metabolic' is a role an entry can take (a deliberate high-rep finisher), not a class.
export const CLASSES = ['compound_free', 'compound_stable', 'secondary', 'isolation']

// Rep zones: [min, max] preferred and allowed, per goal and class (or role for strength/power).
// Preferred = where 2J programs by default. Allowed = still fine, shown as a reasoned choice.
// Outside allowed = FAIL for that goal (it is a different goal, not "wrong").
export const REPS = {
  hypertrophy: {
    compound_free: { pref: [5, 10], allow: [4, 15] },
    compound_stable: { pref: [6, 12], allow: [5, 20] },
    secondary: { pref: [8, 15], allow: [6, 20] },
    isolation: { pref: [10, 20], allow: [8, 30] },
    metabolic: { pref: [15, 25], allow: [12, 30] },
  },
  strength: {
    main: { pref: [2, 6], allow: [1, 8] },
    secondary: { pref: [4, 8], allow: [3, 10] },
    accessory: { pref: [6, 12], allow: [5, 15] },
  },
  general: {
    compound_free: { pref: [6, 12], allow: [5, 15] },
    compound_stable: { pref: [8, 15], allow: [6, 15] },
    secondary: { pref: [8, 15], allow: [6, 20] },
    isolation: { pref: [10, 20], allow: [8, 25] },
    metabolic: { pref: [12, 20], allow: [10, 25] },
  },
  endurance: {
    compound_free: { pref: [10, 20], allow: [8, 25] },
    compound_stable: { pref: [12, 25], allow: [10, 30] },
    secondary: { pref: [12, 25], allow: [10, 30] },
    isolation: { pref: [12, 25], allow: [10, 30] },
    metabolic: { pref: [15, 25], allow: [12, 30] },
  },
  power: {
    main: { pref: [2, 6], allow: [1, 6] },
    accessory: { pref: [5, 10], allow: [3, 12] },
  },
  beginner: {
    compound_free: { pref: [8, 12], allow: [6, 15] },
    compound_stable: { pref: [8, 15], allow: [6, 20] },
    secondary: { pref: [8, 15], allow: [6, 20] },
    isolation: { pref: [10, 15], allow: [8, 20] },
    metabolic: { pref: [12, 20], allow: [10, 25] },
  },
}

// Working sets per exercise.
export const SETS = {
  hypertrophy: { pref: [2, 4], allow: [1, 6] },
  strength: { pref: [2, 5], allow: [1, 8] },
  general: { pref: [2, 4], allow: [1, 5] },
  endurance: { pref: [2, 4], allow: [1, 5] },
  power: { pref: [2, 5], allow: [2, 6] },
  beginner: { pref: [1, 3], allow: [1, 4] },
}

// Rest after a set (or after a superset pair), seconds, by demand.
export const REST = {
  heavy: { pref: [120, 300], allow: [90, 420] },          // strength main lifts
  compound: { pref: [120, 180], allow: [60, 300] },        // hypertrophy compounds
  machine: { pref: [90, 150], allow: [45, 240] },          // machines / secondary
  isolation: { pref: [60, 120], allow: [30, 180] },
  power: { pref: [120, 240], allow: [90, 360] },
  circuit: { pref: [30, 90], allow: [15, 150] },           // endurance / circuits
}

// Weekly direct sets per trained muscle group, hypertrophy programs. Practical envelopes
// (2J-HEU-VOL-ENVELOPE), not physiological limits; only DIRECT sets are counted — this
// version has no indirect-volume model and does not pretend to.
export const WEEKLY_SETS = {
  beginner: [6, 10],
  intermediate: [8, 14],
  advanced: [10, 18],
}

// Product preference for a standard muscle block (2J-HEU-BLOCK-SIZE) — not physiology.
export const BLOCK_SIZE = { pref: [4, 7], allow: [1, 9] }
export const SESSION_EXERCISES = { allow: [1, 14] }

// Restrictions a trainer/member can declare explicitly. The validator only enforces what is
// declared; it never infers one from a condition, never diagnoses (2J-HEU-RESTRICTIONS).
export const RESTRICTIONS = ['no-jumps', 'no-deep-knee-flexion', 'no-overhead', 'no-spinal-loading', 'no-floor']
export const RESTRICTION_LABEL = {
  'no-jumps': 'No jumps', 'no-deep-knee-flexion': 'No deep knee flexion', 'no-overhead': 'No overhead work',
  'no-spinal-loading': 'No spinal loading', 'no-floor': 'No floor exercises',
}
export const RESTRICTION_FLAG = {
  'no-jumps': 'jump', 'no-deep-knee-flexion': 'deepKnee', 'no-overhead': 'overhead',
  'no-spinal-loading': 'spinalLoad', 'no-floor': 'floor',
}

// Evidence records (full text lives in docs/EVIDENCE.md under the same id).
export const EVIDENCE = [
  { id: '2J-EVD-GEN-001', topic: 'Resistance training works across loads and methods; effort and consistency matter most', confidence: 'high', reviewed: '2026-09' },
  { id: '2J-EVD-HYP-LOAD-001', topic: 'Load and repetition range for hypertrophy', confidence: 'high', reviewed: '2026-09' },
  { id: '2J-EVD-STR-LOAD-001', topic: 'Heavier loads for maximal strength', confidence: 'high', reviewed: '2026-09' },
  { id: '2J-EVD-VOL-001', topic: 'Weekly set volume and hypertrophy', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-FREQ-001', topic: 'Training frequency', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-EFF-001', topic: 'Proximity to failure', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-RPE-001', topic: 'Effort rating scales', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-REST-001', topic: 'Inter-set rest', confidence: 'low', reviewed: '2026-09' },
  { id: '2J-EVD-ORD-001', topic: 'Exercise order', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-ROM-001', topic: 'Range of motion', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-SS-001', topic: 'Supersets', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-POW-001', topic: 'Power training', confidence: 'moderate', reviewed: '2026-09' },
  { id: '2J-EVD-OLD-001', topic: 'Older adults', confidence: 'high', reviewed: '2026-09' },
  { id: '2J-EVD-END-001', topic: 'Local muscular endurance', confidence: 'low', reviewed: '2026-09' },
]

// Rules. `evidence` lists the records behind a rule; a heuristic may cite what informs it.
export const RULES = [
  { id: '2J-RULE-REPS-HYP', kind: 'heuristic', evidence: ['2J-EVD-HYP-LOAD-001', '2J-EVD-EFF-001'],
    text: 'Hypertrophy is not limited to 8-12 reps. 2J programs preferred zones by exercise class inside wider allowed ranges.' },
  { id: '2J-RULE-REPS-STR', kind: 'evidence', evidence: ['2J-EVD-STR-LOAD-001', '2J-EVD-ORD-001'],
    text: 'Maximal strength: main lift 2-6 reps with heavy loads, secondary 4-8, accessories 6-12; the main lift goes early.' },
  { id: '2J-RULE-REPS-GEN', kind: 'heuristic', evidence: ['2J-EVD-GEN-001', '2J-EVD-FREQ-001'],
    text: 'General strength/health: mostly 6-15 reps, isolation 10-20, effort 6-8, 2-3 sessions a week; never uselessly light.' },
  { id: '2J-RULE-REPS-END', kind: 'heuristic', evidence: ['2J-EVD-END-001'],
    text: 'Muscular endurance: 12-25 reps, 2-4 sets, short rests, technically sustainable exercises.' },
  { id: '2J-RULE-POWER', kind: 'evidence', evidence: ['2J-EVD-POW-001'],
    text: 'Power: moderate loads, 2-6 fast reps, low-to-moderate volume, full rest; never RPE 10 — stop before the reps slow down.' },
  { id: '2J-RULE-RPE-SCALE', kind: 'heuristic', evidence: ['2J-EVD-RPE-001'],
    text: 'Prescribed effort uses the 2J scale 4/6/8/10. It is not converted to RIR for display.' },
  { id: '2J-RULE-RPE10', kind: 'evidence', evidence: ['2J-EVD-EFF-001'],
    text: 'RPE 10 is selective: never every set, never on power work, prudent on heavy technical free-weight lifts.' },
  { id: '2J-RULE-BEGINNER', kind: 'heuristic', evidence: ['2J-EVD-GEN-001', '2J-EVD-EFF-001'],
    text: 'Beginners and returners: tolerance, technique, regularity, then progression; fewer exercises and sets, effort mostly 4-6 with some 8, no RPE 10 on technical lifts.' },
  { id: '2J-RULE-VOLUME', kind: 'heuristic', evidence: ['2J-EVD-VOL-001'],
    text: 'Weekly direct sets per trained muscle are judged across the whole program, against practical envelopes by level, with room for justified exceptions.' },
  { id: '2J-RULE-REST', kind: 'heuristic', evidence: ['2J-EVD-REST-001'],
    text: 'Rest follows the demand of the exercise; no single rest for everything.' },
  { id: '2J-RULE-ORDER', kind: 'evidence', evidence: ['2J-EVD-ORD-001'],
    text: 'What matters most goes while the person is fresh: the strength lift early; technical movements normally before isolation.' },
  { id: '2J-RULE-ROM', kind: 'evidence', evidence: ['2J-EVD-ROM-001'],
    text: 'Full range of motion the person controls is the default; partials need a reason.' },
  { id: '2J-RULE-SUPERSET', kind: 'evidence', evidence: ['2J-EVD-SS-001'],
    text: 'Supersets are efficient; prefer agonist-antagonist or non-competing pairs, use care pairing two heavy compounds for the same muscle.' },
  { id: '2J-RULE-REDUNDANCY', kind: 'heuristic', evidence: [],
    text: 'A block avoids near-duplicate exercises: same pattern, class, implement and laterality are one stimulus under different names.' },
  { id: '2J-RULE-RESTRICTIONS', kind: 'heuristic', evidence: [],
    text: 'Explicit restrictions from the trainer or member win over everything else. 2J never infers them and never diagnoses.' },
  { id: '2J-RULE-BLOCK-SIZE', kind: 'heuristic', evidence: [],
    text: 'Standard muscle blocks hold 4-7 exercises as a product preference; strength, power and core blocks may hold fewer. Never pad.' },
  { id: '2J-RULE-DURATION', kind: 'heuristic', evidence: [],
    text: 'Durations are rounded estimates from sets, reps, rest and transitions, shown as ~N min.' },
  { id: '2J-RULE-OLDER', kind: 'evidence', evidence: ['2J-EVD-OLD-001'],
    text: 'Older adults train for strength, muscle, function and, when appropriate, power; not "light weight and many reps" by default.' },
  { id: '2J-RULE-FATLOSS', kind: 'heuristic', evidence: ['2J-EVD-GEN-001'],
    text: 'Fat-loss goals keep strength training for strength and muscle; circuits or cardio may complement it, never replace it, and no specific fat loss is promised.' },
  { id: '2J-RULE-PROGRESSION', kind: 'heuristic', evidence: [],
    text: 'Blocks prescribe; Progressive Overload V1 recommends from real performance. Double progression inside a rep range, using the gym\'s real load steps.' },
  { id: '2J-HEU-INTERVAL-ROUNDS', kind: 'heuristic', evidence: [],
    text: 'In interval and HIIT blocks (Tabata included) a timed work bout is a round, not a strength set: 1-10 rounds, and those rounds never count as direct weekly sets. Mobility work never counts as volume either.' },
  { id: '2J-RULE-AUTHORITY', kind: 'heuristic', evidence: [],
    text: 'Authority: 1 explicit restrictions, 2 safety/permissions, 3 the 2J protocol, 4 the existing program, 5 the official library, 6 generative AI.' },
]

export const RULE_BY_ID = Object.fromEntries(RULES.map(r => [r.id, r]))

// Validator messages. English templates rendered through t() in the app (Spanish in es.js)
// and sent verbatim to a model on a repair round. {0}, {1}… are params.
export const MESSAGES = {
  unknown_exercise: 'Exercise {0} is not in the library.',
  exercise_unavailable: '{0} needs equipment the gym does not have right now.',
  restriction: '{0} conflicts with the declared restriction "{1}".',
  restriction_unverified: '{0} is not in the curated catalogue: whether it respects "{1}" cannot be verified — check it yourself.',
  reps_outside_allowed: '{0}: {1} reps is outside what {2} allows for this exercise type ({3}).',
  reps_outside_preferred: '{0}: {1} reps is outside the preferred {3} for {2} — fine with a reason.',
  sets_outside_allowed: '{0}: {1} sets is outside the allowed {2}.',
  rounds_outside_allowed: '{0}: {1} rounds is outside the allowed {2} for an interval block.',
  rpe_not_2j: '{0}: effort {1} is not on the 2J scale (4, 6, 8, 10).',
  rpe10_power: '{0}: power work never goes to RPE 10.',
  rpe10_all: 'Every working set is at RPE 10 — 2J uses 10 selectively.',
  rpe10_share: '{0} of {1} working sets are at RPE 10 — more than 2J uses by default.',
  rpe10_technical: '{0}: RPE 10 on a heavy technical free-weight lift needs a reason.',
  rpe10_beginner: '{0}: RPE 10 on a technical lift is not used for beginners.',
  rpe_too_easy: 'Most working sets are at RPE 4 — too easy to drive this goal.',
  rest_outside_allowed: '{0}: {1} s of rest is outside the allowed {2} s for this demand.',
  rest_outside_preferred: '{0}: {1} s of rest differs from the usual {2} s — fine with a reason.',
  block_too_big: 'This block has {0} exercises; 2J keeps blocks to {1}.',
  block_small: 'This block has {0} exercise(s) — fine for strength, power or core, short for a muscle block.',
  session_too_big: 'This day has {0} exercises — more than 2J programs in one session.',
  duplicate_exercise: '{0} appears more than once.',
  redundant_pair: '{0} and {1} are almost the same stimulus.',
  high_overlap: '{0} and {1} are the same movement on the same equipment — keep both only if the difference is intended.',
  redundant_many: '{0} exercises repeat the same pattern ({1}).',
  superset_heavy_same: 'Superset {0} + {1} pairs two heavy compounds for the same muscle.',
  superset_self: 'A superset pairs {0} with itself.',
  order_strength: '{0}: the main strength lift should come early in the session.',
  order_isolation_first: '{0} comes before the compound for the same muscle — fine if it is intentional.',
  volume_high: '{0}: {1} direct sets a week is above the {2} envelope for this level.',
  volume_absurd: '{0}: {1} direct sets a week is far beyond anything 2J programs.',
  volume_low: '{0}: {1} direct sets a week is below the {2} envelope for this level.',
  power_reps: '{0}: power work is 1-6 fast reps.',
  protocol_newer: 'This was built with protocol {0}; this app runs {1}.',
  type_not_ready: 'Blocks of type {0} can be stored but not trained guided yet.',
  empty: 'There are no exercises.',
}

// Default wording for a PASS_WITH_REASON that nobody typed a reason for. Shown, never hidden.
export const DEFAULT_REASON = {
  reps_outside_preferred: 'Rep range chosen on purpose for this exercise.',
  rest_outside_preferred: 'Rest adjusted to this exercise and context.',
  rpe10_share: 'More final sets to the limit on purpose.',
  rpe10_technical: 'Last set to the limit on a lift the person handles well.',
  block_small: 'Short block on purpose.',
  redundant_pair: 'Variation kept on purpose.',
  duplicate_exercise: 'Repeated on purpose.',
  superset_heavy_same: 'Heavy pair on purpose.',
  order_isolation_first: 'Isolation placed first on purpose (pre-fatigue or priority).',
  volume_high: 'Specialisation phase for this muscle.',
  rest_short: 'Short rest for density.',
  exercise_unavailable: 'Equipment expected back before this is trained.',
}

// Which rules/evidence each message draws on, for "why?" in the UI and for traceability.
export const MESSAGE_RULE = {
  reps_outside_allowed: '2J-RULE-REPS-HYP', reps_outside_preferred: '2J-RULE-REPS-HYP',
  sets_outside_allowed: '2J-RULE-VOLUME', rounds_outside_allowed: '2J-HEU-INTERVAL-ROUNDS', rpe_not_2j: '2J-RULE-RPE-SCALE', rpe10_power: '2J-RULE-POWER',
  rpe10_all: '2J-RULE-RPE10', rpe10_share: '2J-RULE-RPE10', rpe10_technical: '2J-RULE-RPE10',
  rpe10_beginner: '2J-RULE-BEGINNER', rpe_too_easy: '2J-RULE-REPS-GEN', rest_outside_allowed: '2J-RULE-REST',
  rest_outside_preferred: '2J-RULE-REST', block_too_big: '2J-RULE-BLOCK-SIZE', block_small: '2J-RULE-BLOCK-SIZE',
  session_too_big: '2J-RULE-BLOCK-SIZE', duplicate_exercise: '2J-RULE-REDUNDANCY', redundant_pair: '2J-RULE-REDUNDANCY', high_overlap: '2J-RULE-REDUNDANCY',
  redundant_many: '2J-RULE-REDUNDANCY', superset_heavy_same: '2J-RULE-SUPERSET', superset_self: '2J-RULE-SUPERSET',
  order_strength: '2J-RULE-ORDER', order_isolation_first: '2J-RULE-ORDER', volume_high: '2J-RULE-VOLUME',
  volume_absurd: '2J-RULE-VOLUME', volume_low: '2J-RULE-VOLUME', power_reps: '2J-RULE-POWER',
  restriction: '2J-RULE-RESTRICTIONS', restriction_unverified: '2J-RULE-RESTRICTIONS', exercise_unavailable: '2J-RULE-RESTRICTIONS',
}

export function format(template, params = []) {
  return String(template).replace(/\{(\d+)\}/g, (_, i) => params[+i] ?? '')
}

// A compact, model-ready view of the rules relevant to one request — never the whole docs.
export function compactProtocol(goal, level) {
  const g = GOALS.includes(goal) ? goal : 'general'
  const lv = LEVELS.includes(level) ? level : 'intermediate'
  return {
    name: PROTOCOL_NAME, version: PROTOCOL_VERSION, goal: g, level: lv,
    rpeScale: { values: RPE_2J, meaning: RPE_LABEL, rule: 'Use only 4/6/8/10. 10 is selective: never every set, never for power, prudent on heavy technical free-weight lifts, not for beginners on technical lifts.' },
    reps: REPS[g], setsPerExercise: SETS[g], rest: REST,
    weeklyDirectSetsPerMuscle: g === 'hypertrophy' ? WEEKLY_SETS[lv] : null,
    blockSize: BLOCK_SIZE.pref,
    // Guided blocks (circuit/interval/HIIT/mobility) are chosen from officialBlocks, timing included.
    guidedTypes: GUIDED_TYPES, intervalRounds: ROUNDS.allow,
    rules: RULES.filter(r => relevant(r.id, g)).map(r => ({ id: r.id, kind: r.kind, text: r.text })),
  }
}
function relevant(id, g) {
  if (id === '2J-RULE-REPS-HYP') return g === 'hypertrophy'
  if (id === '2J-RULE-REPS-STR') return g === 'strength'
  if (id === '2J-RULE-REPS-GEN') return g === 'general'
  if (id === '2J-RULE-REPS-END') return g === 'endurance'
  if (id === '2J-RULE-POWER') return g === 'power'
  if (id === '2J-RULE-BEGINNER') return g === 'beginner'
  if (id === '2J-RULE-VOLUME') return g === 'hypertrophy'
  return true
}
