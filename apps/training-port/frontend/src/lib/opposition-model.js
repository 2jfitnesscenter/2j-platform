// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Entrena tus Oposiciones — the pure model. Shared byte for byte by the phone and the API (scripts/sync-opposition-model.mjs): the phone builds the plan and
 * scores the control tests, the API validates what an administrator saves and summarises a member's plan for the Coach and the AI.
 *
 * Nothing about a particular body, convocatoria or mark lives in the code. A body is an OppositionProfile (data, versioned, with its official source and
 * date); everything below reads that data:
 *
 *   OppositionProfile = { id, slug, name, body, organism, version, status, convocatoria, source:{ kind:'official', organism, document, publication, date, reference },
 *     validFrom, validUntil, scoring:{ model:'points'|'pass-fail', maxPoints, minPoints, referencePoints, rule:{ kind:'all-min'|'average', min? } },
 *     categories:{ bySex, ageBands:[{ id, label, from, to }]|null }, tests:[Test], notes:[], askBeforeStart:[] }
 *   Test = { id, name, capacity, movement, kind:'time'|'reps'|'hold'|'distance', unit, distanceM?, durationS?, attempts?, description, marks:{ [category]:[{ p, v, label? }] } }
 *     marks: points ascending; v is the value that EARNS those points (the slowest time / fewest reps of the band). category = 'm' | 'f' | 'm:u35' | '*' …
 *
 * A member's plan lives in S.opposition = { v:1, plan, history } and pins a SNAPSHOT of the profile it was built on: a new convocatoria is a new version
 * and never changes a running plan by itself. The training itself runs on the Premium engine (S.premium.active is the current 5-week block of the plan:
 * four training weeks and a control week), so sessions, workouts, Coach and sync need nothing new.
 *
 * Nothing here invents a mark. When a figure is missing (no mark, no scale for a category, a test the profile does not have) the result says so.
 */

export const SCHEMA = 1
export const BODIES = ['policia-local', 'policia-nacional', 'guardia-civil', 'bomberos', 'other']
export const STATUSES = ['draft', 'published', 'hidden', 'archived']
export const HORIZONS = [6, 12, 18, 24]
export const PHASES = ['base', 'development', 'specificity', 'competitive']
export const CAPACITIES = ['endurance', 'speed', 'agility', 'pull', 'push', 'power', 'swim']
export const MOVEMENTS = ['run', 'sprint', 'agility', 'pullup', 'hang', 'pushup', 'bench', 'jump', 'swim']
export const KINDS = { time: 'lower', reps: 'higher', hold: 'higher', distance: 'higher' }
export const AMBITIONS = ['pass', 'solid', 'top']
export const RESTRICTIONS = ['knee', 'shoulder', 'back', 'ankle', 'elbow-wrist', 'other']
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const TEST_STATUS = ['above-target', 'on-track', 'stalled', 'at-risk', 'no-data']
export const BLOCK_WEEKS = 5
export const MAX_TESTS = 10

const DAY = 86400000
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n)
const fin = v => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null)
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const clone = x => JSON.parse(JSON.stringify(x))
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v)) ? String(v) : null)
const r1 = x => Math.round(x * 10) / 10

/* ------------------------------------------------------------------------------------------------ profile */
export function validateProfile(p) {
  const issues = []
  const add = (c, at) => issues.push(at ? `${c}:${at}` : c)
  if (!isObj(p)) return ['profile']
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(p.id || '')) add('id')
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(p.slug || '')) add('slug')
  if (!str(p.name, 120)) add('name')
  if (!BODIES.includes(p.body)) add('body')
  if (!str(p.organism, 160)) add('organism')
  if (!int(p.version, 1, 10000)) add('version')
  if (!STATUSES.includes(p.status)) add('status')
  const src = p.source
  if (!isObj(src) || src.kind !== 'official' || !str(src.organism, 200) || !str(src.reference, 300) || !isoDate(src.date)) add('source')
  if (p.validFrom && !isoDate(p.validFrom)) add('valid-from')
  if (p.validUntil && !isoDate(p.validUntil)) add('valid-until')
  if (p.validFrom && p.validUntil && isoDate(p.validFrom) && isoDate(p.validUntil) && p.validUntil < p.validFrom) add('valid-range')
  const sc = p.scoring
  if (!isObj(sc) || !['points', 'pass-fail'].includes(sc.model) || !(sc.minPoints >= 0) || !isObj(sc.rule) || !['all-min', 'average'].includes(sc.rule.kind)) add('scoring')
  else if (sc.rule.kind === 'average' && !(sc.rule.min > 0)) add('scoring-average')
  const cats = p.categories
  if (!isObj(cats)) add('categories')
  const bands = Array.isArray(cats?.ageBands) ? cats.ageBands : []
  for (const b of bands) if (!/^[a-z0-9]{1,8}$/.test(b?.id || '') || !(b.from >= 0) || !(b.to >= b.from)) add('age-band')
  const keys = new Set(['*', ...(cats?.bySex ? ['m', 'f'] : []), ...(cats?.bySex ? bands.flatMap(b => ['m:' + b.id, 'f:' + b.id]) : bands.map(b => b.id))])
  const tests = Array.isArray(p.tests) ? p.tests : []
  if (!tests.length || tests.length > MAX_TESTS) add('tests')
  const ids = new Set()
  for (const t of tests) {
    const at = t?.id || '?'
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(t?.id || '') || ids.has(t.id)) add('test-id', at)
    ids.add(t?.id)
    if (!str(t?.name, 100)) add('test-name', at)
    if (!CAPACITIES.includes(t?.capacity)) add('test-capacity', at)
    if (!MOVEMENTS.includes(t?.movement)) add('test-movement', at)
    if (!KINDS[t?.kind]) add('test-kind', at)
    if (t?.only != null && (!Array.isArray(t.only) || t.only.some(o => !['m', 'f'].includes(o)))) add('test-only', at)
    if (!str(t?.unit, 12)) add('test-unit', at)
    if (!isObj(t?.marks) || !Object.keys(t.marks).length) { add('test-marks', at); continue }
    for (const [k, scale] of Object.entries(t.marks)) {
      if (!keys.has(k)) add('test-category', `${at}:${k}`)
      if (!Array.isArray(scale) || !scale.length || scale.length > 12) { add('test-scale', `${at}:${k}`); continue }
      const dir = KINDS[t.kind]
      scale.forEach((e, i) => {
        if (!(Number.isFinite(e?.p)) || !Number.isFinite(e?.v)) add('test-scale-entry', `${at}:${k}`)
        else if (i > 0 && (e.p <= scale[i - 1].p || (dir === 'lower' ? e.v > scale[i - 1].v : e.v < scale[i - 1].v))) add('test-scale-order', `${at}:${k}`)
      })
    }
  }
  return [...new Set(issues)]
}

