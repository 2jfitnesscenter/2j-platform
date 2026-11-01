// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise → protocol taxonomy. Curated entries (catalog.js) are exact; everything else gets a
// transparent name/equipment heuristic, marked `curated: false` so callers know how far to
// trust it. No hidden model, no "biomechanics AI" — every decision here is a readable rule.
import { CATALOG } from './catalog.js'

const TG_GROUP = {
  glutes: 'glutes', quads: 'quads', hamstrings: 'hamstrings', calves: 'calves', pectorals: 'chest',
  lats: 'back', 'upper back': 'back', traps: 'back', delts: 'shoulders', biceps: 'biceps', triceps: 'triceps',
  abs: 'abs', 'serratus anterior': 'abs', spine: 'hamstrings', forearms: 'forearms', adductors: 'adductors',
  abductors: 'glutes', 'levator scapulae': 'back', 'cardiovascular system': 'cardio',
}
const TG_FALLBACK = { forearms: 'wrist', calves: 'calf', biceps: 'curl', triceps: 'tri-ext', abs: 'core-flex' }
const FREE_HEAVY = new Set(['barbell', 'olympic barbell', 'trap bar', 'ez barbell'])
const GUIDED = new Set(['leverage machine', 'smith machine', 'sled machine', 'cable', 'assisted'])
const CARDIO_ERGOMETERS = new Set(['skierg machine', 'upper body ergometer'])

// Order matters: first match wins.
const PATTERNS = [
  // Exercise Library V2: stretches are mobility (never direct volume), wrist/forearm work is not
  // a biceps curl, and Olympic lifts are their own job — each rule stays a readable name test.
  [/\bstretch|mobility|foam roll/, 'mobility', 'isolation'],
  [/\bclean\b(?![- ]grip)|snatch|thruster|\bjerk\b/, 'olympic', 'secondary', ['spinalLoad']],
  [/wrist|finger|forearm|pronation|supination/, 'wrist', 'isolation'],
  [/shoulder (internal|external) rotation|shoulder external|cuban press/, 'rotator', 'isolation'],
  [/side bend|side bent|lateral flexion/, 'lat-flex', 'isolation'],
  [/side bridge|side plank/, 'anti-lat', 'isolation'],
  [/mountain climber/, 'cond-climber', 'secondary'],
  [/jump|plyo|burpee|box jump/, 'jump', 'secondary', ['jump']],
  [/calf/, 'calf', 'isolation'],
  [/leg extension|sissy/, 'knee-ext', 'isolation'],
  [/leg curl|nordic|glute-ham/, 'knee-flex', 'isolation'],
  [/hip thrust|glute bridge|(?<!london )bridge/, 'bridge', 'secondary'],
  [/abduct/, 'abduction', 'isolation'],
  [/adduct/, 'adduction', 'isolation'],
  [/kickback|hip extension|reverse hyper/, 'hip-ext', 'isolation'],
  [/deadlift|good morning|pull through|swing|rack pull/, 'hinge', 'secondary', ['spinalLoad']],
  [/hyperextension|back extension/, 'back-ext', 'secondary'],
  [/leg press|sled .*press/, 'leg-press', 'compound_stable', ['deepKnee']],
  [/squat/, 'squat', 'secondary', ['deepKnee']],
  [/lunge|split squat/, 'lunge', 'secondary', ['deepKnee', 'uni']],
  [/step-up|step up/, 'step-up', 'secondary', ['uni']],
  [/pullover/, 'pullover', 'isolation'],
  [/pulldown|pull-up|pull up|chin-up|chin up/, 'v-pull', 'secondary'],
  [/row/, 'h-row', 'secondary'],
  [/shrug/, 'shrug', 'isolation'],
  [/lateral raise|side raise/, 'lat-raise', 'isolation'],
  [/rear delt|reverse fly|face pull/, 'rear-delt', 'isolation'],
  [/front raise|forward raise|front shoulder raise/, 'front-raise', 'isolation'],
  [/fly|crossover|cross-over|pec deck/, 'fly', 'isolation'],
  [/curl/, 'curl', 'isolation'],
  [/pushdown|triceps extension|tricep extension|skull|french press|kickback/, 'tri-ext', 'isolation'],
  [/\bdips?\b/, 'dip', 'secondary'],
  [/overhead press|shoulder press|military press|arnold|push press/, 'v-press', 'secondary', ['overhead']],
  [/bench press|chest press|push-up|push ?up|floor press|incline press/, 'h-press', 'secondary'],
  [/plank|dead bug|rollout|rollerout/, 'anti-ext', 'isolation', ['floor']],
  [/crunch|sit-up|sit up|leg raise|knee raise|v-up|v-sit|toe touch|heel touch|jackknife|scissor|flutter|air bike|bicycle|tuck/, 'core-flex', 'isolation'],
  [/twist|wood ?chop|pallof/, 'anti-rot', 'isolation'],
  [/carry|farmer/, 'carry', 'secondary'],
]

