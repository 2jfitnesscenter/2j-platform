// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Entrena con 2J" — the pure half of the guided-routine catalogue: search and filters, what the
// member already did (from workout history, no second list), a light deterministic "For you",
// and the snapshot a routine becomes when it is started or assigned. No model, no hidden data:
// only the goal/level/restrictions a trainer declared on the member's plan (or the member told the
// Coach), the member's own workouts and favourites. Health readings, weight, body fat, pain and
// check-ins are never used here.
import { gymRoutineCompatibility, activeGymProfile } from './gym-profiles.js'
import { validateAgainst2JProtocol, blockTypesOf, CATEGORY_LABEL, TAG_LABEL, TYPE_LABEL, FOCUS_LABEL, LEVEL_LABEL, GOAL_LABEL, LEVELS } from './protocol/index.js'

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const LOWER = new Set(['glutes', 'quads', 'hamstrings', 'calves', 'adductors', 'abductors'])
const CARDIO_EQ = new Set(['stationary bike', 'elliptical machine', 'stepmill machine', 'treadmill', 'skierg machine'])
const MACHINE_EQ = new Set(['leverage machine', 'sled machine', 'cable', 'smith machine', 'assisted'])

/** Kinds of material a routine needs, for the equipment filter and the card. */
export function gearKinds(r, lookup) {
  const kinds = new Set()
  for (const e of r.ex || []) {
    const x = lookup(e.id)
    if (!x) continue
    const eq = x.eq
    if (CARDIO_EQ.has(eq) || (x.bp === 'cardio' && eq !== 'body weight')) kinds.add('cardio')
    else if (MACHINE_EQ.has(eq)) kinds.add('machines')
    else if (eq === 'dumbbell') kinds.add('dumbbells')
    else if (eq === 'barbell' || eq === 'ez barbell' || eq === 'weighted') kinds.add('free weights')
  }
  return kinds.size ? [...kinds] : ['none']
}
export const GEAR_LABEL = { none: 'No equipment', machines: 'Machines', dumbbells: 'Dumbbells', cardio: 'Cardio machines', 'free weights': 'Free weights' }

export const DURATIONS = { lt15: [0, 14], '15-30': [15, 30], gt30: [31, 999] }

/**
 * @param f { q, category (string|array), duration ('lt15'|'15-30'|'gt30'), level, gear, favorites (Set), onlyFavorites }
 * `t` translates labels so a Spanish search ("sin saltos", "movilidad cadera", "20 minutos")
 * matches the same metadata the card shows.
 */
export function filterRoutines(list, f = {}, { t = s => s, lookup = () => null } = {}) {
  const words = norm(f.q).split(/\s+/).filter(Boolean)
  const cats = f.category ? [].concat(f.category) : null
  return list.filter(r => {
    if (r.active === false && !f.includeInactive) return false
    if (cats && !cats.includes(r.category)) return false
    if (f.level && r.level !== f.level) return false
    if (f.duration) { const [lo, hi] = DURATIONS[f.duration] || [0, 999]; if (r.estimatedMinutes < lo || r.estimatedMinutes > hi) return false }
    if (f.gear && !gearKinds(r, lookup).includes(f.gear)) return false
    if (f.goal && r.goal !== f.goal) return false
    if (f.onlyFavorites && !(f.favorites && f.favorites.has(r.id))) return false
    if (words.length) {
      const hay = norm([t(r.name), t(r.subtitle || ''), t(r.description || ''), t(CATEGORY_LABEL[r.category] || ''), r.category,
        t(LEVEL_LABEL[r.level] || ''), t(GOAL_LABEL[r.goal] || ''), t(FOCUS_LABEL[r.focus] || r.focus || ''),
        ...(r.tags || []).map(k => t(TAG_LABEL[k] || k)), ...gearKinds(r, lookup).map(k => t(GEAR_LABEL[k])),
        ...(r.equipment || []).map(q => t(q)), ...(r.ex || []).map(e => lookup(e.id)?.n || ''), `${r.estimatedMinutes} min`].join(' '))
      for (const w of words) {
        const m = w.match(/^(\d+)(min|minutos|minutes)?$/)
        if (m) { if (Math.abs(r.estimatedMinutes - Number(m[1])) > 5) return false; continue }
        if (['min', 'minutos', 'minutes', 'de', 'y', 'con', 'sin', 'the', 'and', 'with'].includes(w) && !hay.includes(w + ' ')) continue
        if (!hay.includes(w)) return false
      }
    }
    return true
  })
}