/** The editorial fields only; unknown keys, oversized strings and over-long lists are dropped. Validate afterwards. */
export function sanitizeProfile(i) {
  const o = isObj(i) ? i : {}
  const cats = isObj(o.categories) ? o.categories : {}
  const sc = isObj(o.scoring) ? o.scoring : {}
  const src = isObj(o.source) ? o.source : {}
  const conv = isObj(o.convocatoria) ? o.convocatoria : {}
  return {
    id: str(o.id, 48), slug: str(o.slug, 48).toLowerCase(), name: str(o.name, 120), body: str(o.body, 24), organism: str(o.organism, 160),
    convocatoria: { title: str(conv.title, 200), plazas: fin(conv.plazas), year: fin(conv.year), reference: str(conv.reference, 300) },
    source: { kind: str(src.kind, 12), organism: str(src.organism, 200), document: str(src.document, 300), publication: str(src.publication, 200), date: str(src.date, 10), reference: str(src.reference, 300), ...(src.note ? { note: str(src.note, 400) } : {}) },
    validFrom: str(o.validFrom, 10) || null, validUntil: str(o.validUntil, 10) || null,
    scoring: { model: str(sc.model, 12), maxPoints: fin(sc.maxPoints), minPoints: fin(sc.minPoints), referencePoints: fin(sc.referencePoints), rule: isObj(sc.rule) ? { kind: str(sc.rule.kind, 12), ...(sc.rule.min != null ? { min: fin(sc.rule.min) } : {}), ...(sc.rule.note ? { note: str(sc.rule.note, 300) } : {}) } : null },
    categories: { bySex: !!cats.bySex, ageBands: Array.isArray(cats.ageBands) ? cats.ageBands.slice(0, 6).map(b => ({ id: str(b?.id, 8), label: str(b?.label, 24), from: fin(b?.from), to: fin(b?.to) })) : null },
    tests: (Array.isArray(o.tests) ? o.tests : []).slice(0, MAX_TESTS).map(t => ({
      id: str(t?.id, 32), name: str(t?.name, 100), capacity: str(t?.capacity, 12), movement: str(t?.movement, 12), kind: str(t?.kind, 12), unit: str(t?.unit, 12),
      ...(t?.distanceM != null ? { distanceM: fin(t.distanceM) } : {}), ...(t?.durationS != null ? { durationS: fin(t.durationS) } : {}), ...(t?.attempts != null ? { attempts: fin(t.attempts) } : {}),
      ...(Array.isArray(t?.only) && t.only.length ? { only: t.only.filter(o => o === 'm' || o === 'f') } : {}),
      description: str(t?.description, 700), ...(t?.notes ? { notes: str(t.notes, 400) } : {}),
      marks: isObj(t?.marks) ? Object.fromEntries(Object.entries(t.marks).slice(0, 12).map(([k, s]) => [str(k, 12), (Array.isArray(s) ? s : []).slice(0, 12).map(e => ({ p: fin(e?.p), v: fin(e?.v), ...(e?.label ? { label: str(e.label, 24) } : {}) }))])) : {},
    })),
    notes: (Array.isArray(o.notes) ? o.notes : []).slice(0, 8).map(n => str(n, 400)).filter(Boolean),
    askBeforeStart: (Array.isArray(o.askBeforeStart) ? o.askBeforeStart : []).slice(0, 5).map(n => str(n, 40)).filter(Boolean),
  }
}

/** What changed between two versions of a profile, for the administrator and for a member deciding whether to move to the new convocatoria. */
export function diffProfiles(a, b) {
  const out = []
  if ((a?.source?.date || '') !== (b?.source?.date || '') || (a?.source?.reference || '') !== (b?.source?.reference || '')) out.push({ kind: 'source' })
  if ((a?.convocatoria?.reference || '') !== (b?.convocatoria?.reference || '')) out.push({ kind: 'convocatoria' })
  const mine = new Map((a?.tests || []).map(t => [t.id, t]))
  for (const t of b?.tests || []) {
    const old = mine.get(t.id)
    if (!old) { out.push({ kind: 'test-added', test: t.id }); continue }
    if (JSON.stringify(old.marks) !== JSON.stringify(t.marks)) out.push({ kind: 'marks', test: t.id })
    else if (old.kind !== t.kind || old.unit !== t.unit || old.description !== t.description) out.push({ kind: 'test-changed', test: t.id })
    mine.delete(t.id)
  }
  for (const id of mine.keys()) out.push({ kind: 'test-removed', test: id })
  if (JSON.stringify(a?.scoring) !== JSON.stringify(b?.scoring)) out.push({ kind: 'scoring' })
  return out
}

/** Does saving `next` over `prev` need a new version? Any change of tests, marks, scoring, categories or official source does; a rename or a note does not. */
export const needsNewVersion = (prev, next) => !!prev && diffProfiles(prev, next).length > 0

/* ------------------------------------------------------------------------------------------------ scoring */
/** The category a person falls in for this profile, or null when a needed fact (sex or age) is missing. */
export function categoryOf(profile, { sex, age } = {}) {
  const cats = profile?.categories || {}
  const bands = Array.isArray(cats.ageBands) ? cats.ageBands : []
  const sx = cats.bySex ? (sex === 'f' || sex === 'm' ? sex : null) : null
  if (cats.bySex && !sx) return null
  let band = null
  if (bands.length) {
    if (!Number.isFinite(age)) return null
    band = bands.find(b => age >= b.from && age <= b.to)?.id || null
    if (!band) return null
  }
  return [sx, band].filter(Boolean).join(':') || '*'
}
export const needsSex = p => !!p?.categories?.bySex
export const needsAge = p => (p?.categories?.ageBands || []).length > 0
/** The tests that apply to a category (a few official tests differ by sex: pull-ups for men, a hang for women). */
export const testsFor = (profile, cat) => (profile?.tests || []).filter(t => !Array.isArray(t.only) || !t.only.length || t.only.some(o => String(cat).startsWith(o)))
const scaleOf = (test, cat) => test?.marks?.[cat] || test?.marks?.['*'] || null

/** Reference entry of a scale: the one that earns `referencePoints` (the passing line used for levels and projections). */
function refEntry(profile, scale) {
  const rp = profile?.scoring?.referencePoints
  return scale.find(e => e.p === rp) || scale[0]
}

/** Scores one mark against the official scale. Returns null when there is no scale for the category or no valid mark. */
export function scoreMark(profile, test, cat, value) {
  const scale = scaleOf(test, cat)
  const v = fin(value)
  if (!scale || v == null) return null
  const dir = KINDS[test.kind]
  const meets = e => (dir === 'lower' ? v <= e.v : v >= e.v)
  let points = 0
  for (const e of scale) if (meets(e)) points = e.p
  const ref = refEntry(profile, scale), top = scale[scale.length - 1], first = scale[0]
  const span = top.v - ref.v
  const position = span === 0 ? (meets(ref) ? 1 : 0) : (v - ref.v) / span
  return { points, passed: meets(first), meetsReference: meets(ref), position: r1(clamp(position, -2, 1.5) * 100) / 100, minimum: first.v, minPoints: first.p, reference: ref.v, top: top.v, topPoints: top.p }
}

/** The mark a member aims for, by ambition (pass · solid · top). Pass-fail scales get a safety margin over the minimum instead of extra points. */
export function targetOf(profile, test, cat, ambition = 'pass') {
  const scale = scaleOf(test, cat)
  if (!scale) return null
  const dir = KINDS[test.kind]
  const ref = refEntry(profile, scale)
  if (scale.length === 1) {
    const margin = { pass: 0, solid: 0.03, top: 0.06 }[ambition] ?? 0
    const v = dir === 'lower' ? ref.v * (1 - margin) : ref.v * (1 + margin)
    return { value: test.kind === 'time' ? r1(v) : Math.round(v), points: ref.p }
  }
  const wantPoints = { pass: ref.p, solid: Math.min(ref.p + 2, scale[scale.length - 1].p), top: Math.min(ref.p + 4, scale[scale.length - 1].p) }[ambition] ?? ref.p
  const e = [...scale].reverse().find(x => x.p <= wantPoints) || ref
  return { value: e.v, points: e.p }
}

/** Overall pass/fail for a set of marks, following the profile's own rule. `missing` lists tests without a usable mark: nothing is assumed for them. */
export function overall(profile, cat, marks) {
  const per = {}, missing = []
  for (const t of testsFor(profile, cat)) {
    const s = scoreMark(profile, t, cat, marks?.[t.id])
    if (!s) { missing.push(t.id); continue }
    per[t.id] = s
  }
  const sc = profile.scoring
  const list = Object.values(per)
  const noneBelow = list.every(s => s.passed)
  const average = list.length ? list.reduce((a, s) => a + s.points, 0) / list.length : null
  let passed = null
  if (!missing.length) passed = sc.rule.kind === 'average' ? (average >= sc.rule.min && list.every(s => s.points > 0)) : noneBelow
  return { per, missing, average: average == null ? null : r1(average), passed, allTestsMeetMinimum: !missing.length ? noneBelow : null }
}

/* ------------------------------------------------------------------------------------------------ levels */
export const levelOfPosition = pos => (pos == null ? null : pos < 0.25 ? 'beginner' : pos < 0.65 ? 'intermediate' : 'advanced')
const SELF = { beginner: 0.1, intermediate: 0.45, advanced: 0.8 }
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 }

