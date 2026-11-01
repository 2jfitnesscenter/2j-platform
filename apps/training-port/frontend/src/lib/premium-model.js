// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Premium Training Programs — the pure model. Shared byte for byte by the phone and the API (scripts/sync-premium-model.mjs): the phone
 * generates sessions and moves the cursor, the API validates what an admin or trainer saves and summarises a member's program for the Coach.
 *
 * A Premium program is NOT a static routine: it has a version, a cycle of weeks, per-lift Training Maxes (TM), a position in the cycle and an
 * end-of-cycle proposal. Its definition is DATA interpreted by one generic engine ("cycle"): no method is hardcoded by name anywhere. Adding a
 * program means adding a definition, never a branch.
 *
 * Definition (schema 1):
 *   { schema:1, cycleWeeks, referenceLabel?, lifts?:[{ key, exercise, group:'upper'|'lower' }], progression?:{ cycleEnd?:{ kind:'tm-increment', increments:{ upper:{kg,lb}, lower:{kg,lb} } } },
 *     weeks:[{ label?, phase?, sessions:[{ key, title, day?, blocks:[Block] }] }] }
 *   Block = { role, exercise | lift, sets:[{ pct, reps, amrap?, type? }]           // load = percentage of the lift's Training Max (+ `steps` planned increments)
 *                                | scheme:{ sets, reps | repsMin+repsMax, prog? }  // load chosen by the app's existing progression engine
 *                                | conditioning:{ min, speed? | sec? },            // cardio / timed work
 *             warmup?, rest?, steps?, note?, sg? }
 *
 * The member's side lives in S.premium = { v:1, active: Instance|null, history:[…] }. An Instance pins a SNAPSHOT of the definition, so a later
 * catalogue edit can never change a program already under way. Which sessions are done is DERIVED from S.workouts (w.premium.instanceId), exactly like
 * guided programs derive theirs: finishing on the phone, at the kiosk or after a sync all agree, and no finished workout is ever rewritten.
 */

export const SCHEMA = 1
export const STATUSES = ['draft', 'published', 'hidden', 'archived']
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const GOAL_TAGS = ['hypertrophy', 'strength', 'strength-muscle', 'recomposition', 'conditioning', 'health']
export const SOURCE_TYPES = ['established', 'principles', 'own']     // A: popular/established · B: built on training principles · C: 2J's own
export const METHOD_TYPES = ['percentage-wave', 'weekly-load', 'tiered', 'upper-lower', 'split', 'undulating', 'full-body', 'concurrent', 'conditioning', 'recomposition', 'opposition']
export const ROLES = ['main', 'supplemental', 'accessory', 'conditioning']
export const LEGAL_STATES = ['none', 'review']
export const PROGRESSION_MODELS = ['training-max-cycle', 'weekly-linear', 'double-progression', 'linear', 'tiered', 'undulating', 'none']
export const MAX_WEEKS = 16
export const MAX_SESSIONS_PER_WEEK = 7
export const MAX_BLOCKS = 14

const clone = x => JSON.parse(JSON.stringify(x))
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

/* ------------------------------------------------------------------------------------------------ definition */
export function sessionsOf(def) {
  return (def?.weeks || []).flatMap((w, wi) => (w.sessions || []).map((s, si) => ({ ...s, week: wi + 1, index: si, phase: w.phase || null, weekLabel: w.label || null })))
}
export const keyOf = (cycle, week, index) => `${cycle}:${week}:${index}`
export const liftOf = (def, key) => (def?.lifts || []).find(l => l.key === key) || null
const unitKey = unit => (unit === 'lb' ? 'lb' : 'kg')

