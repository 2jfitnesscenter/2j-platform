// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// validateAgainst2JProtocol — the deterministic gate every structured training proposal passes
// through: official and personal blocks, routines from the builder, and anything a model
// generates or changes. Same code on the server (api/lib/protocol/, generated copy).
//
// Result: PASS            nothing to say ('unverified' issues may still be listed: judgements the
//                         validator could not make with confidence — shown, never blocking)
//         PASS_WITH_REASON allowed, but a deliberate choice outside the preferred zone — shown
//                         with its reason (the one given, or a sensible default)
//         FAIL            incompatible with the goal/level/restrictions — never saved when it
//                         comes from a model or an official block; a trainer is told why.
// Every issue carries a code, params, the rule id and the evidence ids behind it.
import { PROTOCOL_VERSION, GOALS, LEVELS, RPE_2J, SETS, REST, BLOCK_SIZE, SESSION_EXERCISES, WEEKLY_SETS,
  RESTRICTION_FLAG, MESSAGES, DEFAULT_REASON, MESSAGE_RULE, RULE_BY_ID, BLOCK_TYPES_READY, ROUNDS, ROUND_TYPES, format } from './rules.js'
import { classify, redundancyKey } from './classify.js'
import { movementOfPattern, equipmentIdOf } from './movements.js'
import { repRange, unitsOf, roleOf, restDemand, zoneFor, estimateSeconds, roundMinutes, modeOfEntry, REST_DEFAULTS } from './prescribe.js'

const fmtRange = r => `${r[0]}-${r[1]}`
const outside = (lo, hi, r) => lo < r[0] || hi > r[1]

function makeIssue(severity, code, params, where, reasons) {
  const rule = MESSAGE_RULE[code] || null
  const key = where?.index != null ? `${code}@${where.day ?? 0}:${where.index}` : code
  const given = reasons?.[key] || reasons?.[code] || where?.why || null
  return {
    severity, code, params, where: where ? { day: where.day ?? null, index: where.index ?? null } : null,
    message: format(MESSAGES[code] || code, params), rule, evidence: rule ? RULE_BY_ID[rule]?.evidence || [] : [],
    reason: severity === 'reason' ? (given || DEFAULT_REASON[code] || null) : null, reasonGiven: !!given,
  }
}

/**
 * @param {object} target { kind:'block'|'routine'|'program', goal, level, type?, protocolVersion?,
 *                          entries? (block/routine), days? (program: array of entry arrays), reasons?,
 *                          blockTypes? ({ [instance id]: block type } — routine.blocks, so timed blocks
 *                          inside a day are judged as what they are) }
 * @param {object} ctx    { lookup(id)→{n,bp,tg,eq}|null, nameOf?(id), unavailableEq?, restrictions?, official? }
 */