/** Level per capacity from the real marks (not from how the person feels). A capacity without a mark falls back to the self-perception and says so (`estimated`). */
export function levelsOf(profile, cat, marks, self = 'beginner') {
  const by = {}
  for (const c of CAPACITIES) {
    const ts = testsFor(profile, cat).filter(t => t.capacity === c)
    if (!ts.length) continue
    const pos = ts.map(t => scoreMark(profile, t, cat, marks?.[t.id])?.position).filter(x => x != null)
    if (pos.length) { const m = pos.reduce((a, b) => a + b, 0) / pos.length; by[c] = { level: levelOfPosition(m), position: r1(m * 100) / 100, estimated: false } }
    else by[c] = { level: LEVEL_RANK[self] != null ? self : 'beginner', position: SELF[self] ?? 0.1, estimated: true }
  }
  const all = Object.values(by)
  const measured = all.filter(x => !x.estimated)
  const pool = measured.length ? measured : all
  const m = pool.length ? pool.reduce((a, x) => a + x.position, 0) / pool.length : SELF[self] ?? 0.1
  return { global: { level: levelOfPosition(m), position: r1(m * 100) / 100, estimated: !measured.length }, byCapacity: by }
}

/* ------------------------------------------------------------------------------------------------ horizons and phases */
const SPLIT = { 6: [0.2, 0.4, 0.3, 0.1], 12: [0.3, 0.35, 0.25, 0.1], 18: [0.35, 0.35, 0.2, 0.1], 24: [0.4, 0.3, 0.2, 0.1] }

/** The closest horizon (6/12/18/24 months) for an exam date, or null without one. */
export function horizonFor(examDate, now = Date.now()) {
  const d = Date.parse(examDate || '')
  if (!Number.isFinite(d)) return null
  const months = (d - now) / (DAY * 30.44)
  return HORIZONS.reduce((best, h) => (Math.abs(h - months) < Math.abs(best - months) ? h : best), HORIZONS[0])
}
export const weeksBetween = (from, to) => Math.max(0, Math.floor((to - from) / (7 * DAY)))

/** The plan length in weeks: until the exam date when there is one, otherwise the chosen horizon. */
export function totalWeeks(months, examDate, now = Date.now()) {
  const d = Date.parse(examDate || '')
  const w = Number.isFinite(d) ? weeksBetween(now, d) : Math.round((HORIZONS.includes(months) ? months : 12) * 4.345)
  return clamp(w, 3, 110)
}

/** Four phases covering the weeks, each at least one week when there is room: Base · Development · Specificity · Competitive. */
export function phasePlan(weeks, months) {
  const w = SPLIT[months] || SPLIT[12]
  const n = Math.max(1, Math.round(weeks))
  const min = n >= 4 ? 1 : 0
  const raw = w.map(x => Math.max(min, Math.floor(n * x)))
  let sum = raw.reduce((a, b) => a + b, 0)
  while (sum < n) { let b = 0; for (let i = 1; i < 4; i++) if (n * w[i] - raw[i] > n * w[b] - raw[b]) b = i; raw[b]++; sum++ }
  while (sum > n) { let b = -1; for (let i = 0; i < 4; i++) if (raw[i] > min && (b < 0 || raw[i] - n * w[i] > raw[b] - n * w[b])) b = i; if (b < 0) break; raw[b]--; sum-- }
  let from = 1
  return PHASES.map((phase, i) => { const out = { phase, weeks: raw[i], from, to: from + raw[i] - 1 }; from += raw[i]; return out })
}
export const phaseAtWeek = (phases, week) => (phases.find(p => week >= p.from && week <= p.to) || phases[phases.length - 1]).phase

/* ------------------------------------------------------------------------------------------------ paces and text */
export const fmtTime = s => {
  const t = Math.round(s * 10) / 10, m = Math.floor(t / 60), r = t - m * 60
  const rs = Number.isInteger(r) ? String(r).padStart(2, '0') : r.toFixed(1).padStart(4, '0')
  return m > 0 ? `${m}:${rs}` : `${t}s`
}
/** Running speed (km/h) implied by a mark of a time or distance test; null for anything else. */
export function paceKmh(test, value) {
  const v = fin(value)
  if (v == null || !(v > 0)) return null
  if (test.kind === 'time' && test.distanceM > 0) return test.distanceM / v * 3.6
  if (test.kind === 'distance' && test.durationS > 0) return v / test.durationS * 3.6
  return null
}
const half = x => Math.round(x * 2) / 2
const DEFAULT_KMH = { beginner: 9, intermediate: 11.5, advanced: 14 }

/* ------------------------------------------------------------------------------------------------ the plan */
const EX = { front: '0042', deadlift: '0032', legPress: '0739', thrust: '0058', calf: '0605', legCurl: '0586', stepup: '0114', split: '2368', dropJump: '3543', swing: '0549', medBall: '1302', dbBench: '0289', incline: '0047', press: '1456', dbPress: '0426', pendlay: '3017', dbRow: '0327', pushdown: '0201', curl: '0031', cableRow: '0861', pulldown: '0198', chinup: '1326', rear: '0203', lateral: '0334', crunch: '0274', hangKnee: '0011', mobility: '1585', run: '0684', sprint: '0858', pullup: '0652', assisted: '0017', row: '0499', pushup: '0662', bench: '0025', dip: '0251', squat: '0043', jump: '0514', legRaise: '0472', plank: '0464', deadBug: '0276', swim: '3433', bike: '0003', rdl: '0085', lunge: '0336' }
const SUBSTITUTE = {   // restriction → { exercise: [replacement, note] }
  knee: { [EX.jump]: [EX.squat, 'Sin saltos por tu restricción de rodilla: sentadilla controlada.'], [EX.lunge]: [EX.rdl, 'Sin zancadas por tu restricción de rodilla.'], [EX.sprint]: [EX.bike, 'Sin sprint por tu rodilla: bici a intensidad alta.'] },
  shoulder: { [EX.bench]: [EX.pushup, 'Sin press de banca por tu restricción de hombro: flexiones.'], [EX.dip]: [EX.pushup, 'Sin fondos por tu hombro.'] },
  back: { [EX.rdl]: [EX.deadBug, 'Sin bisagra pesada por tu restricción lumbar.'], [EX.squat]: [EX.deadBug, 'Sin sentadilla cargada por tu espalda.'] },
  ankle: { [EX.run]: [EX.bike, 'Sin carrera por tu restricción de tobillo: bici.'], [EX.sprint]: [EX.bike, 'Sin sprint por tu tobillo: bici.'], [EX.jump]: [EX.plank, 'Sin saltos por tu tobillo.'] },
  'elbow-wrist': { [EX.pullup]: [EX.row, 'Sin dominadas por tu codo/muñeca: remo invertido.'], [EX.bench]: [EX.pushup, 'Sin banca por tu codo/muñeca.'] },
}

/** Applies the member's restrictions: an exercise they cannot do is swapped and the block says why. The plan keeps its shape. */
export function applyRestrictions(blocks, restrictions = []) {
  return blocks.map(b => {
    for (const r of restrictions) {
      const sub = SUBSTITUTE[r]?.[b.exercise]
      if (sub) { const note = (b.note ? b.note + ' ' : '') + sub[1]; return { ...b, exercise: sub[0], note: note.slice(0, 200) } }
    }
    return b
  })
}

/** A block that stands in for a test the exercise library does not have (swimming, the hurdle circuit): it says so in its first words, never changes the official target, and carries `substitute: true` so it can be swapped for the real exercise later. */
export const SUBSTITUTE_TAG = '[SUSTITUTO TEMPORAL: sin ejercicio real en la biblioteca] '
const asSubstitute = b => ({ ...b, substitute: true, note: (SUBSTITUTE_TAG + (b.note || '')).slice(0, 200) })
const cond = (exercise, min, o = {}) => ({ role: 'conditioning', exercise, conditioning: { min: Math.max(1, Math.round(min)), ...(o.speed ? { speed: half(o.speed) } : {}) }, ...(o.note ? { note: String(o.note).slice(0, 200) } : {}) })
const hold = (exercise, sec, note) => ({ role: 'conditioning', exercise, conditioning: { sec: Math.max(5, Math.round(sec)) }, rest: 90, ...(note ? { note: String(note).slice(0, 200) } : {}) })
const sets = (exercise, n, lo, hi, o = {}) => ({ role: o.role || 'accessory', exercise, scheme: { sets: n, repsMin: Math.max(1, lo), repsMax: Math.max(Math.max(1, lo), hi), prog: 'double' }, ...(o.rest ? { rest: o.rest } : {}), ...(o.note ? { note: String(o.note).slice(0, 200) } : {}) })