/** Structure + references. `ctx.exerciseExists(id)` and `ctx.preferred(id)` (the non-deprecated id) are optional hooks for the library. */
export function validateDefinition(def, ctx = {}) {
  const issues = []
  const add = (code, at) => issues.push(at ? `${code}:${at}` : code)
  if (!isObj(def)) return ['definition']
  if (def.schema !== SCHEMA) add('schema')
  if (!int(def.cycleWeeks, 1, MAX_WEEKS)) add('cycle-weeks')
  if (!Array.isArray(def.weeks) || def.weeks.length !== def.cycleWeeks) add('weeks-count')
  const lifts = Array.isArray(def.lifts) ? def.lifts : []
  const liftKeys = new Set()
  for (const l of lifts) {
    if (!isObj(l) || !/^[a-z0-9-]{2,24}$/.test(l.key || '') || liftKeys.has(l.key)) { add('lift-key', l?.key); continue }
    liftKeys.add(l.key)
    if (!['upper', 'lower'].includes(l.group)) add('lift-group', l.key)
    if (!l.exercise || (ctx.exerciseExists && !ctx.exerciseExists(l.exercise))) add('lift-exercise', l.key)
    else if (ctx.preferred && ctx.preferred(l.exercise) !== l.exercise) add('lift-deprecated', l.key)
  }
  const ce = def.progression?.cycleEnd
  if (ce) {
    if (ce.kind !== 'tm-increment' || !isObj(ce.increments)) add('cycle-end')
    else for (const g of ['upper', 'lower']) if (!(ce.increments[g]?.kg > 0) || !(ce.increments[g]?.lb > 0)) add('increment', g)
    if (!lifts.length) add('cycle-end-without-lifts')
  }
  for (const [wi, week] of (def.weeks || []).entries()) {
    const sessions = Array.isArray(week?.sessions) ? week.sessions : []
    if (!sessions.length || sessions.length > MAX_SESSIONS_PER_WEEK) add('sessions', String(wi + 1))
    const keys = new Set()
    for (const [si, s] of sessions.entries()) {
      const at = `${wi + 1}.${si}`
      if (!/^[a-z0-9-]{2,32}$/.test(s?.key || '') || keys.has(s.key)) add('session-key', at)
      keys.add(s?.key)
      if (!s?.title) add('session-title', at)
      const blocks = Array.isArray(s?.blocks) ? s.blocks : []
      if (!blocks.length || blocks.length > MAX_BLOCKS) add('blocks', at)
      for (const [bi, b] of blocks.entries()) {
        const bat = `${at}.${bi}`
        const modes = ['sets', 'scheme', 'conditioning'].filter(k => b?.[k] != null)
        if (modes.length !== 1) { add('block-mode', bat); continue }
        if (!ROLES.includes(b.role)) add('block-role', bat)
        const exId = b.lift ? liftOf(def, b.lift)?.exercise : b.exercise
        if (b.lift && !liftKeys.has(b.lift)) add('block-lift', bat)
        if (!exId) add('block-exercise', bat)
        else if (ctx.exerciseExists && !ctx.exerciseExists(exId)) add('block-exercise', bat)
        else if (ctx.preferred && ctx.preferred(exId) !== exId) add('block-deprecated', bat)
        if (b.sets) {
          if (!b.lift) add('sets-need-lift', bat)
          if (!Array.isArray(b.sets) || !b.sets.length || b.sets.length > 20) add('sets', bat)
          else for (const x of b.sets) if (!(x?.pct >= 0.1 && x.pct <= 1.2) || !int(x.reps, 1, 50)) add('set-spec', bat)
          if (b.steps != null && !(Number.isFinite(b.steps) && b.steps >= 0 && b.steps <= 30)) add('steps', bat)
        }
        if (b.scheme) {
          const s2 = b.scheme
          if (!int(s2.sets, 1, 12)) add('scheme-sets', bat)
          const fixed = int(s2.reps, 1, 60), range = int(s2.repsMin, 1, 60) && int(s2.repsMax, 1, 60) && s2.repsMin <= s2.repsMax
          if (!fixed && !range) add('scheme-reps', bat)
          if (s2.prog && !['off', 'linear', 'greyskull', 'double'].includes(s2.prog)) add('scheme-prog', bat)
        }
        if (b.conditioning) {
          const c = b.conditioning
          if (!(c.min > 0 || c.sec > 0)) add('conditioning', bat)
        }
        if (b.rest != null && !int(b.rest, 0, 600)) add('rest', bat)
      }
    }
  }
  return [...new Set(issues)]
}

