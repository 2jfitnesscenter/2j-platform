// Deterministic, read-only routine quality analysis. All exercise facts come from the existing
// protocol taxonomy, Library metadata and muscle model; this module is not a second classifier.
//
// Training Quality V2 — what is counted, and how sure each statement is:
//   exercises  how many exercises of a pattern the plan lists (still what redundancy is judged on)
//   sets       the planned working sets of those exercises (the unit balance and volume use)
//   days       on how many of the listed days the pattern / muscle shows up (frequency)
// A finding never carries prose: it carries a `code`, its `params` and the `evidence` behind it, and
// lib/routine-structure-text.js phrases it in the member's language. Each finding says how sure its
// interpretation is (`evidenceType`):
//   fact       a count or a flag read straight from the plan or the Library (12 sets, equipment not in the gym profile)
//   heuristic  a 2J rule of thumb over those counts (a share above a threshold, a reference range) — not a finding of the literature
//   inference  a reading that needs context this analysis does not have (recovery between consecutive days, a short history)
// Nothing here prescribes: thresholds only decide what is worth a second look, never what to do.
import { EXIDX } from './exercises.js'
import { classify, redundancyKey, RESTRICTION_FLAG, WEEKLY_SETS, LEVELS } from './protocol/index.js'
import { facets, isDeprecated, preferredOf, similarVariants } from './library/index.js'
import { musclesOf } from './muscles.js'
import { countsForProgression } from './workout-policy.js'

const MOVE_BUCKET = {
  horizontal_push: 'push', vertical_push: 'push', horizontal_pull: 'pull', vertical_pull: 'pull',
  squat: 'knee', lunge: 'knee', knee_extension: 'knee', hinge: 'hip', hip_thrust: 'hip', hip_extension: 'hip',
  core_anti_extension: 'core', core_flexion: 'core', core_rotation: 'core', core_lateral: 'core',
  cardio: 'conditioning', conditioning: 'conditioning', jump: 'conditioning', olympic: 'power', carry: 'carry',
}
// The pattern families the panel and the AI facts report (what `movementSummary` has always held).
export const PATTERN_KEYS = ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'knee_dominant', 'hip_dominant', 'core', 'conditioning', 'power', 'carry']
const SUMMARY_OF = {
  horizontal_push: 'horizontal_push', vertical_push: 'vertical_push', horizontal_pull: 'horizontal_pull', vertical_pull: 'vertical_pull',
  squat: 'knee_dominant', lunge: 'knee_dominant', knee_extension: 'knee_dominant', hinge: 'hip_dominant', hip_thrust: 'hip_dominant', hip_extension: 'hip_dominant',
  core_anti_extension: 'core', core_flexion: 'core', core_rotation: 'core', core_lateral: 'core',
  cardio: 'conditioning', conditioning: 'conditioning', olympic: 'power', carry: 'carry',
}
const NON_RESISTANCE = new Set(['cardio', 'conditioning', 'mobility', 'interval', 'hiit', 'tabata', 'circuit', 'time'])
// Thresholds are 2J heuristics (they only decide what is worth a second look), not physiological limits.
export const THRESHOLDS = {
  pushWithoutPullSets: 6,      // push sets with no pull at all
  directionSets: 6,            // sets of one pull direction with none of the other
  kneeWithoutHipSets: 9,       // knee-dominant sets with no hip-dominant work
  upperShare: 0.7, upperSets: 12,   // one side's share of the upper-body push+pull sets, and the minimum to say anything
  concentrationShare: 0.45, concentrationSets: 12,   // one pattern's share of the weekly sets (a week of 2+ days only)
}
const GENERAL_FOCUS = new Set(['', 'general', 'full', 'full body', 'fullbody', 'full-body', 'whole body', 'all'])

const asDays = input => {
  if (Array.isArray(input)) return input.map((day, i) => ({ ...day, key: day?.key ?? day?.id ?? String(i) }))
  if (Array.isArray(input?.days)) return input.days.map((day, i) => ({ ...day, key: day?.key ?? day?.id ?? String(i) }))
  const routine = input?.routine || input
  return routine && Array.isArray(routine.ex) ? [{ ...routine, key: routine.id || 'routine' }] : []
}