/** Facts the builder needs for one test: the current mark, the target and the speeds they imply. */
function factsOf(profile, test, cat, marks, ambition, level) {
  const current = fin(marks?.[test.id])
  const target = targetOf(profile, test, cat, ambition)
  const now = paceKmh(test, current), goal = paceKmh(test, target?.value)
  const v = now || (goal ? goal * 0.88 : DEFAULT_KMH[level] || 10)
  return { test, current, target, v, vt: goal || v * 1.06, score: current != null ? scoreMark(profile, test, cat, current) : null }
}
const unitLabel = t => (t.kind === 'time' ? 's' : t.kind === 'hold' ? 's' : t.kind === 'distance' ? 'm' : 'rep.')

/** Work for one capacity in one phase, week `w` (1..4) of the block. Returns blocks (never empty). Everything numeric comes from the member's marks and the official target. */
function trainCapacity(cap, f, phase, w, level, scale = 1) {
  const L = LEVEL_RANK[level] ?? 0
  const m = Math.max(1, f.current ?? (f.target ? f.target.value * (cap === 'pull' || cap === 'push' ? 0.4 : 0.8) : 4))
  const tgt = f.target?.value
  switch (cap) {
    case 'endurance': {
      const dist = f.test.distanceM || (f.test.durationS ? Math.round(f.v * 1000 / 3.6 * f.test.durationS / 3600) : 1000)
      const easy = f.v * 0.62
      if (phase === 'base') return [cond(EX.run, (20 + 4 * w + 6 * L) * scale, { speed: easy, note: `Rodaje suave y continuo, a ritmo de conversación (~${r1(easy)} km/h). Es la base: no lo aceleres.` })]
      if (phase === 'development' && w % 2 === 0) return [cond(EX.run, 8, { speed: easy, note: 'Calentamiento suave.' }), cond(EX.run, Math.round((14 + 3 * w) * scale), { speed: f.v * 0.88, note: `Tempo continuo a ritmo de umbral (~${r1(f.v * 0.88)} km/h), RPE 7: sostenido pero controlado.` }), cond(EX.run, 6, { speed: easy, note: 'Vuelta a la calma.' })]
      if (phase === 'development') {
        const reps = 2 + w
        return [cond(EX.run, 8, { speed: easy, note: 'Calentamiento suave.' }), cond(EX.run, Math.round(reps * 4.5 * scale), { speed: f.v * 0.95, note: `${reps} × 3 min a ritmo fuerte (~${r1(f.v * 0.95)} km/h) con 90 s suaves entre series.` }), cond(EX.run, 6, { speed: easy, note: 'Vuelta a la calma.' })]
      }
      if (phase === 'specificity') {
        const rep = dist >= 1500 ? 600 : dist >= 800 ? 400 : 200
        const reps = 3 + w
        const t = rep / (f.vt / 3.6)
        return [cond(EX.run, 8, { speed: easy, note: 'Calentamiento suave.' }), cond(EX.run, Math.round(reps * (t / 60 + 1.5) * scale), { speed: f.vt, note: `${reps} × ${rep} m a ritmo objetivo (${fmtTime(t)} por ${rep} m${tgt ? `, objetivo ${tgt} ${unitLabel(f.test)}` : ''}) con 90 s de recuperación.` }), cond(EX.run, 6, { speed: easy, note: 'Vuelta a la calma.' })]
      }
      const t = dist / (f.vt / 3.6)
      return [cond(EX.run, 8, { speed: easy, note: 'Calentamiento suave.' }), cond(EX.run, Math.round((2 + (w % 2)) * (t / 60 * 0.4 + 2)), { speed: f.vt, note: `${2 + (w % 2)} × ${Math.round(dist * 0.4 / 50) * 50} m a ritmo de prueba, descanso largo: afinar sin acumular fatiga.` }), cond(EX.run, 5, { speed: easy, note: 'Vuelta a la calma.' })]
    }
    case 'speed': {
      const spec = { base: ['6 × 30 m de aceleración progresiva, 1 min de descanso.', 8], development: ['6 × 60 m a esfuerzo máximo, 2 min de descanso.', 14], specificity: ['4 × 120 m al 95 % del ritmo objetivo, 3 min de descanso.', 16], competitive: ['3 × 150 m rápidos y 2 × 30 m de salida, descanso completo.', 14] }[phase]
      return [cond(EX.run, 8, { speed: f.v * 0.6, note: 'Calentamiento: trote y movilidad.' }), cond(EX.sprint, Math.round(spec[1] * scale), { note: spec[0] + (tgt ? ` Objetivo de la prueba: ${tgt} s.` : '') })]
    }
    case 'agility': {
      const reps = { base: 4, development: 6, specificity: 8, competitive: 6 }[phase] + (w > 2 ? 1 : 0)
      return [asSubstitute(cond(EX.sprint, Math.round((reps * 1.5 + 4) * scale), { note: `Circuito con conos/vallas y cambios de dirección: ${reps} rep., 90 s de descanso. Practica el recorrido real.` }))]
    }
    case 'pull': {
      const base = f.test.movement === 'hang'
      const ex = m < 2 ? EX.assisted : EX.pullup
      if (base) {
        const s = Math.max(10, Math.round(m * ({ base: 0.3, development: 0.5, specificity: 0.7, competitive: 0.6 }[phase] + 0.03 * w)))
        return [hold(ex, s, `Suspensión con la barbilla sobre la barra. ${3 + (w > 2 ? 1 : 0)} intentos de ${s} s con 90 s de descanso.${tgt ? ` Objetivo: ${tgt} s.` : ''}`), hold(ex, s, ''), hold(ex, s, '')]
      }
      const lo = { base: 0.3, development: 0.5, specificity: 0.6, competitive: 0.5 }[phase], hi = { base: 0.5, development: 0.8, specificity: 0.9, competitive: 0.75 }[phase]
      const n = { base: 3, development: 4, specificity: 5, competitive: 3 }[phase]
      return [sets(ex, n, Math.floor(m * lo), Math.ceil(m * hi + w * 0.4), { role: 'main', rest: 120, note: `Series lejos del fallo, calidad de repetición como en la prueba (barbilla sobre la barra, codos extendidos).${tgt ? ` Objetivo: ${tgt}.` : ''}` }), sets(EX.row, 3, 8, 12, { rest: 75 })]
    }
    case 'push': {
      const bench = f.test.movement === 'bench'
      const ex = bench ? EX.bench : EX.pushup
      const lo = { base: 0.3, development: 0.5, specificity: 0.6, competitive: 0.5 }[phase], hi = { base: 0.5, development: 0.75, specificity: 0.9, competitive: 0.7 }[phase]
      const n = { base: 3, development: 4, specificity: 5, competitive: 3 }[phase]
      return [sets(ex, n, Math.floor(m * lo), Math.ceil(m * hi + w * 0.5), { role: 'main', rest: bench ? 90 : 60, note: bench ? `Press de banca con la carga de la prueba (40 kg si es la de la convocatoria): repeticiones técnicas hasta el pecho y extensión completa.${tgt ? ` Objetivo: ${tgt} rep.` : ''}` : `Repeticiones completas y controladas, como en la prueba.${tgt ? ` Objetivo: ${tgt} rep.` : ''}` }), sets(EX.dip, 2, 6, 10, { rest: 75 })]
    }
    case 'power': {
      const n = { base: 3, development: 4, specificity: 5, competitive: 3 }[phase]
      return [sets(EX.jump, n, 3, 5, { role: 'main', rest: 90, note: `Salta con máxima intención y aterriza con control.${tgt ? ` Objetivo del salto: ${tgt} ${f.test.unit}.` : ''}` }), sets(EX.squat, 3, 5, 8, { rest: 120 })]
    }
    case 'swim': {
      const mins = { base: 30, development: 35, specificity: 35, competitive: 25 }[phase]
      const detail = { base: 'técnica: 8 × 25 m con 20 s de descanso, respiración y patada.', development: '10 × 25 m a ritmo fuerte con 20 s de descanso.', specificity: '6 × 50 m a ritmo de prueba con 45 s de descanso.', competitive: '4 × 25 m a ritmo de prueba y 1 × 50 m completo.' }[phase]
      return [asSubstitute(cond(EX.swim, mins * scale, { note: `Haz la sesión en la piscina; esto no mide la prueba. ${detail}${tgt ? ` Objetivo: ${tgt} s.` : ''}` }))]
    }
    default: return []
  }
}

