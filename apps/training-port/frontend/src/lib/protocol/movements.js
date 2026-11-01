// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library V2 — the canonical movement and equipment layers, shared by the app and the
// API (scripts/sync-protocol.mjs). An exercise keeps its dataset id as its identity forever;
// these are metadata derived on top of it:
//
//   movement   what the body does (squat, hip thrust, row…). Derived from the protocol pattern
//              (curated in catalog.js, or classify.js's readable name rules) — never guessed by
//              a model. One movement groups many patterns only where they are the same job for
//              the member (a leg press sits with squats; a back extension with hinges).
//   equipment  one normalised id per implement. The dataset's `eq` strings map 1:1 or many:1
//              (olympic barbell → barbell); a few exercises get a more precise id only where
//              there is evidence (an image, a name), never by assumption.
//
// Labels are English source strings rendered through t() (Spanish in locales/es.js).

// The movement list is derived from the patterns the 2J library really uses (catalog.js) plus
// the heuristic ones classify.js produces for the rest of the dataset — not a textbook list.
export const MOVEMENTS = [
  // lower body
  { id: 'squat', label: 'Squat & leg press', region: 'lower', patterns: ['squat', 'leg-press'] },
  { id: 'lunge', label: 'Lunge & step-up', region: 'lower', patterns: ['lunge', 'step-up'] },
  { id: 'hinge', label: 'Hip hinge', region: 'lower', patterns: ['hinge', 'back-ext'] },
  { id: 'hip_thrust', label: 'Hip thrust & bridge', region: 'lower', patterns: ['bridge'] },
  { id: 'hip_extension', label: 'Hip extension', region: 'lower', patterns: ['hip-ext'] },
  { id: 'hip_abduction', label: 'Hip abduction', region: 'lower', patterns: ['abduction'] },
  { id: 'hip_adduction', label: 'Hip adduction', region: 'lower', patterns: ['adduction'] },
  { id: 'knee_extension', label: 'Leg extension', region: 'lower', patterns: ['knee-ext'] },
  { id: 'knee_flexion', label: 'Leg curl', region: 'lower', patterns: ['knee-flex'] },
  { id: 'calf_raise', label: 'Calf raise', region: 'lower', patterns: ['calf'] },
  // upper body — push
  { id: 'horizontal_push', label: 'Horizontal press', region: 'upper', patterns: ['h-press'] },
  { id: 'chest_fly', label: 'Chest fly', region: 'upper', patterns: ['fly'] },
  { id: 'dip', label: 'Dip', region: 'upper', patterns: ['dip'] },
  { id: 'vertical_push', label: 'Overhead press', region: 'upper', patterns: ['v-press'] },
  { id: 'lateral_raise', label: 'Lateral raise', region: 'upper', patterns: ['lat-raise'] },
  { id: 'front_raise', label: 'Front raise', region: 'upper', patterns: ['front-raise'] },
  { id: 'elbow_extension', label: 'Triceps extension', region: 'upper', patterns: ['tri-ext'] },
  // upper body — pull
  { id: 'horizontal_pull', label: 'Row', region: 'upper', patterns: ['h-row'] },
  { id: 'vertical_pull', label: 'Pulldown & pull-up', region: 'upper', patterns: ['v-pull'] },
  { id: 'pullover', label: 'Pullover', region: 'upper', patterns: ['pullover'] },
  { id: 'rear_delt', label: 'Rear delt', region: 'upper', patterns: ['rear-delt'] },
  { id: 'shrug', label: 'Shrug', region: 'upper', patterns: ['shrug'] },
  { id: 'elbow_flexion', label: 'Biceps curl', region: 'upper', patterns: ['curl'] },
  { id: 'wrist', label: 'Wrist & forearm', region: 'upper', patterns: ['wrist'] },
  { id: 'shoulder_rotation', label: 'Shoulder rotation', region: 'upper', patterns: ['rotator'] },
  // trunk
  { id: 'core_anti_extension', label: 'Plank & anti-extension', region: 'core', patterns: ['anti-ext'] },
  { id: 'core_flexion', label: 'Crunch & leg raise', region: 'core', patterns: ['core-flex'] },
  { id: 'core_rotation', label: 'Rotation & anti-rotation', region: 'core', patterns: ['anti-rot'] },
  { id: 'core_lateral', label: 'Side bend & anti-lateral', region: 'core', patterns: ['anti-lat', 'lat-flex'] },
  // whole body / conditioning / mobility
  { id: 'carry', label: 'Carry', region: 'full', patterns: ['carry'] },
  { id: 'jump', label: 'Jump & plyometrics', region: 'full', patterns: ['jump'] },
  { id: 'olympic', label: 'Clean, snatch & thruster', region: 'full', patterns: ['olympic'] },
  { id: 'conditioning', label: 'Conditioning', region: 'full', patterns: ['cond-burpee', 'cond-jack', 'cond-crawl', 'cond-skater', 'cond-knee', 'cond-step', 'cond-run', 'cond-climber'] },
  { id: 'cardio', label: 'Cardio machine', region: 'full', patterns: ['cardio'] },
  { id: 'mobility', label: 'Mobility & stretching', region: 'full', patterns: ['mobility', 'mob-chest', 'mob-lat', 'mob-spine', 'mob-tspine', 'mob-ankle', 'mob-calf', 'mob-glute', 'mob-ham', 'mob-hip', 'mob-quad', 'mob-knee', 'mob-shoulder', 'mob-wrist', 'mob-adductor', 'mob-triceps', 'mob-neck'] },
]
export const MOVEMENT_BY_ID = Object.fromEntries(MOVEMENTS.map(m => [m.id, m]))
const BY_PATTERN = {}
for (const m of MOVEMENTS) for (const p of m.patterns) BY_PATTERN[p] = m.id
/** The canonical movement of a protocol pattern, or null ('other', 'unknown'). */
export const movementOfPattern = p => BY_PATTERN[p] || null