const isGuidedNonStrength = (entry, day, blocks) => {
  const blockId = entry?.blk
  const type = blockId && (blocks.get(blockId) || day?.blocks?.find(b => b.iid === blockId)?.type)
  return NON_RESISTANCE.has(String(type || '').toLowerCase()) || NON_RESISTANCE.has(String(entry?.mode || '').toLowerCase())
}

function alternativesFor(id, availableEquipment, restrictions = []) {
  const source = EXIDX[id]
  if (!source) return []
  return similarVariants(source, Object.values(EXIDX), {
    lookup: key => EXIDX[key] || null,
    limit: 3,
    exclude: candidate => {
      if (!candidate || isDeprecated(candidate.id)) return true
      if (preferredOf(candidate.id) !== candidate.id) return true
      if (Array.isArray(availableEquipment) && !availableEquipment.includes(facets(candidate)?.equipment)) return true
      // Reuse the protocol flags. An uncurated candidate cannot be confidently checked against
      // an explicit restriction, so the conservative trainer suggestion omits it.
      if (restrictions.length) {
        const cls = classify(candidate.id, key => EXIDX[key] || null)
        if (!cls.curated || restrictions.some(r => cls.flags?.includes(RESTRICTION_FLAG[r]))) return true
      }
      return false
    },
  }).map(row => ({ id: row.ex.id, name: row.ex.n, movement: facets(row.ex)?.movement || null }))
}

const emptyStats = () => ({ exercises: 0, sets: 0, days: 0 })

/**
 * Analyze one routine or a collection of routine days without writing to state.
 * context.workouts is optional and only intended for the member's own locally available history.
 * context.level / context.focus / context.specialization let the analysis use what the trainer declared;
 * without them it stays conservative (no reference range, no specialization assumed).
 */