const SESSION_MIN = { endurance: 32, speed: 22, agility: 20, pull: 24, push: 24, power: 18, swim: 40 }
const TITLE = { endurance: 'Resistencia', speed: 'Velocidad', agility: 'Agilidad', pull: 'Dominadas', push: 'Empuje', power: 'Salto', swim: 'Natación' }

/** What each capacity needs, 0..1 (1 = furthest from its target). A capacity without a mark counts as moderately needy. */
export function needsOf(profile, cat, marks, ambition = 'pass') {
  const needs = {}
  for (const t of testsFor(profile, cat)) {
    const s = scoreMark(profile, t, cat, marks?.[t.id])
    const tg = targetOf(profile, t, cat, ambition)
    const ts = tg ? scoreMark(profile, t, cat, tg.value) : null
    const need = s && ts ? clamp((ts.position - s.position) / Math.max(0.25, ts.position + 1), 0, 1) : 0.5
    needs[t.capacity] = Math.max(needs[t.capacity] ?? 0, r1(need * 100) / 100)
  }
  return needs
}

const CAP_ORDER = ['endurance', 'speed', 'agility', 'pull', 'push', 'power', 'swim']
const KEY = i => 'd' + (i + 1)

/** A control week: the official tests spread over a few days like a real convocatoria (running · strength · swimming), the rest of the days easy. */
function controlWeek(profile, cat, days, level, factsBy, phase, restrictions = []) {
  const groups = [
    ['Pruebas de carrera', ['run', 'sprint', 'agility']],
    ['Pruebas de fuerza', ['pullup', 'hang', 'pushup', 'bench', 'jump']],
    ['Prueba de natación', ['swim']],
  ].map(([title, mv]) => [title, testsFor(profile, cat).filter(t => mv.includes(t.movement))]).filter(([, ts]) => ts.length)
  const sessions = groups.map(([title, ts], i) => ({
    key: 'control-' + (i + 1), title: 'Control · ' + title,
    blocks: applyRestrictions([cond(EX.run, 10, { speed: DEFAULT_KMH[level] * 0.6, note: 'Calentamiento completo antes de las pruebas.' }),
      ...ts.map(t => {
        const f = factsBy[t.id]
        const tg = f?.target ? ` Objetivo: ${f.target.value} ${t.unit}.` : ''
        const ex = { run: EX.run, sprint: EX.sprint, agility: EX.sprint, pullup: EX.pullup, hang: EX.pullup, pushup: EX.pushup, bench: EX.bench, jump: EX.jump, swim: EX.swim }[t.movement]
        const note = `PRUEBA: ${t.name}. Hazla como en la convocatoria y anota tu mejor marca (${t.unit}) en la evaluación.${tg}`
        const block = t.kind === 'hold' ? hold(ex, f?.current ? f.current : 40, note) : t.kind === 'reps' ? sets(ex, 1, 1, Math.max(2, Math.round(f?.target?.value || 10)), { role: 'main', rest: 180, note }) : cond(ex, Math.max(2, Math.round((t.distanceM || 200) / (f?.vt || 10) * 3.6 / 60 + 2)), { note })
        return t.movement === 'swim' || t.movement === 'agility' ? asSubstitute({ ...block, note: `PRUEBA ${t.name.split(' · ')[0]}: hazla de verdad y anota tu marca oficial a mano.${tg}` }) : block
      })], restrictions),
  }))
  const easy = Math.max(0, days - sessions.length)
  for (let i = 0; i < easy; i++) sessions.push({ key: 'recovery-' + (i + 1), title: 'Recuperación activa', blocks: [cond(EX.run, 20, { speed: DEFAULT_KMH[level] * 0.55, note: 'Muy suave, solo para soltar las piernas. Descansa lo suficiente antes de las pruebas.' })] })
  return { label: `Semana de control · ${phase}`, phase: 'control', sessions: sessions.slice(0, 7) }
}

/* ------------------------------------------------------------------------------------------------ training: real strength & conditioning sessions */
// [sets, repsMin, repsMax, RPE, rest seconds] per tier and phase. The app's own double progression raises the load when the top of the range is reached at the target effort.
const RX = {
  base: { main: [4, 6, 8, 7, 120], second: [3, 8, 10, 7, 90], acc: [3, 10, 12, 8, 60] },
  development: { main: [5, 3, 5, 8, 180], second: [4, 5, 8, 8, 120], acc: [3, 8, 10, 8, 75] },
  specificity: { main: [4, 3, 5, 8, 150], second: [3, 5, 8, 8, 105], acc: [2, 8, 12, 8, 60] },
  competitive: { main: [3, 2, 4, 7, 150], second: [2, 4, 6, 7, 90], acc: [2, 8, 10, 7, 60] },
}
const mss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** One strength exercise with its prescription: sets, rep range, target effort (RPE) and rest. Week 4 of a block is the deload; beginners carry fewer sets and more reps. */
function lift(ex, tier, phase, w, level, o = {}) {
  let [n, lo, hi, rpe, rest] = RX[phase]?.[tier] || RX.base[tier]
  if (level === 'beginner') { n = Math.max(2, n - 1); lo += 2; hi += 2; rpe = Math.min(rpe, 7) }
  if (w >= 4) { n = Math.max(1, n - 1); rpe = Math.max(5, rpe - 1) }
  const cue = w >= 4 ? 'Semana de descarga: mismo patrón, menos series.' : o.cue || (w === 1 ? 'Empieza conservador y deja 2–3 repeticiones en reserva.' : 'Sube la carga si cierras el techo del rango con el RPE indicado.')
  return { ...sets(ex, n, lo, hi, { role: tier === 'main' ? 'main' : 'accessory', rest, note: `RPE ${rpe} · descanso ${mss(rest)}. ${cue}` }), ...(o.sg ? { sg: o.sg } : {}) }
}
const minutesOf = b => (b.scheme ? b.scheme.sets * ((b.rest || 60) / 60 + 0.7) : b.conditioning?.min ? b.conditioning.min : 2)
const mobilityBlock = () => cond(EX.mobility, 5, { note: 'Movilidad y prevención: cadera, tobillo, hombro y espalda torácica. Controlado, sin dolor.' })

/** The week's day types, chosen from the member's needs, the days they have and the facilities: strength is never dropped, conditioning follows the tested capacities. */
export function planDays(needs, days, { pool = true } = {}) {
  const n = c => needs[c] ?? null
  const has = c => n(c) != null
  const cond0 = []
  if (has('endurance')) cond0.push({ type: 'endurance', score: 0.6 + n('endurance') })
  if (has('speed') || has('agility') || has('power')) cond0.push({ type: 'speed', score: 0.5 + Math.max(n('speed') ?? 0, n('agility') ?? 0, n('power') ?? 0) })
  if (has('swim') && pool) cond0.push({ type: 'swim', score: 0.5 + n('swim') })
  cond0.sort((a, b) => b.score - a.score)
  if (days <= 2) return [{ type: 'full' }, cond0[0] ? { type: cond0[0].type } : { type: 'upper' }].slice(0, days)
  const cand = [{ type: 'lower', score: 0.9 }, { type: 'upper', score: 0.9 + 0.1 * Math.max(n('pull') ?? 0, n('push') ?? 0) }, ...cond0]
  if (has('endurance')) cand.push({ type: 'endurance2', score: 0.35 + (n('endurance') ?? 0) * 0.8 })
  cand.push({ type: 'lower2', score: 0.3 }, { type: 'upper2', score: 0.28 })
  const chosen = cand.sort((a, b) => b.score - a.score).slice(0, days).map(c => c.type)
  const ORDER = ['lower', 'endurance', 'upper', 'speed', 'swim', 'lower2', 'endurance2', 'upper2']
  return chosen.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map(type => ({ type }))
}

const DAY_TITLE = { full: 'Cuerpo completo', lower: 'Fuerza inferior + potencia', lower2: 'Fuerza inferior 2 + unilateral', upper: 'Fuerza superior + tracción', upper2: 'Fuerza superior 2 + empuje', speed: 'Velocidad / agilidad', endurance: 'Resistencia', endurance2: 'Resistencia 2', swim: 'Natación + hombro' }