/** The cover of a program: a file shipped with the app (/premium/covers/…), an image uploaded through the app's media system (media:<id>) or an https URL. Nothing else. */
export const COVER_RE = /^(\/premium\/covers\/[a-z0-9][a-z0-9._-]{0,80}\.(jpe?g|png|webp|avif)|media:[A-Za-z0-9_-]{1,40}\.jpg|https:\/\/[^\s"'<>]{4,400})$/i

/** Editorial fields + definition. Returns the list of problems (empty = fine). */
export function validateProgram(p, ctx = {}) {
  const issues = []
  if (!isObj(p)) return ['program']
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(p.id || '')) issues.push('id')
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(p.slug || '')) issues.push('slug')
  if (!String(p.name || '').trim()) issues.push('name')
  if (!String(p.shortDescription || '').trim()) issues.push('short-description')
  if (!String(p.longDescription || '').trim()) issues.push('long-description')
  if (!Array.isArray(p.goalTags) || !p.goalTags.length || p.goalTags.some(g => !GOAL_TAGS.includes(g))) issues.push('goal-tags')
  if (!LEVELS.includes(p.level)) issues.push('level')
  if (!int(p.daysPerWeek, 1, 7)) issues.push('days-per-week')
  if (!String(p.durationDescription || '').trim()) issues.push('duration')
  if (!METHOD_TYPES.includes(p.methodType)) issues.push('method-type')
  if (!SOURCE_TYPES.includes(p.sourceType)) issues.push('source-type')
  if (!String(p.evidenceSummary || '').trim()) issues.push('evidence-summary')
  if (!Array.isArray(p.equipmentRequirements)) issues.push('equipment')
  if (!PROGRESSION_MODELS.includes(p.progressionModel)) issues.push('progression-model')
  if (!int(p.version, 1, 10000)) issues.push('version')
  if (!STATUSES.includes(p.status)) issues.push('status')
  if (p.legal && !LEGAL_STATES.includes(p.legal.status)) issues.push('legal')
  if (p.coverImage) {
    if (!COVER_RE.test(p.coverImage)) issues.push('cover-image')
    else if (!String(p.coverImageAlt || '').trim()) issues.push('cover-alt')
  }
  const def = validateDefinition(p.programDefinition, ctx).map(i => `definition.${i}`)
  issues.push(...def)
  if (!def.length) {
    const perWeek = Math.max(...p.programDefinition.weeks.map(w => w.sessions.length))
    if (perWeek !== p.daysPerWeek) issues.push('days-mismatch')
  }
  return [...new Set(issues)]
}

/* ------------------------------------------------------------------------------------------------ instance */
export const PREMIUM_DEFAULT = () => ({ v: 1, active: null, history: [] })

