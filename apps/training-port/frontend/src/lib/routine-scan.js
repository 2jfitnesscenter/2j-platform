// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns the raw JSON api/lib/routine-scan.js's Gemini prompt returns (day labels + exercise
// names exactly as printed on a scanned routine) into the same {name, routines, week, customEx}
// "plan bundle" shape lib/plan-share.js's mergePlan() and the trainer panel's
// saveMemberRoutine/saveMemberProgram already expect — matching each exercise name against the
// real library the same way lib/import-csv.js's CSV importer already does for another app's
// export, so this needed no new matching logic, just a new source of names to match.
import { matchExerciseCandidates } from './import-csv.js'
import { uid } from './format.js'
import { t } from './i18n.js'

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// English and Spanish weekday names/abbreviations a printed routine's day heading might use —
// this gym is Spanish-speaking but the scan can come from any source, so both are recognised.
const DAY_ALIASES = {
  1: ['monday', 'lunes', 'lun'], 2: ['tuesday', 'martes', 'mar'],
  3: ['wednesday', 'miercoles', 'mie'], 4: ['thursday', 'jueves', 'jue'],
  5: ['friday', 'viernes', 'vie'], 6: ['saturday', 'sabado', 'sab'],
  0: ['sunday', 'domingo', 'dom'],
}
function weekdayFromLabel(label) {
  if (!label) return null
  const n = norm(label)
  for (const [day, names] of Object.entries(DAY_ALIASES)) {
    if (names.some(a => n.includes(a))) return +day
  }
  return null
}

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const int = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt)

/**
 * @param {object} raw — { name, days: [{ label, exercises: [{ name, nameEn, sets, reps, weight, unit, notes }] }] }
 * @returns {{ name: string, routines: Array, week: object, customEx: Array, unmatchedNames: string[], pendingChoices: Array<{ exId: string, name: string, candidates: Array<{id: string, n: string}> }> }}
 */
export function matchScannedRoutine(raw) {
  const days = Array.isArray(raw?.days) ? raw.days : []
  const created = new Map()   // normalised exercise name -> customEx id, so the same unmatched
  const unmatched = new Set() // name reused across days becomes one customEx, not several
  const candidatesByName = new Map() // normalised name -> candidate list, when it was close but ambiguous
  const week = {}

  const routines = days.map((day, i) => {
    const exList = Array.isArray(day.exercises) ? day.exercises : []
    const ex = exList.filter(e => e && e.name).map(e => {
      // matchExercise() matches against the library's own English names — the scan prompt asks
      // for an English equivalent (nameEn) specifically so a routine read in Spanish (or any
      // other language) still has a real chance of resolving, same as the printed name would if
      // it already happened to be in English. The printed name is what the member actually sees
      // afterwards (in the routine, and as the custom exercise's name if nothing matches) — only
      // the matching step ever looks at nameEn.
      const { id: matched, candidates } = matchExerciseCandidates(e.nameEn || e.name)
      let id = matched
      if (!id) {
        const key = norm(e.name)
        id = created.get(key)
        if (!id) {
          // Custom-exercise ids start with 'c' — see lib/exercises.js's isCustomId(), the
          // convention Social publishing and the trainer save endpoints both key off to know
          // which ids need their full definition (customEx) bundled alongside the routine.
          id = 'c' + uid()
          created.set(key, id)
          // A handful of real candidates (not zero, not one) means the name was CLOSE to
          // something real but genuinely ambiguous — e.g. "hammer curl" matching both the cable
          // and dumbbell version — worth asking about instead of silently filing it as a custom
          // exercise the member has to notice and fix themselves later.
          if (candidates.length > 0) candidatesByName.set(key, candidates)
        }
        unmatched.add(e.name)
      }
      const clean = { id }
      clean.sets = int(e.sets, 1, 10, 3)
      if (e.unit === 'sec') { clean.mode = 'time'; clean.sec = int(e.reps, 5, 3600, 45) }
      else { clean.mode = 'reps'; clean.reps = int(e.reps, 1, 100, 10) }
      if (isNum(e.weight) && e.weight > 0) clean.weight = e.weight
      if (e.notes) clean.note = String(e.notes).slice(0, 200)
      return clean
    })
    const rid = 'r' + i
    const wd = weekdayFromLabel(day.label)
    if (wd != null && !(wd in week)) week[wd] = rid
    return { id: rid, name: (day.label && day.label.trim()) || t('Day {0}', i + 1), emoji: '🏋️', ex }
  }).filter(r => r.ex.length)

  // Same shape sheets.jsx's CustomExForm produces when a member creates one by hand — 'waist'
  // is a placeholder body part (the AI wasn't asked to guess a muscle group from a name alone),
  // editable afterwards like any other custom exercise.
  const customEx = [...created.entries()].map(([, id]) => {
    const original = [...unmatched].find(n => created.get(norm(n)) === id) || t('Exercise')
    return { id, n: original.toLowerCase(), bp: 'waist', tg: '', eq: 'custom', custom: true }
  })

  const pendingChoices = [...candidatesByName.entries()].map(([key, candidates]) => ({
    exId: created.get(key),
    name: [...unmatched].find(n => norm(n) === key),
    candidates,
  }))

  return {
    name: (raw?.name && raw.name.trim()) || t('Scanned routine'),
    routines, week, customEx, pendingChoices,
    unmatchedNames: [...unmatched],
  }
}

/**
 * Applies (or dismisses) one pendingChoices entry — swaps the placeholder custom-exercise id for
 * the chosen real library id everywhere it appears in the bundle, and drops it from customEx and
 * pendingChoices. Passing `chosenId: null` just dismisses the choice (keeps the placeholder as a
 * real custom exercise, same as if it had never been offered any candidates). Returns a new
 * bundle — doesn't mutate the one passed in, so a review screen can hold it in React state.
 */
export function applyPendingChoice(bundle, exId, chosenId) {
  const choice = bundle.pendingChoices.find(p => p.exId === exId)
  const pendingChoices = bundle.pendingChoices.filter(p => p.exId !== exId)
  if (!chosenId) return { ...bundle, pendingChoices }
  return {
    ...bundle,
    pendingChoices,
    customEx: bundle.customEx.filter(c => c.id !== exId),
    unmatchedNames: choice ? bundle.unmatchedNames.filter(n => n !== choice.name) : bundle.unmatchedNames,
    routines: bundle.routines.map(r => ({ ...r, ex: r.ex.map(e => (e.id === exId ? { ...e, id: chosenId } : e)) })),
  }
}