/** One complete session: ordered blocks (power/speed first, then strength, then specific work, core and mobility), fitted to the minutes available. */
function buildDay(type, ctx) {
  const { phase, w, byCap, levels, minutes, scale, bodyweight } = ctx
  const lvl = c => levels?.byCapacity?.[c]?.level || levels?.global?.level || 'beginner'
  const strengthLvl = ['pull', 'push', 'power'].map(lvl).sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0] || 'beginner'
  const spec = c => (byCap[c] ? trainCapacity(c, byCap[c], phase, w, lvl(c), scale) : [])
  const core = () => [hold(EX.plank, phase === 'base' ? 40 : 30, 'Plancha: 2 series, sin perder la posición.'), lift(EX.legRaise, 'acc', phase, w, strengthLvl, { cue: 'Control, sin balanceo.' })]
  const warm = [cond(EX.run, 6, { speed: 6, note: 'Calentamiento: trote suave y movilidad dinámica.' })]
  const power = () => (phase === 'base'
    ? [lift(EX.swing, 'acc', phase, w, strengthLvl, { cue: 'Bisagra de cadera explosiva, técnica limpia.' })]
    : [{ ...sets(EX.jump, phase === 'competitive' ? 3 : 4, 3, 5, { role: 'main', rest: 90, note: 'Potencia: salta con máxima intención, aterriza con control. Calidad sobre cantidad.' }) }])
  let blocks = []
  const need = []   // [priority block groups], trimmed from the end to fit the time
  if (type === 'lower' || type === 'full') {
    blocks.push(...(type === 'lower' ? power() : []), lift(bodyweight ? EX.split : EX.squat, 'main', phase, w, strengthLvl), lift(EX.rdl, 'second', phase, w, strengthLvl))
    need.push(...(type === 'full' ? [] : [lift(EX.split, 'second', phase, w, strengthLvl, { cue: 'Unilateral: mismo rango en ambas piernas.' }), lift(EX.thrust, 'acc', phase, w, strengthLvl)]))
    if (type === 'full') { blocks.push(...spec('pull').slice(0, 1), lift(EX.bench, 'second', phase, w, strengthLvl)) }
  }
  if (type === 'lower2') blocks.push(lift(EX.deadlift, 'main', phase, w, strengthLvl), lift(EX.legPress, 'second', phase, w, strengthLvl), ...power().slice(0, 1))
  if (type === 'lower2') need.push(lift(EX.stepup, 'acc', phase, w, strengthLvl, { sg: 'a' }), lift(EX.calf, 'acc', phase, w, strengthLvl, { sg: 'a' }), lift(EX.legCurl, 'acc', phase, w, strengthLvl))
  if (type === 'lower') need.push(lift(EX.calf, 'acc', phase, w, strengthLvl, { sg: 'b' }), lift(EX.legCurl, 'acc', phase, w, strengthLvl, { sg: 'b' }))
  if (type === 'upper') {
    blocks.push(...(byCap.pull ? spec('pull') : [lift(EX.pulldown, 'main', phase, w, strengthLvl)]), ...(byCap.push ? spec('push').slice(0, 1) : [lift(EX.bench, 'main', phase, w, strengthLvl)]), lift(EX.pendlay, 'second', phase, w, strengthLvl))
    need.push(lift(EX.dbPress, 'acc', phase, w, strengthLvl, { sg: 'c' }), lift(EX.rear, 'acc', phase, w, strengthLvl, { sg: 'c' }), lift(EX.curl, 'acc', phase, w, strengthLvl))
  }
  if (type === 'upper2') {
    blocks.push(lift(EX.press, 'main', phase, w, strengthLvl), lift(EX.chinup, 'second', phase, w, strengthLvl), lift(EX.dbRow, 'second', phase, w, strengthLvl))
    need.push(...(byCap.push ? spec('push') : []), lift(EX.dip, 'acc', phase, w, strengthLvl, { sg: 'd' }), lift(EX.lateral, 'acc', phase, w, strengthLvl, { sg: 'd' }), lift(EX.pushdown, 'acc', phase, w, strengthLvl))
  }
  if (type === 'speed') {
    blocks.push(...(byCap.speed ? [] : warm), ...spec('speed'), ...spec('agility'))
    blocks.push(...(phase === 'base' ? [lift(EX.jump, 'acc', phase, w, strengthLvl, { cue: 'Saltos bajos y técnica de aterrizaje.' })] : power()))
    need.push(lift(EX.legCurl, 'acc', phase, w, strengthLvl, { cue: 'Prevención de isquiotibiales.' }))
  }
  if (type === 'endurance' || type === 'endurance2') blocks.push(...(type === 'endurance2' && phase !== 'competitive' ? [cond(EX.run, 24 + 3 * w, { speed: (byCap.endurance?.v || 10) * 0.62, note: 'Rodaje fácil de recuperación activa, RPE 4–5: aeróbico sin fatiga extra.' })] : spec('endurance')))
  if (type === 'swim') { blocks.push(...spec('swim'), lift(EX.pulldown, 'second', phase, w, strengthLvl), lift(EX.rear, 'acc', phase, w, strengthLvl, { cue: 'Estabilidad escapular para nadar.' })) }
  const tail = [...core(), mobilityBlock()]
  // fit the time: required blocks first, then the optional ones while they still fit, then core and mobility
  let total = [...blocks, ...tail].reduce((a, b) => a + minutesOf(b), 0)
  const optional = []
  for (const b of need) { if (total + minutesOf(b) <= minutes) { optional.push(b); total += minutesOf(b) } }
  return [...blocks, ...optional, ...tail]
}

/** Session titles use the capacities the day really trains. */
const dayTitle = (type, pullFocus) => (type === 'upper' && pullFocus ? 'Fuerza superior + dominadas' : DAY_TITLE[type])

/** One 5-week block (four training weeks + one control week) as a Premium definition. `startWeek` is the calendar week of the plan the block starts in. */
export function buildBlock({ profile, plan, blockIndex = 0, startWeek = 1, marks, levels, scale = 1, focusUp = [] }) {
  const cat = plan.category
  const phases = plan.phases
  const weeksLeft = Math.max(1, plan.weeksTotal - (startWeek - 1))
  const blockWeeks = Math.min(BLOCK_WEEKS, Math.max(2, weeksLeft))
  const days = clamp(plan.intake.days, 2, 6)
  const minutes = clamp(plan.intake.minutes || 60, 30, 150)
  const eq = plan.intake.equipment || {}
  const bodyweight = !eq.gym && !eq.weights
  const needs = needsOf(profile, cat, marks, plan.ambition)
  for (const c of focusUp) if (needs[c] != null) needs[c] = Math.min(1, needs[c] + 0.3)
  const factsBy = Object.fromEntries(testsFor(profile, cat).map(t => [t.id, factsOf(profile, t, cat, marks, plan.ambition, levels?.byCapacity?.[t.capacity]?.level || levels?.global?.level || 'beginner')]))
  const byCap = {}
  for (const t of testsFor(profile, cat)) if (!byCap[t.capacity]) byCap[t.capacity] = factsBy[t.id]
  const weeks = []
  const phaseFirst = phaseAtWeek(phases, startWeek)
  const dayTypes = planDays(needs, days, { pool: eq.pool !== false })
  for (let k = 0; k < blockWeeks; k++) {
    const calendarWeek = startWeek + k
    const phase = phaseAtWeek(phases, calendarWeek)
    if (k === blockWeeks - 1) { weeks.push(controlWeek(profile, cat, days, levels?.global?.level || 'beginner', factsBy, phase, plan.intake.restrictions)); continue }
    const w = Math.min(4, k + 1)
    const ctx = { phase, w, byCap, levels, minutes, scale: (w === 4 ? 0.8 : 1) * scale, bodyweight }
    const sessions = dayTypes.map((d, i) => ({ key: KEY(i), title: `Sesión ${i + 1} · ${dayTitle(d.type, !!byCap.pull && (needs.pull ?? 0) >= (needs.push ?? 0))}`, kind: d.type, blocks: applyRestrictions(buildDay(d.type, ctx), plan.intake.restrictions).slice(0, 14) }))
    weeks.push({ label: `Semana ${k + 1} · ${phase}`, phase, sessions })
  }
  const def = { schema: 1, cycleWeeks: blockWeeks, weeks }
  const perWeek = Math.max(...weeks.map(w => w.sessions.length))
  return { definition: def, meta: { phase: phaseFirst, startWeek, weeks: blockWeeks, daysPerWeek: perWeek, dayTypes: dayTypes.map(d => d.type), qualities: qualitiesOf(profile, cat), needs } }
}