/** A new run of a program. The definition is pinned (snapshot), so a later edit of the catalogue cannot alter it. */
export function newInstance(program, { id, now = Date.now(), tm = {}, unit = 'kg' } = {}) {
  const def = clone(program.programDefinition)
  const lifts = Object.fromEntries((def.lifts || []).map(l => [l.key, Number(tm[l.key]) > 0 ? Number(tm[l.key]) : null]))
  return {
    id: id || `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    programId: program.id, programVersion: program.version, slug: program.slug, name: program.name,
    startedAt: now, status: 'active', pausedAt: null, pausedMs: 0, cycle: 1,
    methodState: { unit: unitKey(unit), tm: lifts },
    skipped: [], adaptations: [], pending: null,
    snapshot: { name: program.name, slug: program.slug, version: program.version, level: program.level, daysPerWeek: program.daysPerWeek, goalTags: program.goalTags, definition: def,
      ...(program.coverImage ? { coverImage: program.coverImage, coverImageAlt: program.coverImageAlt || '', ...(program.coverFocalPoint ? { coverFocalPoint: program.coverFocalPoint } : {}) } : {}) },
  }
}

const premiumOrigin = w => (isObj(w?.premium) ? w.premium : null)
const doneKeys = (inst, workouts = []) => new Set((workouts || []).map(premiumOrigin).filter(o => o && o.instanceId === inst.id && o.cycle === inst.cycle).map(o => keyOf(o.cycle, o.week, o.index)))

export function positionOf(inst, workouts = []) {
  const def = inst.snapshot.definition
  const flat = sessionsOf(def)
  const done = doneKeys(inst, workouts)
  const skipped = new Set(inst.skipped || [])
  const keyFor = s => keyOf(inst.cycle, s.week, s.index)
  const finished = flat.filter(s => done.has(keyFor(s)) || skipped.has(keyFor(s)))
  const current = flat.find(s => !done.has(keyFor(s)) && !skipped.has(keyFor(s))) || null
  const week = current ? current.week : def.cycleWeeks
  return {
    cycle: inst.cycle, week, weeks: def.cycleWeeks, index: current?.index ?? null, session: current, key: current ? keyFor(current) : null,
    phase: current?.phase || def.weeks[week - 1]?.phase || null,
    completedInCycle: flat.filter(s => done.has(keyFor(s))).length, skippedInCycle: flat.filter(s => skipped.has(keyFor(s))).length,
    totalInCycle: flat.length, cycleComplete: !current, doneKeys: done, finished: finished.length,
  }
}

export function incrementFor(inst, lift) {
  const inc = inst.snapshot.definition.progression?.cycleEnd?.increments?.[lift.group]
  return inc ? inc[unitKey(inst.methodState.unit)] : 0
}

/** What a finished cycle proposes (never applied by itself): each lift's TM goes up by its group's increment. null when the method has no such rule or the cycle is not over. */
export function proposalFor(inst, workouts = []) {
  const def = inst.snapshot.definition
  const rule = def.progression?.cycleEnd
  const pos = positionOf(inst, workouts)
  if (!pos.cycleComplete) return null
  const proposals = {}
  if (rule?.kind === 'tm-increment') {
    for (const l of def.lifts || []) {
      const from = inst.methodState.tm[l.key]
      if (!(from > 0)) continue
      const inc = incrementFor(inst, l)
      proposals[l.key] = { from, to: Math.round((from + inc) * 100) / 100, inc }
    }
  }
  return { cycle: inst.cycle, proposals, hasRule: !!rule }
}

/** Starts the next cycle. `accept` applies the proposed TMs (or the member's own `overrides`); otherwise the TMs stay. Pure: returns a new instance. */
export function advanceCycle(inst, workouts = [], { accept = true, overrides = {}, now = Date.now() } = {}) {
  const pos = positionOf(inst, workouts)
  if (!pos.cycleComplete) return inst
  const prop = proposalFor(inst, workouts)
  const next = clone(inst)
  const changes = {}
  for (const [key, p] of Object.entries(prop?.proposals || {})) {
    const to = Number(overrides[key]) > 0 ? Number(overrides[key]) : accept ? p.to : p.from
    if (to !== p.from) changes[key] = { from: p.from, to }
    next.methodState.tm[key] = to
  }
  next.cycle = inst.cycle + 1
  next.adaptations = [...(inst.adaptations || []), { at: now, kind: 'cycle-advance', cycle: inst.cycle, accepted: !!accept, changes }]
  return next
}

/** Member-chosen change of one Training Max (a recorded adaptation; finished workouts are never touched). */
export function setTrainingMax(inst, liftKey, value, { now = Date.now(), by = 'member' } = {}) {
  const lift = liftOf(inst.snapshot.definition, liftKey)
  const v = Number(value)
  if (!lift || !(v > 0) || v > 1000) return inst
  const next = clone(inst)
  const from = next.methodState.tm[liftKey] ?? null
  next.methodState.tm[liftKey] = Math.round(v * 100) / 100
  next.adaptations = [...(next.adaptations || []), { at: now, kind: 'tm-set', lift: liftKey, from, to: next.methodState.tm[liftKey], by }]
  return next
}

export const skipSession = (inst, workouts = [], now = Date.now()) => {
  const pos = positionOf(inst, workouts)
  if (!pos.session) return inst
  const next = clone(inst)
  next.skipped = [...(next.skipped || []), pos.key]
  next.adaptations = [...(next.adaptations || []), { at: now, kind: 'skip', key: pos.key }]
  return next
}
export const pauseInstance = (inst, now = Date.now()) => (inst.status === 'active' ? { ...clone(inst), status: 'paused', pausedAt: now } : inst)
export const resumeInstance = (inst, now = Date.now()) => (inst.status === 'paused' ? { ...clone(inst), status: 'active', pausedAt: null, pausedMs: (inst.pausedMs || 0) + Math.max(0, now - (inst.pausedAt || now)) } : inst)

/** The record kept when an instance ends (finished, replaced…): small, with no definition. */
export function historyEntry(inst, workouts = [], { reason = 'finished', now = Date.now() } = {}) {
  const mine = (workouts || []).map(premiumOrigin).filter(o => o && o.instanceId === inst.id)
  return { instanceId: inst.id, programId: inst.programId, programVersion: inst.programVersion, name: inst.name, startedAt: inst.startedAt, endedAt: now, reason, cycles: inst.cycle, sessions: mine.length, tm: clone(inst.methodState.tm) }
}

/* ------------------------------------------------------------------------------------------------ sessions */
const roundTo = (w, step) => (step > 0 ? Math.round(Math.round((w / step)) * step * 100) / 100 : w)
const stepFor = (unit, block) => (Number(block?.round) > 0 ? Number(block.round) : unitKey(unit) === 'lb' ? 5 : 2.5)

/** The lifts that still need a Training Max before the program can start. */
export const missingTrainingMax = inst => (inst.snapshot.definition.lifts || []).filter(l => !(inst.methodState.tm[l.key] > 0)).map(l => l.key)

/** The prescription of the session the cursor is on, as plain data: `fixed` blocks (loads decided here) and `cfg` blocks (loads decided by the app's progression engine). */
export function planSession(inst, workouts = []) {
  const pos = positionOf(inst, workouts)
  if (!pos.session) return null
  const def = inst.snapshot.definition
  const unit = unitKey(inst.methodState.unit)
  const blocks = pos.session.blocks.map(b => {
    const lift = b.lift ? liftOf(def, b.lift) : null
    const exercise = lift ? lift.exercise : b.exercise
    if (b.sets) {
      const tm = inst.methodState.tm[lift.key]
      if (!(tm > 0)) return { kind: 'blocked', exercise, role: b.role, lift: lift.key }
      const base = tm + (b.steps || 0) * incrementFor(inst, lift)
      const step = stepFor(unit, b)
      const sets = b.sets.map(x => ({ w: roundTo(base * x.pct, step), r: x.reps, ...(x.amrap ? { amrap: true } : {}), ...(x.type ? { type: x.type } : {}), pct: x.pct }))
      const scheme = b.sets.map(x => `${Math.round(x.pct * 100)}% × ${x.reps}${x.amrap ? '+' : ''}`).join(' · ')
      return { kind: 'fixed', exercise, role: b.role, lift: lift.key, rest: b.rest || null, sets, warmup: b.warmup !== false, tm: base, why: ['{0} — {1} of your Training Max ({2} {3}).', pos.phase || pos.session.title, scheme, base, unit], note: b.note || null }
    }
    if (b.scheme) {
      const s2 = b.scheme
      return { kind: 'cfg', exercise, role: b.role, rest: b.rest || null, note: b.note || null,
        cfg: { id: exercise, sets: s2.sets, reps: s2.reps || s2.repsMax, ...(s2.repsMin ? { targetRepsMin: s2.repsMin, targetRepsMax: s2.repsMax } : {}), mode: 'reps', prog: s2.prog || (s2.repsMin ? 'double' : 'linear'), ...(b.rest ? { rest: b.rest } : {}), ...(b.note ? { note: b.note } : {}), ...(b.sg ? { sg: b.sg } : {}) } }
    }
    return { kind: 'conditioning', exercise, role: b.role, rest: b.rest || null, note: b.note || null, conditioning: clone(b.conditioning) }
  })
  return { key: pos.key, cycle: pos.cycle, week: pos.week, weeks: pos.weeks, index: pos.index, phase: pos.phase, title: pos.session.title, sessionKey: pos.session.key, blocks, blocked: blocks.filter(b => b.kind === 'blocked').map(b => b.lift) }
}

/** What a finished workout remembers about where it came from (w.premium, carried by the same finish payload as w.src2j). */
export const originOf = (inst, plan) => ({ instanceId: inst.id, programId: inst.programId, version: inst.programVersion, cycle: plan.cycle, week: plan.week, index: plan.index, session: plan.sessionKey, phase: plan.phase || null })

/* ------------------------------------------------------------------------------------------------ progress + summaries */
export function progressOf(inst, workouts = []) {
  const p = positionOf(inst, workouts)
  const total = p.totalInCycle
  const finished = p.completedInCycle + p.skippedInCycle
  return { percent: total ? Math.round(finished * 100 / total) : 0, cycle: p.cycle, week: p.week, weeks: p.weeks, completedInCycle: p.completedInCycle, totalInCycle: total, cycleComplete: p.cycleComplete, phase: p.phase }
}

const DAY = 86400000
/** Sessions expected by `now` (the active time only: pauses do not count) against sessions done since the start. */
export function adherenceOf(inst, workouts = [], now = Date.now()) {
  const paused = (inst.pausedMs || 0) + (inst.status === 'paused' && inst.pausedAt ? Math.max(0, now - inst.pausedAt) : 0)
  const days = Math.max(0, (now - inst.startedAt - paused) / DAY)
  const perWeek = inst.snapshot.daysPerWeek
  const expected = Math.floor(days / 7 * perWeek)
  const done = (workouts || []).map(premiumOrigin).filter(o => o && o.instanceId === inst.id).length
  return { done, expected, pct: expected > 0 ? Math.min(100, Math.round(done * 100 / expected)) : null }
}

/** The compact view the staff and the Coach get: no personal data, no workout contents beyond the AMRAP outcomes the method itself is built on. */
export function summarize(inst, workouts = [], now = Date.now()) {
  if (!inst) return null
  const pos = positionOf(inst, workouts)
  const def = inst.snapshot.definition
  const mine = (workouts || []).filter(w => premiumOrigin(w)?.instanceId === inst.id)
  const amrap = []
  for (const w of mine.slice(-12)) for (const e of w.entries || []) for (const s of e.sets || []) if (s?.amrap && s.done && s.r > 0) amrap.push({ exercise: e.id, w: s.w || 0, reps: s.r, d: w.d })
  const incidents = []
  if (inst.status === 'paused') incidents.push('paused')
  if ((inst.skipped || []).length) incidents.push('skipped')
  if (pos.cycleComplete) incidents.push('cycle-complete')
  if (missingTrainingMax(inst).length) incidents.push('missing-training-max')
  const adh = adherenceOf(inst, workouts, now)
  return {
    programId: inst.programId, version: inst.programVersion, name: inst.name, status: inst.status,
    phase: pos.phase, cycle: pos.cycle, week: pos.week, weeks: pos.weeks, session: pos.session?.key || null,
    label: `${inst.name} · C${pos.cycle} · W${pos.week}/${pos.weeks}`,
    completedInCycle: pos.completedInCycle, totalInCycle: pos.totalInCycle, adherence: adh,
    methodState: { unit: inst.methodState.unit, trainingMax: Object.fromEntries((def.lifts || []).map(l => [l.key, inst.methodState.tm[l.key] ?? null])) },
    lastAmrap: amrap.slice(-4), adaptations: (inst.adaptations || []).length, incidents,
  }
}

/* ------------------------------------------------------------------------------------------------ input hygiene */
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n)
const fin = v => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : null)

function cleanBlock(b) {
  const out = { role: b?.role }
  if (b?.lift) out.lift = str(b.lift, 24); else if (b?.exercise) out.exercise = str(b.exercise, 12)
  if (Array.isArray(b?.sets)) out.sets = b.sets.slice(0, 20).map(x => ({ pct: fin(x?.pct), reps: fin(x?.reps), ...(x?.amrap ? { amrap: true } : {}), ...(x?.type === 'warmup' ? { type: 'warmup' } : {}) }))
  if (isObj(b?.scheme)) out.scheme = { sets: fin(b.scheme.sets), ...(b.scheme.reps != null ? { reps: fin(b.scheme.reps) } : {}), ...(b.scheme.repsMin != null ? { repsMin: fin(b.scheme.repsMin), repsMax: fin(b.scheme.repsMax) } : {}), ...(b.scheme.prog ? { prog: str(b.scheme.prog, 12) } : {}) }
  if (isObj(b?.conditioning)) out.conditioning = { ...(b.conditioning.min != null ? { min: fin(b.conditioning.min) } : {}), ...(b.conditioning.sec != null ? { sec: fin(b.conditioning.sec) } : {}), ...(b.conditioning.speed != null ? { speed: fin(b.conditioning.speed) } : {}) }
  if (b?.warmup === false) out.warmup = false
  if (b?.rest != null) out.rest = fin(b.rest)
  if (b?.steps != null) out.steps = fin(b.steps)
  if (b?.note) out.note = str(b.note, 200)
  if (b?.sg) out.sg = str(b.sg, 8)   // superset group: consecutive blocks with the same value are done as a superset
  return out
}

/** Rebuilds a definition from the known fields only (unknown keys, oversized strings and over-long lists are dropped). It does not make an invalid definition valid: validate afterwards. */
export function sanitizeDefinition(def) {
  if (!isObj(def)) return null
  const out = { schema: def.schema, cycleWeeks: fin(def.cycleWeeks) }
  if (def.referenceLabel) out.referenceLabel = str(def.referenceLabel, 40)
  if (Array.isArray(def.lifts)) out.lifts = def.lifts.slice(0, 12).map(l => ({ key: str(l?.key, 24), exercise: str(l?.exercise, 12), group: l?.group }))
  const ce = def.progression?.cycleEnd
  if (isObj(ce)) out.progression = { cycleEnd: { kind: ce.kind, increments: Object.fromEntries(['upper', 'lower'].filter(g => isObj(ce.increments?.[g])).map(g => [g, { kg: fin(ce.increments[g].kg), lb: fin(ce.increments[g].lb) }])) } }
  out.weeks = (Array.isArray(def.weeks) ? def.weeks : []).slice(0, MAX_WEEKS).map(w => ({
    ...(w?.label ? { label: str(w.label, 60) } : {}), ...(w?.phase ? { phase: str(w.phase, 60) } : {}),
    sessions: (Array.isArray(w?.sessions) ? w.sessions : []).slice(0, MAX_SESSIONS_PER_WEEK).map(s => ({ key: str(s?.key, 32), title: str(s?.title, 80), blocks: (Array.isArray(s?.blocks) ? s.blocks : []).slice(0, MAX_BLOCKS).map(cleanBlock) })),
  }))
  return out
}

const list = (v, n, len) => (Array.isArray(v) ? v.slice(0, n).map(x => str(x, len)).filter(Boolean) : [])
/** The editorial part of a program from untrusted input (system fields — id, version, status, authorship — are never read from here). */
export function sanitizeEditorial(input) {
  const i = isObj(input) ? input : {}
  const copy = isObj(i.copy) ? i.copy : {}
  return {
    slug: str(i.slug, 48).toLowerCase(), name: str(i.name, 80), shortDescription: str(i.shortDescription, 280), longDescription: str(i.longDescription, 2400),
    goalTags: list(i.goalTags, 6, 24), level: str(i.level, 16), daysPerWeek: fin(i.daysPerWeek), durationDescription: str(i.durationDescription, 80),
    methodType: str(i.methodType, 32), sourceType: str(i.sourceType, 16),
    author: isObj(i.author) ? { name: str(i.author.name, 120), ...(i.author.work ? { work: str(i.author.work, 120) } : {}) } : null,
    evidenceSummary: str(i.evidenceSummary, 900), equipmentRequirements: list(i.equipmentRequirements, 10, 40), progressionModel: str(i.progressionModel, 32),
    copy: { howItWorks: list(copy.howItWorks, 6, 240), forWhom: list(copy.forWhom, 6, 240), notIdealIf: list(copy.notIdealIf, 6, 240), tracking: list(copy.tracking, 6, 240) },
    legal: isObj(i.legal) ? { status: LEGAL_STATES.includes(i.legal.status) ? i.legal.status : 'none', note: str(i.legal.note, 400) } : { status: 'none', note: '' },
    programDefinition: sanitizeDefinition(i.programDefinition),
    ...sanitizeCover(i),
  }
}

/** Cover metadata (cosmetic: it never creates a version). Source/licence/attribution travel with the image. */
export function sanitizeCover(i) {
  const img = str(i?.coverImage, 420)
  const f = isObj(i?.coverFocalPoint) ? { x: Math.min(100, Math.max(0, fin(i.coverFocalPoint.x) ?? 50)), y: Math.min(100, Math.max(0, fin(i.coverFocalPoint.y) ?? 50)) } : null
  return { coverImage: img, coverImageAlt: str(i?.coverImageAlt, 200), coverImageSource: str(i?.coverImageSource, 240), coverImageLicense: str(i?.coverImageLicense, 80), coverImageAttribution: str(i?.coverImageAttribution, 300), coverFocalPoint: f }
}