/** Per official routine: how many times it was finished, and when last — read from S.workouts. */
export function historyStats(workouts = []) {
  const out = {}
  for (const w of workouts) {
    const id = w?.src2j?.id
    if (!id) continue
    const o = out[id] || (out[id] = { count: 0, last: null })
    o.count++
    if (!o.last || w.d > o.last) o.last = w.d
  }
  return out
}
/** The member's official routines done recently, newest first (for "Again?" / "Recent"). */
export function recentRoutines(workouts = [], byId = {}, max = 8) {
  const seen = new Set(), out = []
  for (const w of [...workouts].sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))) {
    const id = w?.src2j?.id
    if (!id || seen.has(id) || !byId[id]) continue
    seen.add(id); out.push({ routine: byId[id], d: w.d })
    if (out.length >= max) break
  }
  return out
}

// The Coach's intake goals, mapped like api/coach/protocol-gate.js GOAL_MAP.
const COACH_GOAL = { hypertrophy: 'hypertrophy', strength: 'strength', toning: 'general', fatloss: 'general', longevity: 'general', padel: 'general',
  basketball: 'general', examfitness: 'general', power: 'power', plyometrics: 'power', general: 'general', endurance: 'endurance', beginner: 'beginner' }

/** Context the member (or their trainer) actually declared — nothing inferred. */
export function memberContext(S = {}) {
  const prog = (S.programs || []).find(p => p.id === S.activeProgramId)
  const planMeta = prog?.meta || (S.routines || []).find(r => r.meta)?.meta || null
  const profile = S.coach?.profile || null
  const level = LEVELS.includes(planMeta?.level) ? planMeta.level
    : ['new', 'returning'].includes(profile?.experience) ? 'beginner' : null
  const goal = planMeta?.goal || COACH_GOAL[profile?.goal] || null
  const restrictions = [...new Set([...(S.programs || []), ...(S.routines || [])].flatMap(x => x?.meta?.restrictions || []))]
  return { level, goal, restrictions }
}

/** Does this routine break a restriction declared for the member? (the validator decides) */
export function restrictionIssues(r, restrictions, lookup) {
  if (!restrictions?.length) return []
  const v = validateAgainst2JProtocol({ kind: 'routine', goal: r.goal, level: r.level, entries: r.ex || [], blockTypes: blockTypesOf(r.blocks) }, { lookup, restrictions })
  return v.issues.filter(i => i.code === 'restriction')
}

// Which formats sit well with each goal — complements for strength goals, core work for the rest.
const GOAL_FIT = {
  hypertrophy: ['mobility', 'core', 'interval'], strength: ['mobility', 'core', 'interval'], power: ['mobility', 'core'],
  general: ['circuit', 'hiit', 'tabata', 'mobility', 'mixed', 'core'], endurance: ['interval', 'circuit', 'hiit', 'tabata'],
  beginner: ['circuit', 'mobility', 'interval', 'core'],
}
const LEVEL_OK = { beginner: ['beginner'], intermediate: ['beginner', 'intermediate'], advanced: ['beginner', 'intermediate', 'advanced'] }

function lowerDayRecently(workouts, lookup, now) {
  const last = [...workouts].sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))[0]
  if (!last || now - (last.end || last.start || 0) > 36 * 3600e3) return false
  let lower = 0, all = 0
  for (const e of last.entries || []) {
    const n = (e.sets || []).filter(s => s.done).length
    const tg = lookup(e.id)?.tg
    all += n
    if (tg && LOWER.has(tg)) lower += n
  }
  return all > 0 && lower / all >= 0.5
}

/**
 * "For you": a short, explainable list, or nothing when there is no declared context and no
 * history to go on. Reasons are only the ones that really applied ("For your beginner level",
 * "Fits your goal", "No jumps", "15 min") — never "the algorithm thinks".
 * @returns [{ routine, reasons: [[key, ...params]] }]
 */