/** What each test asks the body for, so the plan trains the capacities, not the numbers: every plan also carries strength, core and mobility. */
export function qualitiesOf(profile, cat) {
  const q = new Set(['strength'])
  for (const t of testsFor(profile, cat)) {
    if (t.movement === 'run') q.add('aerobic')
    if (t.movement === 'sprint') { q.add('speed'); q.add('power') }
    if (t.movement === 'agility') { q.add('agility'); q.add('power'); q.add('speed') }
    if (t.movement === 'pullup' || t.movement === 'hang') { q.add('relative-strength'); q.add('muscular-endurance') }
    if (t.movement === 'pushup' || t.movement === 'bench') q.add('muscular-endurance')
    if (t.movement === 'jump') q.add('power')
    if (t.movement === 'swim') q.add('swim')
  }
  q.add('core'); q.add('mobility')
  return [...q]
}

/* ------------------------------------------------------------------------------------------------ plan instance */
export function sanitizeIntake(i) {
  const o = isObj(i) ? i : {}
  const eq = isObj(o.equipment) ? o.equipment : {}
  return {
    organism: str(o.organism, 160), convocatoria: str(o.convocatoria, 200), testVersion: str(o.testVersion, 80),
    sex: o.sex === 'f' ? 'f' : o.sex === 'm' ? 'm' : null, age: fin(o.age) != null ? clamp(Math.round(fin(o.age)), 16, 70) : null,
    days: clamp(Math.round(fin(o.days) ?? 3), 2, 6), minutes: clamp(Math.round(fin(o.minutes) ?? 60), 30, 150),
    equipment: isObj(o.equipment) ? { gym: !!eq.gym, track: !!eq.track, pool: !!eq.pool, bar: !!eq.bar, weights: !!eq.weights } : { gym: true, track: true, pool: true, bar: true, weights: true },
    runningExp: ['none', 'some', 'regular'].includes(o.runningExp) ? o.runningExp : 'none', swimmingExp: ['none', 'some', 'regular'].includes(o.swimmingExp) ? o.swimmingExp : 'none',
    yearsTraining: clamp(fin(o.yearsTraining) ?? 0, 0, 60),
    restrictions: (Array.isArray(o.restrictions) ? o.restrictions : []).filter(r => RESTRICTIONS.includes(r)).slice(0, 6),
    selfLevel: LEVELS.includes(o.selfLevel) ? o.selfLevel : 'beginner',
  }
}

/** The facts still missing before a plan can be built for this profile (empty = ready). Never guessed. */
export function missingForPlan(profile, intake, examDate, months) {
  const out = []
  if (needsSex(profile) && !intake.sex) out.push('sex')
  if (needsAge(profile) && !Number.isFinite(intake.age)) out.push('age')
  if (!examDate && !HORIZONS.includes(months)) out.push('horizon')
  if (profile.askBeforeStart?.includes('organism') && !intake.organism) out.push('organism')
  if (profile.askBeforeStart?.includes('convocatoria') && !intake.convocatoria) out.push('convocatoria')
  return out
}