export function analyzeRoutineStructure(input, context = {}) {
  const days = asDays(input)
  const goal = context.goal || input?.goal || input?.routine?.meta?.goal || 'general'
  const levelRaw = context.level || input?.level || input?.routine?.meta?.level || input?.meta?.level || null
  const level = LEVELS.includes(levelRaw) ? levelRaw : null
  const equipment = Array.isArray(context.availableEquipment) ? context.availableEquipment : null
  const restrictions = Array.isArray(context.restrictions) ? context.restrictions.filter(r => RESTRICTION_FLAG[r]) : []
  const blocks = new Map()
  for (const day of days) for (const b of day.blocks || []) if (b?.iid) blocks.set(b.iid, b.type)
  const isWeek = days.length >= 2 || context.week === true

  const weeklyMovements = {}      // exercises per canonical movement (what redundancy and the legacy counts use)
  const weeklyPatterns = {}
  const movementSets = {}         // planned working sets per canonical movement
  const pattern = Object.fromEntries(PATTERN_KEYS.map(k => [k, emptyStats()]))
  const muscleSets = {}
  const groupSets = {}            // protocol muscle groups, the same grouping the protocol validator counts weekly volume on
  const dayResults = []
  const findings = []
  let unclassifiedExercises = 0
  const seenFindings = new Set()
  const add = finding => {
    if (seenFindings.has(finding.id)) return
    seenFindings.add(finding.id)
    findings.push(finding)
  }

  for (const [dayIndex, day] of days.entries()) {
    const movements = {}
    const patterns = {}
    const dayMovementSets = {}
    const sameStimulus = new Map()
    const exercises = []
    const dayPattern = new Set(), dayMuscle = new Set(), dayGroup = new Set()
    let programmedResistanceSets = 0

    for (const entry of Array.isArray(day?.ex) ? day.ex : []) {
      const ex = EXIDX[entry?.id]
      if (!ex) { unclassifiedExercises++; continue }
      const taxonomy = classify(ex.id, id => EXIDX[id] || null)
      const f = facets(ex)
      const setCount = Math.max(0, Math.min(30, Math.floor(Number(entry.sets) || 0)))
      const resistanceWork = !isGuidedNonStrength(entry, day, blocks)
        && entry?.mode !== 'time' && entry?.mode !== 'cardio'
        && !['mobility', 'cardio', 'conditioning'].includes(f?.movement)
        && taxonomy.pattern !== 'mobility' && taxonomy.pattern !== 'cardio'
      const sets = resistanceWork ? setCount : 0
      if (f?.movement) {
        movements[f.movement] = (movements[f.movement] || 0) + 1
        weeklyMovements[f.movement] = (weeklyMovements[f.movement] || 0) + 1
        if (sets) {
          dayMovementSets[f.movement] = (dayMovementSets[f.movement] || 0) + sets
          movementSets[f.movement] = (movementSets[f.movement] || 0) + sets
        }
        const key = SUMMARY_OF[f.movement]
        if (key) {
          pattern[key].exercises += 1
          pattern[key].sets += sets
          dayPattern.add(key)
        }
      }
      if (taxonomy.pattern && taxonomy.pattern !== 'other' && taxonomy.pattern !== 'unknown') {
        patterns[taxonomy.pattern] = (patterns[taxonomy.pattern] || 0) + 1
        weeklyPatterns[taxonomy.pattern] = (weeklyPatterns[taxonomy.pattern] || 0) + 1
      }
      if (resistanceWork && setCount) {
        programmedResistanceSets += setCount
        for (const [muscle, weight] of Object.entries(musclesOf(ex))) {
          const target = muscleSets[muscle] || (muscleSets[muscle] = { direct: 0, secondary: 0, secondarySets: 0, exposure: 0, days: 0 })
          const weighted = setCount * weight
          target.exposure += weighted
          if (weight >= 0.99) target.direct += setCount
          else { target.secondary += weighted; target.secondarySets += setCount }
          dayMuscle.add(muscle)
        }
        const group = taxonomy.group
        if (group && group !== 'cardio') {
          const g = groupSets[group] || (groupSets[group] = { sets: 0, days: 0 })
          g.sets += setCount
          dayGroup.add(group)
        }
      }
      const key = redundancyKey(taxonomy)
      if (taxonomy.known && taxonomy.pattern !== 'other' && taxonomy.pattern !== 'unknown' && !isGuidedNonStrength(entry, day, blocks)) {
        const group = sameStimulus.get(key) || []
        group.push(entry)
        sameStimulus.set(key, group)
      }
      const row = { id: ex.id, name: ex.n, movement: f?.movement || null, pattern: taxonomy.pattern, equipment: f?.equipment || null,
        sets, deprecated: isDeprecated(ex.id), preferredId: preferredOf(ex.id), compatible: equipment ? equipment.includes(f?.equipment) : null }
      exercises.push(row)
      if (equipment && row.compatible === false) {
        const id = `equipment:${day.key}:${ex.id}`
        add({ id, code: 'equipment_missing', category: 'equipment', severity: 'revisar', evidenceType: 'fact', params: { exerciseId: ex.id, required: f?.equipment },
          evidence: { exerciseId: ex.id, required: f?.equipment, available: equipment }, alternatives: alternativesFor(ex.id, equipment, restrictions) })
      }
      if (row.deprecated) {
        add({ id: `deprecated:${day.key}:${ex.id}`, code: 'deprecated_exercise', category: 'library', severity: 'revisar', evidenceType: 'fact', params: { exerciseId: ex.id, preferredId: row.preferredId },
          evidence: { exerciseId: ex.id, preferredId: row.preferredId }, alternatives: alternativesFor(row.preferredId, equipment, restrictions) })
      }
    }

    for (const [key, rows] of sameStimulus) if (rows.length >= 3) {
      const protectedIds = new Set(day.anchorIds || [])
      const unprotected = rows.filter(e => !e.anchor && !e.priority && !protectedIds.has(e.id))
      if (unprotected.length >= 3) add({ id: `redundancy:${day.key}:${key}`, code: 'redundancy', category: 'redundancy', severity: 'revisar', evidenceType: 'heuristic',
        params: { day: day.name || `Día ${dayIndex + 1}`, count: rows.length },
        evidence: { day: day.name || `Día ${dayIndex + 1}`, exerciseIds: rows.map(e => e.id), count: rows.length } })
    }
    for (const k of dayPattern) pattern[k].days += 1
    for (const m of dayMuscle) muscleSets[m].days += 1
    for (const g of dayGroup) groupSets[g].days += 1
    dayResults.push({ id: day.key, name: day.name || `Día ${dayIndex + 1}`, movements, movementSets: dayMovementSets, patterns, exercises, programmedResistanceSets })
  }

  const buckets = {}
  for (const [movement, count] of Object.entries(weeklyMovements)) {
    const bucket = MOVE_BUCKET[movement]
    if (bucket) buckets[bucket] = (buckets[bucket] || 0) + count
  }
  const setsOf = (...keys) => keys.reduce((n, k) => n + (movementSets[k] || 0), 0)
  const pushCount = buckets.push || 0, pullCount = buckets.pull || 0
  const pushSets = setsOf('horizontal_push', 'vertical_push'), pullSets = setsOf('horizontal_pull', 'vertical_pull')
  const kneeSets = setsOf('squat', 'lunge', 'knee_extension'), hipSets = setsOf('hinge', 'hip_thrust', 'hip_extension')
  const focus = String(context.focus || input?.meta?.focus || input?.routine?.meta?.focus || '').toLowerCase().trim()
  const specialization = !!(context.specialization || input?.meta?.specialization || input?.routine?.meta?.specialization)
  // A declared focus or specialization (a chest block, powerlifting, a test, rehab…) is intentional by definition: the
  // soft balance readings below stay quiet, and only facts (equipment, library, history) and the aligned hard rules remain.
  const declared = specialization || !GENERAL_FOCUS.has(focus)
  const pushSpecialization = ['chest', 'shoulders', 'triceps', 'arms', 'push', 'upper'].includes(focus)
  const pullSpecialization = ['back', 'pull', 'upper'].includes(focus)
  const kneeSpecialization = ['quads', 'lower'].includes(focus)

  if (pushSets >= THRESHOLDS.pushWithoutPullSets && pullSets === 0 && !pushSpecialization) add({ id: 'balance:push-without-pull', code: 'push_without_pull', category: 'balance', severity: 'importante', evidenceType: 'heuristic',
    params: { pushSets, pullSets }, evidence: { pushExercises: pushCount, pullExercises: pullCount, pushSets, pullSets } })
  for (const [source, target] of [['horizontal_pull', 'vertical_pull'], ['vertical_pull', 'horizontal_pull']]) {
    if (!pullSpecialization && !declared && (movementSets[source] || 0) >= THRESHOLDS.directionSets && !(movementSets[target] || 0)) add({
      id: `balance:${source}-without-${target}`, code: 'pull_direction_missing', category: 'balance', severity: 'revisar', evidenceType: 'heuristic',
      params: { present: source, absent: target, sets: movementSets[source] },
      evidence: { present: source, presentCount: weeklyMovements[source] || 0, presentSets: movementSets[source], absent: target } })
  }
  if (kneeSets >= THRESHOLDS.kneeWithoutHipSets && hipSets === 0 && ['hypertrophy', 'strength', 'general', 'endurance'].includes(goal) && !kneeSpecialization && !declared)
    add({ id: 'balance:knee-without-hip', code: 'knee_without_hip', category: 'balance', severity: 'revisar', evidenceType: 'heuristic',
      params: { kneeSets, hipSets }, evidence: { kneeExercises: buckets.knee || 0, kneeSets, hipExercises: 0, hipSets: 0, goal } })
  const upper = pushSets + pullSets
  if (!declared && upper >= THRESHOLDS.upperSets && pushSets && pullSets) {
    const pushShare = pushSets / upper
    if (pushShare >= THRESHOLDS.upperShare) add({ id: 'balance:push-heavy', code: 'push_heavy', category: 'balance', severity: 'info', evidenceType: 'heuristic',
      params: { percent: Math.round(pushShare * 100), pushSets, pullSets }, evidence: { pushSets, pullSets, share: Math.round(pushShare * 100) } })
    else if (1 - pushShare >= THRESHOLDS.upperShare) add({ id: 'balance:pull-heavy', code: 'pull_heavy', category: 'balance', severity: 'info', evidenceType: 'heuristic',
      params: { percent: Math.round((1 - pushShare) * 100), pushSets, pullSets }, evidence: { pushSets, pullSets, share: Math.round((1 - pushShare) * 100) } })
  }
  // One pattern holding a large share of the whole week's sets. A single day is naturally concentrated, so only a week is judged.
  const BALANCE_KEYS = ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'knee_dominant', 'hip_dominant']
  const balanceTotal = BALANCE_KEYS.reduce((n, k) => n + pattern[k].sets, 0)
  if (isWeek && !declared && balanceTotal >= THRESHOLDS.concentrationSets) {
    const top = [...BALANCE_KEYS].sort((a, b) => pattern[b].sets - pattern[a].sets || (a < b ? -1 : 1))[0]
    const share = pattern[top].sets / balanceTotal
    if (share >= THRESHOLDS.concentrationShare) add({ id: 'balance:pattern-concentration', code: 'pattern_concentration', category: 'balance', severity: 'info', evidenceType: 'heuristic',
      params: { pattern: top, percent: Math.round(share * 100), sets: pattern[top].sets }, evidence: { pattern: top, sets: pattern[top].sets, total: balanceTotal, share: Math.round(share * 100) } })
  }
  if (unclassifiedExercises) add({ id: 'catalog:unclassified-exercises', code: 'unclassified_exercises', category: 'library', severity: 'info', evidenceType: 'fact',
    params: { count: unclassifiedExercises }, evidence: { count: unclassifiedExercises } })

  // Weekly direct sets against the protocol's own envelope (the one the protocol validator applies to hypertrophy programs).
  // Reuses WEEKLY_SETS — no second volume table — and says so only when the goal, the level and a whole week are known.
  const reference = { applicable: false, reason: !isWeek ? 'single-day' : goal !== 'hypertrophy' ? 'goal' : !level ? 'level' : 'unknown' }
  if (isWeek && goal === 'hypertrophy' && level) {
    const [lo, hi] = WEEKLY_SETS[level]
    const groups = Object.fromEntries(Object.entries(groupSets).map(([g, v]) => [g, { ...v, status: v.sets > hi ? 'above' : v.sets < lo ? 'below' : 'within' }]))
    Object.assign(reference, { applicable: true, reason: null, source: '2j-protocol-weekly-sets', evidenceType: 'heuristic', level, goal, range: [lo, hi], groups })
    const list = status => Object.entries(groups).filter(([, v]) => v.status === status).sort((a, b) => b[1].sets - a[1].sets || (a[0] < b[0] ? -1 : 1)).map(([group, v]) => ({ group, sets: v.sets }))
    const above = list('above'), below = list('below')
    if (above.length && !declared) add({ id: 'distribution:volume-above-reference', code: 'volume_above_reference', category: 'distribution', severity: 'revisar', evidenceType: 'heuristic',
      params: { level, range: [lo, hi], groups: above }, evidence: { level, range: [lo, hi], groups: above } })
    if (below.length && !declared) add({ id: 'distribution:volume-below-reference', code: 'volume_below_reference', category: 'distribution', severity: 'info', evidenceType: 'heuristic',
      params: { level, range: [lo, hi], groups: below }, evidence: { level, range: [lo, hi], groups: below } })
  }

  const scheduled = Array.isArray(input?.scheduledDays) ? input.scheduledDays : null
  const consecutive = []
  if (scheduled) {
    const sorted = [...scheduled].filter(x => Number.isFinite(x?.day) && x.routineKey != null).sort((a, b) => a.day - b.day)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].day - sorted[i - 1].day !== 1) continue
      const a = dayResults.find(x => x.id === String(sorted[i - 1].routineKey))
      const b = dayResults.find(x => x.id === String(sorted[i].routineKey))
      if (!a || !b) continue
      const overlap = Object.keys(a.movements).filter(m => b.movements[m])
      if (overlap.length) consecutive.push({ from: sorted[i - 1].day, to: sorted[i].day, movements: overlap })
    }
    for (const row of consecutive) add({ id: `distribution:consecutive:${row.from}:${row.to}`, code: 'consecutive_days', category: 'distribution', severity: 'info', evidenceType: 'inference',
      params: { movements: row.movements }, evidence: row })
  }

  const recentWorkouts = Array.isArray(context.workouts) ? context.workouts.filter(countsForProgression).slice(-12) : null
  if (recentWorkouts?.length && input?.routine?.id) {
    const routineWorkouts = recentWorkouts.filter(w => w.routineId === input.routine.id)
    const window = routineWorkouts.slice(-3)
    const planned = [...new Set(days.flatMap(d => (d.ex || []).map(e => e.id).filter(Boolean)))]
    const omissionCounts = planned.map(id => ({ id, count: window.filter(w => !(w.entries || []).some(e => e.id === id && (e.sets || []).some(s => s.done && s.type !== 'warmup'))).length }))
      .filter(x => x.count >= 2)
    if (window.length >= 2 && omissionCounts.length) add({ id: `history:omitted:${input.routine.id}`, code: 'omitted_recently', category: 'history', severity: 'info', evidenceType: 'inference',
      params: { count: omissionCounts.length, exposures: window.length }, evidence: { omittedExerciseIds: omissionCounts.map(x => x.id), exposures: window.length } })
  }

  const applicableCoverage = ['push', 'pull', 'knee', 'hip'].map(id => ({ id, count: buckets[id] || 0 }))
  const severityRank = { importante: 0, revisar: 1, info: 2 }
  const sortedFindings = findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id))
  const movementSummary = {
    horizontal_push: weeklyMovements.horizontal_push || 0,
    vertical_push: weeklyMovements.vertical_push || 0,
    horizontal_pull: weeklyMovements.horizontal_pull || 0,
    vertical_pull: weeklyMovements.vertical_pull || 0,
    knee_dominant: (weeklyMovements.squat || 0) + (weeklyMovements.lunge || 0) + (weeklyMovements.knee_extension || 0),
    hip_dominant: (weeklyMovements.hinge || 0) + (weeklyMovements.hip_thrust || 0) + (weeklyMovements.hip_extension || 0),
    core: Object.entries(weeklyMovements).filter(([id]) => id.startsWith('core_')).reduce((sum, [, count]) => sum + count, 0),
    conditioning: (weeklyMovements.cardio || 0) + (weeklyMovements.conditioning || 0),
    power: weeklyMovements.olympic || 0,
    carry: weeklyMovements.carry || 0,
  }
  const patternSets = Object.fromEntries(PATTERN_KEYS.map(k => [k, pattern[k].sets]))
  return { version: 2, goal, level, source: '2j-protocol-library-muscles-v1', days: dayResults, movements: weeklyMovements, movementSummary, movementSets: patternSets,
    patternStats: pattern, patterns: weeklyPatterns, buckets, applicableCoverage, muscleSets, groupSets, reference,
    context: { week: isWeek, daysListed: days.length, focus: focus || null, declared },
    programmedResistanceSets: dayResults.reduce((n, d) => n + d.programmedResistanceSets, 0),
    scheduledDayFindings: consecutive, findings: sortedFindings }
}

/** What the AI receives: counts, ids and codes only — no prose, no history, no identity. */
export const structuralFactsForAI = analysis => ({
  version: 2,
  goal: analysis?.goal || 'general',
  movements: analysis?.movements || {},
  movementSummary: analysis?.movementSummary || {},
  movementSets: analysis?.movementSets || {},
  patterns: analysis?.patterns || {},
  days: (analysis?.days || []).map(d => ({ name: d.name, movements: d.movements, patterns: d.patterns, programmedResistanceSets: d.programmedResistanceSets })),
  findings: (analysis?.findings || []).map(f => ({ id: f.id, code: f.code, category: f.category, severity: f.severity, evidenceType: f.evidenceType, evidence: f.evidence })),
  source: 'deterministic-2j-analysis',
})