// Normalised equipment. `kind` groups them for filters and for a future gym profile
// ("which kinds does this gym have"). `from` lists the dataset strings that map here.
export const EQUIPMENT = [
  { id: 'bodyweight', label: 'Body weight', kind: 'bodyweight', from: ['body weight'] },
  { id: 'barbell', label: 'Barbell', kind: 'free', from: ['barbell', 'olympic barbell'] },
  { id: 'ez_bar', label: 'EZ bar', kind: 'free', from: ['ez barbell'] },
  { id: 'trap_bar', label: 'Trap bar', kind: 'free', from: ['trap bar'] },
  { id: 'dumbbell', label: 'Dumbbells', kind: 'free', from: ['dumbbell'] },
  { id: 'kettlebell', label: 'Kettlebell', kind: 'free', from: ['kettlebell'] },
  { id: 'weighted', label: 'Added weight', kind: 'free', from: ['weighted'] },
  { id: 'cable', label: 'Cable', kind: 'cable', from: ['cable'] },
  { id: 'machine', label: 'Machine', kind: 'machine', from: ['leverage machine'] },
  { id: 'selectorized', label: 'Machine (weight stack)', kind: 'machine', from: [] },
  { id: 'plate_loaded', label: 'Machine (plate-loaded)', kind: 'machine', from: [] },
  { id: 'smith', label: 'Smith machine', kind: 'machine', from: ['smith machine'] },
  { id: 'sled', label: 'Sled machine', kind: 'machine', from: ['sled machine'] },
  { id: 'assisted', label: 'Assisted', kind: 'machine', from: ['assisted'] },
  { id: 'band', label: 'Band', kind: 'accessory', from: ['band', 'resistance band'] },
  { id: 'stability_ball', label: 'Stability ball', kind: 'accessory', from: ['stability ball'] },
  { id: 'medicine_ball', label: 'Medicine ball', kind: 'accessory', from: ['medicine ball'] },
  { id: 'bosu', label: 'BOSU', kind: 'accessory', from: ['bosu ball'] },
  { id: 'rope', label: 'Rope', kind: 'accessory', from: ['rope'] },
  { id: 'roller', label: 'Roller', kind: 'accessory', from: ['roller', 'wheel roller'] },
  { id: 'hammer', label: 'Hammer', kind: 'accessory', from: ['hammer'] },
  { id: 'tire', label: 'Tire', kind: 'accessory', from: ['tire'] },
  { id: 'treadmill', label: 'Treadmill', kind: 'cardio', from: ['treadmill'] },
  { id: 'bike', label: 'Stationary bike', kind: 'cardio', from: ['stationary bike'] },
  { id: 'elliptical', label: 'Elliptical', kind: 'cardio', from: ['elliptical machine'] },
  { id: 'stepmill', label: 'Stepmill', kind: 'cardio', from: ['stepmill machine'] },
  { id: 'ergometer', label: 'Arm ergometer', kind: 'cardio', from: ['upper body ergometer'] },
  { id: 'skierg', label: 'SkiErg', kind: 'cardio', from: ['skierg machine'] },
]
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map(e => [e.id, e]))
export const EQUIPMENT_KINDS = ['free', 'machine', 'cable', 'bodyweight', 'accessory', 'cardio']
const EQ_FROM = {}
for (const e of EQUIPMENT) for (const s of e.from) EQ_FROM[s] = e.id

// More precise equipment only where there is evidence: 0576 is a plate-loaded converging chest
// press and 0577 a weight-stack one (the dataset's images; it names both the same); 0798 and 2331
// are a stationary bike and an elliptical by their own names, filed as "leverage machine".
// The dataset's own `eq` is left as it is (official routines read it); this is the V2 reading.
export const EQUIPMENT_OVERRIDE = { '0576': 'plate_loaded', '0577': 'selectorized', '0798': 'bike', '2331': 'elliptical' }

/** Canonical equipment id for an exercise record (`custom` for member-made ones). */
export function equipmentIdOf(ex) {
  if (!ex) return null
  if (EQUIPMENT_OVERRIDE[ex.id]) return EQUIPMENT_OVERRIDE[ex.id]
  if (ex.eq === 'custom' || ex.custom) return 'custom'
  return EQ_FROM[ex.eq] || null
}