/** A new plan from a published profile. Returns { plan, block } — the first block's definition — or { error } naming what is missing. */
export function newPlan({ profile, intake: rawIntake, marks: rawMarks = {}, examDate = null, months = null, ambition = 'pass', now = Date.now(), id } = {}) {
  const issues = validateProfile(profile)
  if (issues.length) return { error: 'profile', issues }
  const intake = sanitizeIntake(rawIntake)
  const exam = isoDate(examDate)
  const horizon = HORIZONS.includes(months) ? months : horizonFor(exam, now) || null
  const missing = missingForPlan(profile, intake, exam, horizon)
  if (missing.length) return { error: 'missing', missing }
  const cat = categoryOf(profile, intake)
  if (!cat) return { error: 'missing', missing: ['sex', 'age'].filter(k => (k === 'sex' ? needsSex(profile) : needsAge(profile))) }
  const marks = {}
  for (const t of profile.tests) { const v = fin(rawMarks?.[t.id]); if (v != null && v >= 0) marks[t.id] = v }
  const weeks = totalWeeks(horizon, exam, now)
  const levels = levelsOf(profile, cat, marks, intake.selfLevel)
  const plan = {
    id: id || `opp-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, v: SCHEMA, status: 'active',
    profileId: profile.id, profileVersion: profile.version, profile: clone(profile), profileHistory: [],
    intake, category: cat, ambition: AMBITIONS.includes(ambition) ? ambition : 'pass',
    startedAt: now, examDate: exam, months: horizon, weeksTotal: weeks, phases: phasePlan(weeks, horizon),
    initialMarks: { ...marks }, marks: { ...marks }, markDates: Object.fromEntries(Object.keys(marks).map(k => [k, now])), levels, initialLevels: levels,
    blockIndex: 0, blocks: [], evaluations: [], proposal: null, alerts: [],
  }
  const block = buildBlock({ profile, plan, blockIndex: 0, startWeek: 1, marks, levels })
  return { plan, block }
}

/** The Premium program a block runs as: pinned by the Premium engine in the member's instance snapshot. */
export function programFor(plan, block, { cover } = {}) {
  const short = plan.profile.name.length > 44 ? plan.profile.name.slice(0, 43) + '…' : plan.profile.name
  return {
    id: `opposition-${plan.id}-b${plan.blockIndex + 1}`, slug: 'entrena-tus-oposiciones', name: `${short} · bloque ${plan.blockIndex + 1}`, version: plan.profileVersion,
    level: plan.levels?.global?.level || 'beginner', daysPerWeek: block.meta.daysPerWeek, goalTags: ['conditioning', 'strength'], programDefinition: block.definition,
    ...(cover ? { coverImage: cover.image, coverImageAlt: cover.alt || '', ...(cover.focal ? { coverFocalPoint: cover.focal } : {}) } : {}),
  }
}

/* ------------------------------------------------------------------------------------------------ evaluation */
export const calendarWeek = (plan, now = Date.now()) => Math.max(1, weeksBetween(plan.startedAt, now) + 1)
export const weeksLeft = (plan, now = Date.now()) => {
  const d = Date.parse(plan.examDate || '')
  return Math.max(0, Number.isFinite(d) ? Math.ceil((d - now) / (7 * DAY)) : plan.weeksTotal - weeksBetween(plan.startedAt, now))
}

/** Scores a control: each test against the official minimum, the target, the previous and the initial mark, with a projection to the exam. Nothing is changed in the plan. */
export function evaluate(plan, results, { now = Date.now(), adherence = null, fatigue = 'normal', pain = false } = {}) {
  const profile = plan.profile, cat = plan.category
  const prev = plan.evaluations[plan.evaluations.length - 1] || null
  const left = weeksLeft(plan, now)
  const marks = { ...plan.marks }
  for (const t of testsFor(profile, cat)) { const v = fin(results?.[t.id]); if (v != null && v >= 0) marks[t.id] = v }
  const per = {}
  for (const t of testsFor(profile, cat)) {
    const value = fin(results?.[t.id]) ?? null
    if (value == null) { per[t.id] = { value: null, status: 'no-data' }; continue }
    const s = scoreMark(profile, t, cat, value), tg = targetOf(profile, t, cat, plan.ambition)
    if (!s) { per[t.id] = { value, status: 'no-data' }; continue }
    const ts = tg ? scoreMark(profile, t, cat, tg.value) : null
    const init = fin(plan.initialMarks[t.id]) != null ? scoreMark(profile, t, cat, plan.initialMarks[t.id]) : null
    const before = prev?.perTest?.[t.id]?.value != null ? scoreMark(profile, t, cat, prev.perTest[t.id].value) : null
    const weeksElapsed = Math.max(1, weeksBetween(init ? (plan.markDates[t.id] || plan.startedAt) : plan.startedAt, now))
    const rate = init ? (s.position - init.position) / weeksElapsed : before ? (s.position - before.position) / Math.max(1, weeksBetween(prev.at, now)) : null
    const projected = rate != null ? s.position + rate * left * 0.75 : null
    let status
    if (ts && s.position >= ts.position) status = 'above-target'
    else if (before && s.position - before.position <= 0.02) status = 'stalled'
    else if (s.position < 0 && (left < 8 || (rate != null && rate <= 0))) status = 'at-risk'
    else if ((ts && projected != null && projected >= ts.position) || (s.position >= 0 && rate != null && rate > 0)) status = 'on-track'
    else if (s.position >= 0) status = 'stalled'
    else status = rate != null && rate > 0 && projected >= 0 ? 'on-track' : 'at-risk'
    per[t.id] = { value, points: s.points, passed: s.passed, position: s.position, minimum: s.minimum, target: tg?.value ?? null, targetPoints: tg?.points ?? null, initial: plan.initialMarks[t.id] ?? null, previous: prev?.perTest?.[t.id]?.value ?? null, projected: projected == null ? null : Math.round(projected * 100) / 100, status }
  }
  const total = overall(profile, cat, marks)
  const levels = levelsOf(profile, cat, marks, plan.intake.selfLevel)
  const weak = Object.entries(per).filter(([, x]) => x.status === 'at-risk' || x.status === 'stalled').map(([id]) => id)
  const needsReview = weak.some(id => per[id].status === 'at-risk') || (adherence != null && adherence < 50) || !!pain
  return { at: now, calendarWeek: calendarWeek(plan, now), weeksLeft: left, perTest: per, levels, overall: { average: total.average, passed: total.passed, missing: total.missing }, weak, adherence, fatigue, pain: !!pain, needsReview, marksSnapshot: marks }
}

/** Records an evaluation in the plan (marks and levels move forward). The next block is a separate, confirmed step: see proposeNext. */
export function recordEvaluation(plan, evaluation) {
  const next = clone(plan)
  next.evaluations = [...next.evaluations, evaluation].slice(-30)
  next.marks = { ...next.marks, ...Object.fromEntries(Object.entries(evaluation.perTest).filter(([, x]) => x.value != null).map(([id, x]) => [id, x.value])) }
  for (const [id, x] of Object.entries(evaluation.perTest)) if (x.value != null) next.markDates = { ...next.markDates, [id]: evaluation.at }
  next.levels = evaluation.levels
  next.alerts = evaluation.needsReview ? ['review'] : []
  return next
}

/** The next block as a PROPOSAL: what would change and why. Capped: a capacity moves at most one level, volume at most ±20 %, and it never applies itself. */
export function proposeNext(plan, evaluation, { now = Date.now() } = {}) {
  const profile = plan.profile
  const changes = []
  const weakCaps = [...new Set(evaluation.weak.map(id => profile.tests.find(t => t.id === id)?.capacity).filter(Boolean))]
  let scale = 1
  const adh = evaluation.adherence
  if (evaluation.pain || evaluation.fatigue === 'high') { scale = 0.8; changes.push({ kind: 'volume', pct: -20, reason: evaluation.pain ? 'pain' : 'fatigue' }) }
  else if (adh != null && adh < 60) { scale = 0.85; changes.push({ kind: 'volume', pct: -15, reason: 'adherence' }) }
  else if (adh != null && adh >= 85 && evaluation.weak.length === 0) { scale = 1.1; changes.push({ kind: 'volume', pct: 10, reason: 'on-track' }) }
  for (const c of weakCaps) changes.push({ kind: 'focus', capacity: c })
  const startWeek = Math.min(plan.weeksTotal, calendarWeek(plan, now))
  const before = phaseAtWeek(plan.phases, Math.max(1, startWeek - BLOCK_WEEKS)), after = phaseAtWeek(plan.phases, startWeek)
  if (before !== after) changes.push({ kind: 'phase', from: before, to: after })
  if (evaluation.needsReview) changes.push({ kind: 'review' })
  return { at: now, changes, scale, startWeek, focusUp: weakCaps, confirmed: false }
}

/** The next block a stored proposal stands for. Deterministic from the plan (marks and levels already recorded) and the proposal, so only the small proposal is kept in the member's state. */
export function blockFor(plan, proposal) {
  return buildBlock({ profile: plan.profile, plan: { ...plan, blockIndex: plan.blockIndex + 1 }, blockIndex: plan.blockIndex + 1, startWeek: proposal.startWeek, marks: plan.marks, levels: plan.levels, scale: proposal.scale, focusUp: proposal.focusUp || [] })
}

/** "5=8, 6=10" ⇄ [{ p, v }]: the compact form an administrator edits a scale in. Returns null when the text is not a valid scale. */
export function parseScale(text) {
  const out = []
  for (const part of String(text || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*(?:\(([^)]{1,24})\))?\s*=\s*(\d+(?:\.\d+)?)$/.exec(part)
    if (!m) return null
    out.push({ p: Number(m[1]), v: Number(m[3]), ...(m[2] ? { label: m[2] } : {}) })
  }
  return out.length ? out : null
}
export const formatScale = scale => (scale || []).map(e => `${e.p}${e.label ? '(' + e.label + ')' : ''}=${e.v}`).join(', ')

/** Confirms a proposal: the plan advances one block (the finished one is recorded). The caller activates `block` on the Premium engine. */
export function applyProposal(plan, proposal, finished = null) {
  const next = clone(plan)
  if (finished) next.blocks = [...next.blocks, finished].slice(-40)
  next.blockIndex = plan.blockIndex + 1
  next.proposal = null
  return next
}

/** A profile with a newer version: the plan moves to it only on confirmation, keeping the version it was built on in its history. */
export function moveToVersion(plan, profile, { now = Date.now() } = {}) {
  const next = clone(plan)
  next.profileHistory = [...(next.profileHistory || []), { version: plan.profileVersion, at: now, snapshot: plan.profile }].slice(-6)
  next.profile = clone(profile); next.profileVersion = profile.version
  next.levels = levelsOf(profile, plan.category, plan.marks, plan.intake.selfLevel)
  return next
}

/* ------------------------------------------------------------------------------------------------ summaries (Coach and AI) */
/** The compact view the staff and the Coach AI get. No name, no free text, no injury detail beyond coded areas; thresholds are the ones that apply to this person. */
export function summarizePlan(plan, { adherence = null, now = Date.now() } = {}) {
  if (!plan || !plan.profile) return null
  const profile = plan.profile, cat = plan.category
  const last = plan.evaluations[plan.evaluations.length - 1] || null
  const tests = testsFor(profile, cat).map(t => {
    const v = fin(plan.marks[t.id])
    const s = v != null ? scoreMark(profile, t, cat, v) : null, tg = targetOf(profile, t, cat, plan.ambition)
    return { id: t.id, name: t.name, capacity: t.capacity, unit: t.unit, kind: t.kind, mark: v, initial: plan.initialMarks[t.id] ?? null, points: s?.points ?? null, minimum: s?.minimum ?? scaleOf(t, cat)?.[0]?.v ?? null, target: tg?.value ?? null, status: last?.perTest?.[t.id]?.status || (v == null ? 'no-data' : null) }
  })
  const weak = tests.filter(x => ['at-risk', 'stalled'].includes(x.status)).map(x => x.id)
  const calWeek = calendarWeek(plan, now)
  return {
    oppositionId: plan.profileId, oppositionVersion: plan.profileVersion, name: plan.profile.name, organism: profile.organism, convocatoria: plan.intake.convocatoria || profile.convocatoria?.title || null,
    sourceDate: profile.source?.date || null, examDate: plan.examDate, monthsPlan: plan.months, weeksTotal: plan.weeksTotal, weeksLeft: weeksLeft(plan, now), calendarWeek: calWeek,
    phase: phaseAtWeek(plan.phases, Math.min(calWeek, plan.weeksTotal)), block: plan.blockIndex + 1, ambition: plan.ambition, category: cat,
    levelGlobal: plan.levels?.global?.level || null, levelEstimated: !!plan.levels?.global?.estimated, levelByCapacity: Object.fromEntries(Object.entries(plan.levels?.byCapacity || {}).map(([c, x]) => [c, x.level])),
    tests, weakPoints: weak, testResults: Object.fromEntries(tests.filter(x => x.mark != null).map(x => [x.id, x.mark])),
    officialThresholds: Object.fromEntries(tests.filter(x => x.minimum != null).map(x => [x.id, { minimum: x.minimum, target: x.target, unit: x.unit }])),
    adherence, lastEvaluation: last ? { at: last.at, weeksLeft: last.weeksLeft, overallPassed: last.overall.passed, average: last.overall.average } : null,
    nextEvaluationBlock: plan.blockIndex + 1, alerts: [...(plan.alerts || [])], restrictions: plan.intake.restrictions, status: plan.status,
    missingData: tests.filter(x => x.mark == null).map(x => x.id),
  }
}