/**
 * @param {string} id
 * @param {(id:string)=>({n:string,bp:string,tg:string,eq:string}|null)} lookup
 */
export function classify(id, lookup) {
  const ex = lookup ? lookup(id) : null
  const cur = CATALOG[id]
  if (cur) return { ...cur, id, eq: ex?.eq || null, cardio: false, curated: true, known: true }
  if (!ex) return { id, known: false, curated: false, pattern: 'unknown', cls: 'isolation', group: null, secondary: [], flags: [], variant: '', uni: false, eq: null, cardio: false }
  const name = String(ex.n || '').toLowerCase()
  // Ergometers (ski, arm bike) are filed under shoulders/arms but are cardio machines.
  if (ex.bp === 'cardio' || CARDIO_ERGOMETERS.has(ex.eq)) return { id, known: true, curated: false, pattern: 'cardio', cls: 'isolation', group: 'cardio', secondary: [], flags: [], variant: '', uni: false, eq: ex.eq, cardio: true }
  let pattern = 'other', cls = 'isolation', flags = []
  for (const [re, p, c, f] of PATTERNS) if (re.test(name)) { pattern = p; cls = c; flags = f ? [...f] : []; break }
  // A plain "press" is a chest press or an overhead press depending on its target muscle.
  if (pattern === 'other' && /press/.test(name)) {
    if (ex.tg === 'pectorals' || ex.tg === 'triceps') { pattern = 'h-press'; cls = 'secondary' }
    else if (ex.tg === 'delts') { pattern = 'v-press'; cls = 'secondary'; flags = ['overhead'] }
  }
  // Last resort, only for targets that have a single obvious job; everything else stays 'other'.
  if (pattern === 'other') pattern = TG_FALLBACK[ex.tg] || 'other'
  // Implement refines the class of a multi-joint pattern: barbell = technical free weight,
  // machine/cable/smith = guided. Single-joint stays isolation whatever the implement.
  if (cls !== 'isolation') {
    if (FREE_HEAVY.has(ex.eq)) cls = 'compound_free'
    else if (GUIDED.has(ex.eq)) cls = 'compound_stable'
  }
  if (/one arm|one leg|single|alternate|unilateral/.test(name) && !flags.includes('uni')) flags.push('uni')
  if (/lying|floor|supine|prone/.test(name) && !/bench/.test(name) && !flags.includes('floor')) flags.push('floor')
  if (/overhead|behind head/.test(name) && !flags.includes('overhead')) flags.push('overhead')
  if (pattern === 'squat' && FREE_HEAVY.has(ex.eq) && !flags.includes('spinalLoad')) flags.push('spinalLoad')
  return {
    id, known: true, curated: false, pattern, cls, group: pattern === 'mobility' ? null : TG_GROUP[ex.tg] || null, secondary: [],
    flags, variant: '', uni: flags.includes('uni'), eq: ex.eq, cardio: false,
  }
}

// "Same stimulus under a different name": pattern + variant + laterality. Class and implement
// are deliberately NOT part of it — a barbell and a cable curl done the same way are the same
// curl; a flat and an incline press are not.
export const redundancyKey = c => `${c.pattern}|${c.variant || 'std'}|${c.uni ? 'u' : 'b'}`