export function validateAgainst2JProtocol(target, ctx = {}) {
  const goal = GOALS.includes(target.goal) ? target.goal : 'general'
  const level = LEVELS.includes(target.level) ? target.level : 'intermediate'
  const reasons = target.reasons || {}
  const lookup = ctx.lookup || (() => null)
  const nameOf = ctx.nameOf || (id => lookup(id)?.n || id)
  const unavailable = new Set(ctx.unavailableEq || [])
  const restrictions = (ctx.restrictions || []).filter(r => RESTRICTION_FLAG[r])
  const issues = []
  const add = (sev, code, params = [], where = null) => issues.push(makeIssue(sev, code, params, where, reasons))
  // A judgement that rests on a name-based guess (an exercise outside the curated catalogue) is
  // never presented as certain: a would-be FAIL becomes 'unverified' (shown, never blocking) and a
  // would-be reason becomes a note. Library facts (id, equipment, body part, target) still count.
  const soft = (sev, ...cs) => cs.every(c => !c || c.curated || c.cardio || !c.known) ? sev : sev === 'fail' ? 'unverified' : sev === 'reason' ? 'note' : sev
  const addFor = (cs, sev, code, params, where) => { const s = soft(sev, ...cs); const n = issues.length; add(s, code, params, where); if (s !== sev) issues[n].inferred = true }

  const days = target.kind === 'program' ? (target.days || []) : [target.entries || []]
  // The block type an entry belongs to: the block's own type, or its instance's type in the day.
  const blockTypes = target.blockTypes || {}
  const typeOf = e => target.kind === 'block' ? (target.type || 'strength') : (e?.blk && blockTypes[e.blk]) || 'strength'
  if (!days.length || days.every(d => !d?.length)) add('fail', 'empty')

  const [major] = String(target.protocolVersion || PROTOCOL_VERSION).split('.')
  if (Number(major) > Number(PROTOCOL_VERSION.split('.')[0])) add('note', 'protocol_newer', [target.protocolVersion, PROTOCOL_VERSION])
  if (target.kind === 'block' && target.type && !BLOCK_TYPES_READY.includes(target.type)) add('note', 'type_not_ready', [target.type])

  const weekly = {}
  let workingSets = 0, at10 = 0, at4 = 0, rated = 0, seconds = 0, exerciseCount = 0, setCount = 0

  days.forEach((ex, day) => {
    ex = ex || []
    exerciseCount += ex.length
    const cls = ex.map(e => classify(e.id, lookup))
    const firstCompound = cls.findIndex(c => c.known && c.cls !== 'isolation' && !c.cardio)
    const roles = ex.map((e, i) => roleOf(e, cls[i], goal, i === firstCompound))
    const units = unitsOf(ex)
    const lastInUnit = new Set(units.map(u => u[u.length - 1]))
    seconds += estimateSeconds(ex, e => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), goal, e.role)])

    ex.forEach((e, i) => {
      const c = cls[i], name = nameOf(e.id), where = { day, index: i, why: e.why || e.reason || null }
      const custom = typeof e.id === 'string' && e.id.startsWith('c')
      if (!c.known && !custom) { add('fail', 'unknown_exercise', [e.id], where); return }
      if (c.eq && unavailable.has(c.eq)) add(ctx.official ? 'fail' : 'reason', 'exercise_unavailable', [name], where)
      // Explicit restrictions: a curated exercise that conflicts is a hard FAIL; one we only know by
      // name cannot be verified either way and is reported as such — never silently accepted.
      for (const r of restrictions) {
        if (c.curated) { if (c.flags.includes(RESTRICTION_FLAG[r])) add('fail', 'restriction', [name, r], where) }
        else if (!c.cardio && !custom) { const n = issues.length; add('unverified', 'restriction_unverified', [name, r], where); issues[n].inferred = true }
      }
      const mode = modeOfEntry(e)
      const sets = Math.max(1, Number(e.sets) || 1)
      setCount += sets
      if (c.cardio || mode === 'cardio') return
      // Timed bouts of an interval/HIIT block are rounds, and mobility is not training volume
      // (2J-HEU-INTERVAL-ROUNDS): neither counts as direct weekly sets.
      const btype = typeOf(e)
      const rounds = mode === 'time' && ROUND_TYPES.includes(btype)
      if (!custom && c.group && !rounds && btype !== 'mobility') {
        weekly[c.group] = (weekly[c.group] || 0) + sets
      }
      const sr = rounds ? ROUNDS : SETS[goal]
      if (sets < sr.allow[0] || sets > sr.allow[1]) add('fail', rounds ? 'rounds_outside_allowed' : 'sets_outside_allowed', [name, sets, fmtRange(sr.allow)], where)

      const role = roles[i]
      if (mode === 'reps' && !custom) {
        const r = repRange(e), z = zoneFor(c, goal, role)
        if (r && z) {
          const label = r[0] === r[1] ? String(r[0]) : fmtRange(r)
          if (goal === 'power' && role === 'main' && r[1] > 6) addFor([c], 'fail', 'power_reps', [name], where)
          else if (outside(r[0], r[1], z.allow)) addFor([c], 'fail', 'reps_outside_allowed', [name, label, goal, fmtRange(z.allow)], where)
          else if (outside(r[0], r[1], z.pref)) addFor([c], 'reason', 'reps_outside_preferred', [name, label, goal, fmtRange(z.pref)], where)
        }
      }
      // 2J effort
      const rpe = Array.isArray(e.rpe) ? e.rpe : e.rpe != null ? [e.rpe] : []
      rpe.forEach(v => { if (!RPE_2J.includes(Number(v))) add('fail', 'rpe_not_2j', [name, v], where) })
      const tens = rpe.filter(v => Number(v) === 10).length
      if (rpe.length) { rated += rpe.length; at10 += tens; at4 += rpe.filter(v => Number(v) === 4).length }
      workingSets += sets
      if (tens) {
        if (goal === 'power') add('fail', 'rpe10_power', [name], where)
        else if ((level === 'beginner' || goal === 'beginner') && c.cls === 'compound_free') addFor([c], 'fail', 'rpe10_beginner', [name], where)
        else if (c.cls === 'compound_free' || role === 'main') addFor([c], 'reason', 'rpe10_technical', [name], where)
      }
      // rest (only the last exercise of a superset rests)
      if (e.rest != null && lastInUnit.has(i)) {
        const band = REST[restDemand(c, goal, role)]
        const s = Number(e.rest)
        if (outside(s, s, band.allow)) addFor([c], ['heavy', 'power'].includes(restDemand(c, goal, role)) ? 'fail' : 'reason', 'rest_outside_allowed', [name, s, fmtRange(band.allow)], where)
        else if (outside(s, s, band.pref)) add('note', 'rest_outside_preferred', [name, s, fmtRange(band.pref)], where)
      }
    })

    // duplicates, redundancy, supersets, order — per block instance when the day has blocks
    const groups = {}
    ex.forEach((e, i) => { (groups[e.blk || '_'] = groups[e.blk || '_'] || []).push(i) })
    for (const idxs of Object.values(groups)) {
      const seen = new Map(), byKey = new Map(), byPattern = new Map(), byMove = new Map()
      for (const i of idxs) {
        const c = cls[i], e = ex[i]
        if (!c.known || c.cardio) continue
        if (seen.has(e.id)) add('reason', 'duplicate_exercise', [nameOf(e.id)], { day, index: i, why: e.why })
        else seen.set(e.id, i)
        const k = redundancyKey(c)
        const pairFlagged = byKey.has(k) && ex[byKey.get(k)].id !== e.id
        if (pairFlagged) addFor([c, cls[byKey.get(k)]], 'reason', 'redundant_pair', [nameOf(ex[byKey.get(k)].id), nameOf(e.id)], { day, index: i, why: e.why })
        else if (!byKey.has(k)) byKey.set(k, i)
        // Exercise Library V2 — high overlap: same canonical movement on the same equipment, same
        // side and angle, under different ids. Only a note (an intentional variant is normal).
        const mv = movementOfPattern(c.pattern)
        if (mv && mv !== 'mobility' && !pairFlagged) {
          const nm = String(lookup(e.id)?.n || '').toLowerCase()
          const mk = [mv, equipmentIdOf({ id: e.id, eq: c.eq }), c.uni ? 'u' : 'b', /incline/.test(nm) ? 'inc' : /decline/.test(nm) ? 'dec' : 'flat'].join('|')
          const prev = byMove.get(mk)
          if (prev != null && ex[prev].id !== e.id && redundancyKey(cls[prev]) !== k) add('note', 'high_overlap', [nameOf(ex[prev].id), nameOf(e.id)], { day, index: i })
          else if (prev == null) byMove.set(mk, i)
        }
        byPattern.set(c.pattern, [...(byPattern.get(c.pattern) || []), c])
      }
      for (const [p, list] of byPattern) {
        const n = list.length
        if (n >= 4) addFor(list, 'fail', 'redundant_many', [n, p], { day })
        else if (n === 3 && !['core-flex', 'curl', 'tri-ext', 'calf', 'lat-raise'].includes(p)) addFor(list, 'reason', 'redundant_many', [n, p], { day })
      }
      const blockSize = idxs.length
      if (target.kind === 'block') {
        if (blockSize > BLOCK_SIZE.allow[1]) add('reason', 'block_too_big', [blockSize, fmtRange(BLOCK_SIZE.pref)])
        else if (blockSize < BLOCK_SIZE.pref[0] && ['hypertrophy', 'general', 'endurance'].includes(goal) && !['core', 'arms'].includes(target.focus)) add('note', 'block_small', [blockSize])
        // one block holding more than a whole week's envelope for a muscle
        if (goal === 'hypertrophy') {
          const per = {}
          idxs.forEach(i => { const g = cls[i].group, bt = typeOf(ex[i]); if (g && !cls[i].cardio && bt !== 'mobility' && !(modeOfEntry(ex[i]) === 'time' && ROUND_TYPES.includes(bt))) per[g] = (per[g] || 0) + (Number(ex[i].sets) || 1) })
          for (const [g, n] of Object.entries(per)) if (n > WEEKLY_SETS[level][1]) add('reason', 'volume_high', [g, n, fmtRange(WEEKLY_SETS[level])])
        }
      }
    }
    for (const u of units) {
      if (u.length < 2) continue
      const ids = u.map(i => ex[i].id)
      if (new Set(ids).size < ids.length) add('fail', 'superset_self', [nameOf(ids[0])], { day, index: u[0] })
      for (let a = 0; a < u.length; a++) for (let b = a + 1; b < u.length; b++) {
        const ca = cls[u[a]], cb = cls[u[b]]
        if (ca.cls === 'compound_free' && cb.cls === 'compound_free' && ca.group && ca.group === cb.group)
          addFor([ca, cb], 'reason', 'superset_heavy_same', [nameOf(ex[u[a]].id), nameOf(ex[u[b]].id)], { day, index: u[b], why: ex[u[b]].why })
      }
    }
    if (goal === 'strength') {
      const main = roles.indexOf('main')
      if (main > 1) addFor([cls[main]], 'reason', 'order_strength', [nameOf(ex[main].id)], { day, index: main, why: ex[main].why })
    } else {
      ex.forEach((e, i) => {
        const c = cls[i]
        if (c.cls !== 'isolation' || !c.group) return
        const later = ex.findIndex((f, j) => j > i && cls[j].cls !== 'isolation' && cls[j].group === c.group && (f.blk || '_') === (e.blk || '_'))
        if (later > i) add('note', 'order_isolation_first', [nameOf(e.id)], { day, index: i })
      })
    }
    if (target.kind !== 'block' && ex.length > SESSION_EXERCISES.allow[1]) add('reason', 'session_too_big', [ex.length], { day })
  })

  // effort across everything
  if (rated >= 2 && at10 === rated) add('fail', 'rpe10_all')
  else if (rated >= 3 && at10 / rated > 0.34 && !issues.some(i => i.code === 'rpe10_all')) add('reason', 'rpe10_share', [at10, rated])
  if (rated >= 3 && at4 / rated > 0.5 && ['hypertrophy', 'strength', 'general'].includes(goal)) add('reason', 'rpe_too_easy')

  // weekly direct volume — programs only (a block or single day is not the whole week)
  if (target.kind === 'program' && goal === 'hypertrophy') {
    const [lo, hi] = WEEKLY_SETS[level]
    for (const [g, n] of Object.entries(weekly)) {
      if (n > hi * 2) add('fail', 'volume_absurd', [g, n])
      else if (n > hi) add('reason', 'volume_high', [g, n, fmtRange([lo, hi])])
      else if (n < lo && n > 0) add('note', 'volume_low', [g, n, fmtRange([lo, hi])])
    }
  }

  const result = issues.some(i => i.severity === 'fail') ? 'FAIL' : issues.some(i => i.severity === 'reason') ? 'PASS_WITH_REASON' : 'PASS'
  return {
    result, version: PROTOCOL_VERSION, goal, level, issues,
    stats: { minutes: roundMinutes(seconds), seconds, exercises: exerciseCount, sets: setCount, weeklySets: weekly, unverified: issues.filter(i => i.severity === 'unverified').length },
  }
}

/** Compact list for a model's repair round: only what must change, in plain words. */
export const failuresForRepair = v => v.issues.filter(i => i.severity === 'fail').map(i => `[${i.code}] ${i.message}${i.where?.index != null ? ` (day ${i.where.day}, exercise ${i.where.index})` : ''}`)

/**
 * What a MANUAL save may do with a validation (trainer builder; the server enforces the same):
 *   blocked   — explicit restrictions violated by curated exercises: never overridable here;
 *               the restriction must be withdrawn in the member's context, or the exercise removed.
 *   override  — methodological FAILs: allowed only with a conscious override and a written reason.
 *   ok        — nothing that needs either.
 * AI output never reaches this: any FAIL is repaired or discarded (api/coach/protocol-gate.js).
 */
export function savePolicy(v) {
  const fails = (v?.issues || []).filter(i => i.severity === 'fail')
  const blocked = fails.filter(i => i.code === 'restriction')
  const override = fails.filter(i => i.code !== 'restriction' && i.code !== 'empty')
  return { blocked, override, needsReason: !blocked.length && override.length > 0, ok: !blocked.length && !override.length }
}
export const OVERRIDE_REASON_MIN = 8