export function forYou(routines, S, { lookup = () => null, now = Date.now(), max = 6 } = {}) {
  const ctx = memberContext(S)
  const hist = historyStats(S.workouts || [])
  // Two more signals, both from the member's own state: the favourites they chose, and the gym they train at (a routine that needs
  // equipment the active place does not have is not offered; a home or hotel profile says so on the ones that fit it).
  const favIds = new Set(Array.isArray(S.favRoutines) ? S.favRoutines : [])
  const gym = activeGymProfile(S)
  const customGym = gym && gym.type !== 'official'
  const favCategories = new Set(routines.filter(r => favIds.has(r.id)).map(r => r.category))
  if (!ctx.level && !ctx.goal && !ctx.restrictions.length && !Object.keys(hist).length && !favIds.size && !customGym) return []
  const skipLower = lowerDayRecently(S.workouts || [], lookup, now)
  const recent = new Set(Object.entries(hist).filter(([, h]) => h.last && (now - new Date(h.last + 'T12:00:00').getTime()) < 3 * 86400e3).map(([id]) => id))
  const goalFit = GOAL_FIT[ctx.goal] || null
  const scored = []
  for (const r of routines) {
    if (r.active === false) continue
    if (ctx.level && !LEVEL_OK[ctx.level].includes(r.level)) continue
    if (restrictionIssues(r, ctx.restrictions, lookup).length) continue
    if (skipLower && r.focus === 'lower' && ['tabata', 'hiit', 'circuit'].includes(r.category)) continue
    if (recent.has(r.id)) continue
    const fit = gymRoutineCompatibility(S, r)
    if (fit.level === 'requires') continue
    const reasons = []
    const own = []                       // why from the member's own choices; listed after the level and the goal
    let score = 0
    if (customGym && fit.compatible) { score += 1; own.push(['Works at {0}', gym.name]) }
    if (favIds.has(r.id)) { score += 1.5; own.push(['In your favorites']) }
    else if (favCategories.has(r.category)) { score += 1; own.push(['Like your favorites']) }
    if (ctx.level && r.level === ctx.level) { score += 2; reasons.push(['For your {0} level', LEVEL_LABEL[ctx.level]]) }
    if (goalFit && goalFit.includes(r.category)) { score += 2 + (goalFit.length - goalFit.indexOf(r.category)) / 10; reasons.push(['Fits your goal']) }
    if (ctx.restrictions.includes('no-jumps') && (r.tags || []).includes('no-jumps')) reasons.push(['No jumps'])
    reasons.push(...own)
    if (!reasons.length) continue
    reasons.push(['{0} min', r.estimatedMinutes])
    scored.push({ routine: r, reasons, score })
  }
  // One per category first, so the row is varied; ties go to editorial picks, then shorter.
  scored.sort((a, b) => b.score - a.score || (a.routine.featured || 99) - (b.routine.featured || 99) || a.routine.estimatedMinutes - b.routine.estimatedMinutes)
  const out = [], cats = new Set()
  for (const s of scored) if (!cats.has(s.routine.category)) { out.push(s); cats.add(s.routine.category) }
  for (const s of scored) if (out.length < max && !out.includes(s)) out.push(s)
  return out.slice(0, max)
}

/** A routine is "new" only if it was published after the catalogue launched, within 30 days. */
export function isNew(r, all, now = Date.now()) {
  const launch = all.filter(x => x.official && x.publishedAt).map(x => x.publishedAt).sort()[0]
  if (!r.publishedAt || !launch || r.publishedAt <= launch) return false
  return now - new Date(r.publishedAt + 'T12:00:00').getTime() < 30 * 86400e3
}

/** How a part of a routine reads: "Warm-up", "Tabata · Full body", "Cool-down". */
export function partName(b, t = s => s) {
  if (b.role === 'warmup') return t('Warm-up')
  if (b.role === 'cooldown') return t('Cool-down')
  const kind = b.timing?.preset === 'tabata' ? 'Tabata' : TYPE_LABEL[b.type] || b.type
  return b.focus ? `${t(kind)} · ${t(FOCUS_LABEL[b.focus] || b.focus)}` : t(kind)
}

/** The routine as a plain, independent copy — what a session starts from or a member receives. */
export function routineSnapshot(r, t = s => s) {
  const clone = x => JSON.parse(JSON.stringify(x))
  return {
    id: null, name: t(r.name), emoji: CATEGORY_GLYPH[r.category] || 'bolt',
    ex: clone(r.ex || []),
    blocks: (r.blocks || []).map(b => ({ ...clone(b), name: partName(b, t) })),
    meta: { goal: r.goal, level: r.level, restrictions: [], v: r.protocolVersion || '1.0' },
  }
}
/**
 * Saves an official routine into the member's own routines: an independent copy (the same snapshot a session starts from or a trainer
 * assigns), with a small `from2j` note of where and when it came from. Nothing links back to the master, so a later edit of the
 * official routine never changes it. The same official routine is never saved twice (the existing copy is returned).
 */
export function saveOfficialRoutine(S, r, { t = x => x, makeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, now = Date.now(), rev = null } = {}) {
  if (!r || !Array.isArray(r.ex) || !r.ex.length) return { ok: false, reason: 'invalid-routine' }
  const existing = (S.routines || []).find(x => x.from2j?.id === r.id)
  if (existing) return { ok: false, reason: 'already-saved', routine: existing }
  const routine = { ...routineSnapshot(r, t), id: makeId(), from2j: { id: r.id, v: r.seedVersion || null, ...(rev != null ? { rev: String(rev) } : {}), at: now } }
  S.routines = [...(S.routines || []), routine]
  return { ok: true, routine }
}
export const CATEGORY_GLYPH = { tabata: 'bolt', hiit: 'flame', circuit: 'intervals', interval: 'bike', mobility: 'stretch', core: 'abs', mixed: 'dumbbell' }
