// Import a training history exported from another app.
//
// Every one of these apps exports the same thing in a different dialect: one row per
// *set*, carrying a date, an exercise name and some mix of weight/reps/distance/time.
// So this reads a column MAP built from the header rather than fixed positions, which
// means a new app is usually a few header aliases rather than another importer.
//
// Verified against real exports:
//   FitNotes (Android) Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment
//   FitNotes 2 (iOS)   Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind
//   Strong             Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
//   Hevy               title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
//   Gravl              Date,Start Date,Workout,Source,Workout Duration (min),Energy,Exercise,Superset,Set,Set Type,Reps,Weight (kg),Distance (km),Set Duration (sec),Incline,Steps,Effort,Workout Notes
//     — "Start Date" is actually a time-of-day ("14:11"), not a second date; "Date" is
//     slash-separated and year-first ("2026/06/28"). "Effort" (Ideal/Difícil/Fácil) has no
//     honest RPE/RIR equivalent and is deliberately left unmapped — see parseWorkoutCSV.
// Anything else falls through to loose header matching, which covers Lyfta and the
// spreadsheet round-trips people actually have on disk, as long as the file has a
// date, an exercise name and something measured.
//
// Apple Health is a different animal — an XML dump, often hundreds of MB. parseAppleHealth()
// scans it in one pass for body weight, body fat, lean mass, steps, sleep, resting heart rate,
// and heart-rate zones during workouts already logged here, all without building a DOM.

import { EXDB, EXIDX } from './exercises.js'
import { uid } from './format.js'
import { nameFor, getLang } from './i18n.js'
import { preferredOf, aliasIndexOf, norm as libNorm } from './library/core.js'
import { matchAll, mapAppleWorkout, attachFitness } from './fitness.js'

/* ----------------------------------------------------------------- CSV ---- */

/**
 * A real CSV reader: quoted fields, embedded commas and newlines, doubled quotes, BOM
 * and CRLF. Splitting on commas breaks on the first exercise named "Bench Press, Close
 * Grip" — and a whole history would import shifted by one column without ever erroring.
 */
export function parseCSV(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const s = String(text).replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(x => x !== '')) rows.push(row)
  return rows
}

const norm = h => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// header text -> the field we care about. Specific names first; first match wins.
const COLUMNS = [
  ['exercise', ['exercise', 'exercise name', 'exercise title']],
  ['date', ['date', 'workout date']],
  ['startTime', ['start time']],
  // Gravl's own "Start Date" column is a time-of-day ("14:11"), not a second date — its real
  // date lives in the plain 'date' column above. Kept as its own field (never aliased into
  // startTime, which every other format uses for a FULL date+time string) so the two are never
  // confused; parseWorkoutCSV merges it into `when` only when the date column had no time of
  // its own.
  ['timeOfDay', ['start date']],
  ['endTime', ['end time']],
  ['workoutName', ['workout name', 'title', 'workout']],
  ['category', ['category', 'body part', 'muscle group']],
  ['weightKg', ['weight kg']],
  ['weightLb', ['weight lbs', 'weight lb']],
  ['weight', ['weight']],
  ['weightUnit', ['weight unit', 'unit']],
  ['reps', ['reps', 'repetitions']],
  // Hevy and Strong both write an RPE per set. Nothing mainstream exports RIR, but read it
  // when it is there rather than dropping the column on the floor.
  ['rpe', ['rpe', 'rpe rating']],
  ['rir', ['rir', 'reps in reserve']],
  ['distanceKm', ['distance km']],
  ['distance', ['distance']],
  ['distanceUnit', ['distance unit']],
  ['seconds', ['seconds', 'duration seconds', 'set duration sec']],
  ['time', ['time', 'duration']],
  ['setType', ['set type']],
  // Same field a "grouped set" comes in under across every format seen so far — Hevy's
  // superset_id, Gravl's Superset. See parseWorkoutCSV's own comment on the one conservative
  // rule applied to whatever raw value shows up here, regardless of which app wrote it.
  ['supersetGroup', ['superset', 'superset id']],
  ['note', ['comment', 'comments', 'notes', 'note']],
]

function mapHeader(header) {
  const map = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [field, names] of COLUMNS) {
      if (map[field] === undefined && names.includes(n)) { map[field] = i; return }
    }
  })
  return map
}

/** Name of the app a header looks like — shown back to the user so they can sanity-check. */
export function detectSource(header) {
  const h = header.map(norm)
  if (h.includes('exercise title') && h.includes('set index')) return 'Hevy'
  if (h.includes('exercise name') && h.includes('set order')) return 'Strong'
  if (h.includes('exercise') && h.includes('kind')) return 'FitNotes (iOS)'
  if (h.includes('exercise') && h.includes('weight unit')) return 'FitNotes'
  if (h.includes('exercise') && h.includes('category')) return 'FitNotes'
  // "Start Date" being a time-of-day rather than a date is distinctive enough on its own —
  // paired with "Workout Duration (min)", which nothing else here writes.
  if (h.includes('start date') && h.includes('workout duration min')) return 'Gravl'
  return null
}

/* ------------------------------------------------------ exercise matching -- */

// Other apps bolt qualifiers onto names — Hevy writes "Leg Press (Machine)", Strong
// "Snatch (Barbell)", FitNotes "Lat Pulldown (Pulley)" — while the dataset writes
// "barbell snatch". Strip the parentheses, expand the shorthand, then compare as a
// sorted bag of words so word order stops mattering.
const SYN = [
  [/\bbb\b/g, 'barbell'], [/\bdb\b/g, 'dumbbell'], [/\bkb\b/g, 'kettlebell'],
  [/\bohp\b/g, 'overhead press'], [/\bbw\b/g, 'body weight'], [/\bbodyweight\b/g, 'body weight'],
  [/\bmachine\b/g, 'lever'], [/\bsmith machine\b/g, 'smith'], [/\bez bar\b/g, 'ez barbell'],
  [/\bpull ups?\b/g, 'pull up'], [/\bchin ups?\b/g, 'chin up'], [/\bpush ups?\b/g, 'push up'],
  [/\bsit ups?\b/g, 'sit up'], [/\bdips?\b/g, 'dip'], [/\braises?\b/g, 'raise'],
  [/\bcurls?\b/g, 'curl'], [/\bpresses\b/g, 'press'], [/\bextensions?\b/g, 'extension'],
  [/\bcables?\b/g, 'cable'], [/\bseated\b/g, 'seated'], [/\bassisted\b/g, 'assisted'],
]
// Words that say nothing about which exercise this is, so they shouldn't stop a match.
const FILLER = new Set(['the', 'a', 'with', 'and', 'v', 'variation', 'version', 'pulley', 'weighted'])

function wordsOf(name) {
  // Parentheses are unwrapped rather than dropped: "Bench Press (Barbell)" carries its
  // equipment in there, and the dataset writes that as "barbell bench press".
  // Accents are folded, not dropped ("búlgara" → "bulgara", never "b lgara").
  let k = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  SYN.forEach(([re, to]) => { k = k.replace(re, to) })
  return k.split(' ').filter(w => w && !FILLER.has(w))
}
const keyOf = name => wordsOf(name).sort().join(' ')

let INDEX = null
function buildIndex() {
  if (INDEX) return INDEX
  INDEX = { exact: new Map(), all: [] }
  EXDB.forEach(e => {
    const w = wordsOf(e.n)
    const k = w.slice().sort().join(' ')
    if (!INDEX.exact.has(k)) INDEX.exact.set(k, e.id)
    INDEX.all.push({ id: e.id, set: new Set(w), n: w.length })
  })
  return INDEX
}

// Curated: the names people actually log, mapped by hand to the dataset id they mean.
//
// Other apps let you name a lift "Bench Press"; the dataset only has qualified names
// like "barbell bench press". Word-overlap alone can't resolve that — "bench press" sits
// inside thirty-three entries — and where it *is* unique it tends to be wrong, happily
// resolving "Squat" to "weighted squat" and "Leg Press" to "smith leg press". So the
// common vocabulary is spelled out. The convention is that an unqualified name means the
// canonical barbell version, which is what these apps assume when they show it to you.
// Extending this table is the intended way to improve import accuracy.
const ALIAS_EX = {
  'bench press': '0025', 'barbell bench press': '0025', 'flat bench press': '0025',
  'incline bench press': '0047', 'decline bench press': '0033',
  'close grip bench press': '0030', 'close-grip bench press': '0030',
  squat: '0043', 'back squat': '0043', 'barbell squat': '0043', 'front squat': '0042',
  deadlift: '0032', 'romanian deadlift': '0085', rdl: '0085', 'sumo deadlift': '0117',
  'lat pulldown': '2330', 'lat pull down': '2330', pulldown: '2330',
  shrug: '0095', shrugs: '0095',
  'overhead press': '0091', 'military press': '0091', 'shoulder press': '0091', ohp: '0091',
  'barbell row': '0027', 'bent over row': '0027', 'bent-over row': '0027',
  'dumbbell row': '0292', 'one arm dumbbell row': '0292',
  'leg curl': '0586', 'lying leg curl': '0586', 'seated leg curl': '0586',
  'leg press': '0739', 'leg extension': '0585',
  'calf raise': '1372', 'standing calf raise': '1372', 'seated calf raise': '0088',
  'lateral raise': '0334', 'side raise': '0334', 'reverse fly': '0348', 'rear delt fly': '0348',
  'bicep curl': '0294', 'biceps curl': '0294', 'dumbbell curl': '0294',
  'preacher curl': '0070', 'barbell curl': '0031',
  'tricep pushdown': '0241', 'triceps pushdown': '0241', pushdown: '0241',
  skullcrusher: '0060', 'skull crusher': '0060', 'lying triceps extension': '0061',
  lunge: '0054', lunges: '0054', 'cable crossover': '1269', 'cable cross over': '1269',
  // 0058 is the barbell hip thrust (upper back on a bench); 1409 is the floor glute bridge.
  'hip thrust': '0058', 'barbell hip thrust': '0058', 'hip thrusts': '0058', 'glute bridge': '1409', 'barbell glute bridge': '1409',
}

let ALIAS_IDX = null
const aliasIndex = () => {
  if (!ALIAS_IDX) {
    ALIAS_IDX = new Map()
    for (const k in ALIAS_EX) ALIAS_IDX.set(wordsOf(k).sort().join(' '), ALIAS_EX[k])
  }
  return ALIAS_IDX
}

/**
 * Find the dataset exercise a foreign name refers to — plus, when it can't be resolved to
 * exactly one, every candidate that was too close to call.
 *
 * Curated alias first, then an exact word-bag match, then entries that contain every word of
 * the query — but only auto-resolved when exactly one candidate is that close. Guessing between
 * "cable hammer curl" and "dumbbell hammer curl" would file years of training under the wrong
 * lift, which is worse than surfacing both and asking. `candidates` carries that tied set (the
 * scan-a-routine review screen turns it into a picker); a genuinely unmatched name — nothing
 * close at all — gets an empty list and falls back to a custom exercise, same as always.
 *
 * @returns {{ id: string|null, candidates: Array<{id: string, n: string}> }}
 */
// The exercise names as shown in the current language (Spanish for a Spanish member), exact
// match only — a translated name is as good as the dataset's English one. Built per language.
let LOCAL_IDX = null, LOCAL_LANG = null
function localIndex() {
  if (LOCAL_IDX && LOCAL_LANG === getLang()) return LOCAL_IDX
  LOCAL_LANG = getLang()
  LOCAL_IDX = new Map()
  EXDB.forEach(e => { const k = libNorm(nameFor(e)); LOCAL_IDX.set(k, [...(LOCAL_IDX.get(k) || []), e.id]) })
  return LOCAL_IDX
}
// A deprecated duplicate is filed under its preferred twin (same exercise, confirmed — see
// lib/library/overrides.js); a list is de-duplicated after that mapping.
const resolved = ids => [...new Set(ids.map(preferredOf))]

export function matchExerciseCandidates(name) {
  const idx = buildIndex()
  const w = wordsOf(name)
  if (!w.length) return { id: null, candidates: [] }
  // Compared as a sorted bag of words, so "Squat (Barbell)" finds the 'barbell squat'
  // alias — the exporters disagree about whether the equipment leads or trails.
  const sorted = w.slice().sort().join(' ')
  const aliased = aliasIndex().get(sorted)
  if (aliased && EXIDX[aliased]) return { id: preferredOf(aliased), candidates: [] }
  // Exercise Library V2: the 2J aliases (Spanish vocabulary, names an exercise had before a
  // correction) and the translated names, both exact. Two live exercises under one translated
  // name are never guessed between — they come back as candidates.
  const nq = libNorm(name)
  const libAlias = aliasIndexOf().get(nq)
  if (libAlias && EXIDX[libAlias]) return { id: preferredOf(libAlias), candidates: [] }
  const local = resolved(localIndex().get(nq) || [])
  if (local.length === 1) return { id: local[0], candidates: [] }
  if (local.length > 1) return { id: null, candidates: local.map(id => ({ id, n: nameFor(EXIDX[id]) })) }
  const exact = idx.exact.get(sorted)
  if (exact) return { id: preferredOf(exact), candidates: [] }
  const q = new Set(w)
  let bestExtra = Infinity, tied = []
  for (const c of idx.all) {
    let ok = true
    for (const word of q) if (!c.set.has(word)) { ok = false; break }
    if (!ok) continue
    const extra = c.n - q.size
    if (extra > 2) continue
    if (extra < bestExtra) { bestExtra = extra; tied = [c.id] }
    else if (extra === bestExtra) tied.push(c.id)
  }
  const live = resolved(tied)
  if (live.length === 1) return { id: live[0], candidates: [] }
  return { id: null, candidates: live.map(id => ({ id, n: nameFor(EXIDX[id]) })) }
}

/** Find the dataset exercise a foreign name refers to, or null — see matchExerciseCandidates()
 * for the tied-candidates version the scan-a-routine review screen uses. */
export function matchExercise(name) {
  return matchExerciseCandidates(name).id
}

// Categories the exporters use -> the dataset's body parts, for exercises we invent.
const CATEGORY_BP = {
  chest: 'chest', back: 'back', lats: 'back', shoulders: 'shoulders', delts: 'shoulders',
  legs: 'upper legs', quads: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs',
  calves: 'lower legs', abs: 'waist', core: 'waist', obliques: 'waist',
  arms: 'upper arms', biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  cardio: 'cardio', 'full body': 'upper legs', olympic: 'upper legs', neck: 'neck',
}

/* ----------------------------------------------------------- conversion --- */

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }
// An effort rating out of someone else's export. A blank cell means "not rated" and has to
// stay absent rather than becoming 0 — and 0 itself means opposite things on the two scales:
// RIR 0 is a set taken to failure and worth keeping, while RPE has no 0 (the scale is 1–10),
// so an app writing 0 for "nothing here" must not be read as an effort. Ratings above the
// scale are capped rather than dropped — the set was still rated, just written oddly.
const effortNum = (raw, zeroMeansRated) => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = parseFloat(s.replace(',', '.'))
  if (!isFinite(n) || n < 0 || (n === 0 && !zeroMeansRated)) return null
  return Math.min(10, Math.round(n * 100) / 100)
}
const LB_TO_KG = 0.45359237
const p2 = n => String(n).padStart(2, '0')
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "2020-12-30 18:51:52" · "2024-03-07" · "22 Dec 2025, 08:00" · "07/03/2024" · "2026/06/28"
 *  -> { d, t } */
export function parseWhen(s) {
  const v = String(s || '').trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (m) return { d: `${m[1]}-${p2(m[2])}-${p2(m[3])}`, t: hm(m[4], m[5]) }
  // Year-first but slash-separated (Gravl) — distinct from the hyphenated ISO-ish pattern
  // above only in its separator, so it needs its own branch rather than a shared one.
  m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (m) return { d: `${m[1]}-${p2(m[2])}-${p2(m[3])}`, t: hm(m[4], m[5]) }
  m = v.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[2].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`, t: hm(m[4], m[5]) }
  m = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[1].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[1].toLowerCase()])}-${p2(m[2])}`, t: hm(m[4], m[5]) }
  // Day-first when ambiguous: FitNotes/Strong/Hevy all write unambiguous dates, so a
  // bare numeric one came through a spreadsheet, and those are usually European.
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[, ]+(\d{1,2}):(\d{2}))?/)
  if (m) {
    const [, a, b, y] = m
    const day = +a > 12 ? a : +b > 12 ? b : a
    const mon = day === a ? b : a
    return { d: `${y}-${p2(mon)}-${p2(day)}`, t: hm(m[4], m[5]) }
  }
  return null
}
const hm = (h, mi) => (h === undefined ? null : (parseInt(h, 10) || 0) * 3600000 + (parseInt(mi, 10) || 0) * 60000)
/** "14:11" -> ms since midnight, or null. For a format (Gravl) that splits date and
 *  time-of-day into two separate columns instead of one combined string. */
function parseTimeOfDay(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/)
  return m ? hm(m[1], m[2]) : null
}

/** "HH:MM:SS" · "MM:SS" · "90" -> minutes */
function toMinutes(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  if (s.includes(':')) {
    const p = s.split(':').map(x => parseInt(x, 10) || 0)
    const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
    return Math.round(sec / 60 * 10) / 10
  }
  const m = s.match(/(\d+)\s*h/i), mm = s.match(/(\d+)\s*m/i)      // Strong's "2h 38m"
  if (m || mm) return (m ? +m[1] * 60 : 0) + (mm ? +mm[1] : 0)
  return Math.round(num(s) * 10) / 10
}
const KM = { m: 0.001, km: 1, cm: 0.00001, in: 0.0000254, ft: 0.0003048, yd: 0.0009144, mi: 1.609344 }
const toKm = (v, unit) => num(v) * (KM[String(unit || 'km').toLowerCase().trim()] ?? 1)

/* --------------------------------------------------------------- parse ---- */

/**
 * Read an export into workouts 2J Fitness Center understands, WITHOUT touching state — the caller
 * shows the summary for confirmation first. Nothing here throws on a bad row: a history
 * of several thousand sets will contain oddities, and losing the file over one of them
 * helps nobody. Bad rows are counted and reported instead.
 */
export function parseWorkoutCSV(text, { unit = 'kg' } = {}) {
  const rows = parseCSV(text)
  if (rows.length < 2) return { error: 'empty' }
  const map = mapHeader(rows[0])
  const source = detectSource(rows[0])
  const dateCol = map.date !== undefined ? 'date' : map.startTime !== undefined ? 'startTime' : null
  if (!dateCol || map.exercise === undefined) return { error: 'unrecognised' }

  const resolved = new Map()          // exercise name -> dataset id | null, resolved once
  const byDate = new Map()
  // A real time-of-day is sufficient session identity across Hevy/Strong/Gravl and generic
  // exports. Historical files containing only a date retain the legacy one-workout-per-day
  // fallback; no arbitrary split is inferred from row order or exercise names.
  const created = new Map()
  const unmatched = new Set()
  let sets = 0, skipped = 0, matched = 0, warmups = 0, rpeSets = 0, rirSets = 0
  let sawLb = false, sawKg = false

  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim())

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const name = cell(r, 'exercise')
    const when = parseWhen(cell(r, dateCol))
    if (!name || !when) { skipped++; continue }
    // Gravl's own date column carries no time of day at all — pull it from the separate
    // "Start Date" (really start-TIME) column when the main one didn't already have one.
    if (when.t == null && map.timeOfDay !== undefined) when.t = parseTimeOfDay(cell(r, 'timeOfDay'))

    // explicit kg/lb columns beat a generic column plus a unit column
    let w = 0, rowUnit = ''
    if (map.weightKg !== undefined && cell(r, 'weightKg')) { w = num(cell(r, 'weightKg')); rowUnit = 'kg' }
    else if (map.weightLb !== undefined && cell(r, 'weightLb')) { w = num(cell(r, 'weightLb')); rowUnit = 'lb' }
    else {
      w = num(cell(r, 'weight'))
      const u = cell(r, 'weightUnit').toLowerCase()
      rowUnit = u.startsWith('lb') ? 'lb' : u.startsWith('kg') ? 'kg' : ''
    }
    if (rowUnit === 'lb') sawLb = true
    if (rowUnit === 'kg') sawKg = true

    const reps = Math.round(num(cell(r, 'reps')))
    const secs = num(cell(r, 'seconds'))
    const mins = secs > 0 ? Math.round(secs / 60 * 10) / 10 : toMinutes(cell(r, 'time'))
    const km = map.distanceKm !== undefined && cell(r, 'distanceKm')
      ? num(cell(r, 'distanceKm'))
      : toKm(cell(r, 'distance'), cell(r, 'distanceUnit'))
    if (!w && !reps && !mins && !km) { skipped++; continue }
    if (/warm|calentamiento/i.test(cell(r, 'setType'))) warmups++

    const key = keyOf(name)
    let id = resolved.get(key)
    if (id === undefined) { id = matchExercise(name); resolved.set(key, id) }
    if (id) matched++
    else {
      let c = created.get(key)
      if (!c) {
        c = {
          id: 'im' + uid(), n: name.toLowerCase(), custom: true, eq: 'custom', tg: '', desc: '',
          bp: CATEGORY_BP[cell(r, 'category').toLowerCase()] || (km || (mins && !reps) ? 'cardio' : 'upper legs'),
        }
        created.set(key, c)
        unmatched.add(name)
      }
      id = c.id
    }

    const isCardio = (km > 0 || mins > 0) && !reps
    // `u` carries the row's own unit into the conversion pass below and is dropped there —
    // it never reaches the stored set.
    const set = isCardio
      ? { min: mins || 0, speed: mins > 0 ? Math.round(km / (mins / 60) * 10) / 10 : 0, done: true }
      : { w, r: reps || 0, done: true, u: rowUnit }
    // Effort rides along only where the app can show it again: a weighted rep set. A treadmill
    // row with an RPE would have nowhere to put it. A set is kept on one scale, so a file
    // carrying both columns is read as RIR — the same precedence setLabel reads them back with.
    if (!isCardio) {
      const rir = effortNum(cell(r, 'rir'), true)
      const rpe = rir == null ? effortNum(cell(r, 'rpe'), false) : null
      if (rir != null) { set.rir = rir; rirSets++ }
      else if (rpe != null) { set.rpe = rpe; rpeSets++ }
    }

    const sessionKey = when.t != null ? `${when.d}|${when.t}` : when.d
    let day = byDate.get(sessionKey)
    if (!day) {
      day = { d: when.d, ex: new Map(), name: cell(r, 'workoutName') || '', start: when.t, end: null }
      byDate.set(sessionKey, day)
    }
    if (!day.name) day.name = cell(r, 'workoutName') || ''
    if (map.endTime !== undefined) { const e = parseWhen(cell(r, 'endTime')); if (e && e.t != null) day.end = e.t }
    else if (map.time !== undefined && !map.seconds && reps) { /* FitNotes' Time is per-set */ }
    if (!day.ex.has(id)) day.ex.set(id, [])
    day.ex.get(id).push(set)
    sets++

    // Whichever raw value a "grouped set" column carries (Hevy's superset_id, Gravl's
    // Superset) — resolved into 2J's own adjacent-entries `sg` once the day's full entry
    // order is known, below. "No" is Gravl's own explicit not-grouped sentinel; an empty
    // cell means the same for every format.
    const ssRaw = cell(r, 'supersetGroup')
    if (ssRaw && ssRaw.toLowerCase() !== 'no') {
      if (!day.ssRaw) day.ssRaw = new Map()
      day.ssRaw.set(id, ssRaw)
    }
  }

  // lb -> kg only where a row disagrees with the profile. The app never converts units on
  // its own, so importing unconverted would silently rewrite someone's numbers.
  // Converting PER ROW matters: apps like FitNotes write the unit next to every set, and a
  // history recorded partly in lb and partly in kg used to be taken over as-is, turning
  // "185 lb" into 185 kg.
  const fileUnit = sawLb && !sawKg ? 'lb' : sawKg && !sawLb ? 'kg' : ''
  const mixedUnits = sawLb && sawKg
  const toKg = x => Math.round(x * LB_TO_KG * 10) / 10
  const toLb = x => Math.round(x / LB_TO_KG * 10) / 10
  // A row without its own unit follows the file's, and a file that says nothing is taken
  // to already be in the profile's unit.
  const convRow = s => {
    const u = s.u || fileUnit
    if (!u || u === unit) return s.w
    return u === 'lb' ? toKg(s.w) : toLb(s.w)
  }
  const converted = (!!fileUnit && fileUnit !== unit) || mixedUnits

  const sessions = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d) || (a.start ?? 0) - (b.start ?? 0))
  const workouts = sessions.map(day => {
    const d = day.d
    const entries = [...day.ex.entries()].map(([id, ss]) => {
      const conv2 = ss.map(({ u, ...s }) => (s.w !== undefined ? { ...s, w: convRow({ ...s, u }) } : s))
      const mx = Math.max(0, ...conv2.map(s => s.w || 0))
      return { id, sets: conv2, topW: mx || null }
    })
    // The one conservative grouping rule applied regardless of source app: 2+ DIFFERENT,
    // ADJACENT exercises sharing the exact same raw superset value are a real superset — the
    // literal convention Hevy's own superset_id demonstrates. A format whose "grouped set"
    // column turns out to mean something else (e.g. merely numbering an exercise's own
    // position in a routine, never repeating that number on a different exercise next to it)
    // safely produces no groups here rather than a wrong guess — see the module's own header
    // comment for why this is deliberate, not a gap.
    if (day.ssRaw && day.ssRaw.size) {
      let i = 0
      while (i < entries.length) {
        const raw = day.ssRaw.get(entries[i].id)
        if (!raw) { i++; continue }
        let j = i + 1
        while (j < entries.length && day.ssRaw.get(entries[j].id) === raw) j++
        if (j - i > 1) {
          const localSg = 'imss' + uid()
          for (let k = i; k < j; k++) entries[k].sg = localSg
        }
        i = j
      }
    }
    const base = new Date(d + 'T00:00:00').getTime()
    const start = base + (day.start ?? 18 * 3600000)
    const end = day.end != null ? base + day.end : start
    const w = {
      id: 'iw' + uid(), d, start, end: end > start ? end : start,
      routineId: null, name: day.name || 'Imported', entries, prs: [],
    }
    w.vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.w || 0) * (s.r || 0), 0), 0)
    // Capture source identity before a later alias replaces a temporary custom id. Otherwise
    // the same CSV can acquire a different fingerprint merely because the alias now exists.
    w.importFingerprint = workoutFingerprint(w, [...created.values()])
    return w
  })

  return {
    kind: 'workouts', source, workouts, customEx: [...created.values()],
    // distinct library exercises behind the matched rows — the summary calls this
    // "exercises matched", and counting rows there made three exercises read as five
    matched: new Set([...resolved.values()].filter(Boolean)).size,
    matchedSets: matched,
    created: created.size, unmatchedNames: [...unmatched].sort(),
    sets, skipped, warmups, fileUnit, mixedUnits, converted, rpeSets, rirSets,
    from: sessions[0]?.d || null, to: sessions.at(-1)?.d || null,
  }
}

/* ------------------------------------------------------- body weight ------ */

/**
 * Body weight from any CSV with a date and a weight column — FitNotes/Strong/Hevy's own
 * weight-tracking exports, or a spreadsheet round-trip. Apple Health's export.xml is handled
 * separately by parseAppleHealth() below (a different animal entirely: one huge XML dump
 * rather than a weight-only table), which parseImport() routes to first.
 */
export function parseBodyweight(text, { unit = 'kg' } = {}) {
  const s = String(text)
  const out = new Map()          // iso date -> { w, t }  (one weigh-in per day, the last)
  let fileUnit = ''

  const rows = parseCSV(s)
  if (rows.length < 2) return { error: 'empty' }
  const map = mapHeader(rows[0])
  // a weight-only CSV: whichever weight column it has
  const wCol = map.weightKg ?? map.weightLb ?? map.weight
  const dCol = map.date ?? map.startTime
  if (wCol === undefined || dCol === undefined) return { error: 'unrecognised' }
  if (map.weightKg !== undefined) fileUnit = 'kg'
  else if (map.weightLb !== undefined) fileUnit = 'lb'
  for (let i = 1; i < rows.length; i++) {
    const when = parseWhen(String(rows[i][dCol] ?? ''))
    const w = num(rows[i][wCol])
    if (!when || !w) continue
    out.set(when.d, { w, t: new Date(when.d).getTime() + (when.t ?? 0) })
  }

  if (!out.size) return { error: 'unrecognised' }
  const converted = !!fileUnit && fileUnit !== unit
  const conv = converted
    ? (fileUnit === 'lb' ? x => Math.round(x * LB_TO_KG * 10) / 10 : x => Math.round(x / LB_TO_KG * 10) / 10)
    : x => Math.round(x * 10) / 10
  const dates = [...out.keys()].sort()
  return {
    kind: 'bodyweight', source: null,
    bodyweight: dates.map(d => ({ d, w: conv(out.get(d).w), t: out.get(d).t || new Date(d).getTime() })),
    fileUnit, converted, from: dates[0], to: dates[dates.length - 1],
  }
}

/* -------------------------------------------------------- Apple Health ---- */

// Attribute pickers reused across every <Record> tag — predefined once rather than built per
// call, since this runs against every record in what can be a several-hundred-MB file.
const AT_TYPE = /\btype="([^"]*)"/, AT_VALUE = /\bvalue="([^"]*)"/
const AT_START = /\bstartDate="([^"]*)"/, AT_END = /\bendDate="([^"]*)"/, AT_UNIT = /\bunit="([^"]*)"/
const pick = (tag, re) => { const m = re.exec(tag); return m ? m[1] : null }
const pickNum = (tag, re) => { const v = pick(tag, re); const n = v == null ? NaN : parseFloat(v); return isFinite(n) ? n : null }

// Health writes "2024-01-01 08:00:00 -0500" — space-separated, numeric offset, not real ISO
// 8601 — which native Date parsing handles inconsistently across engines. Parsed by hand so a
// heart-rate sample's timestamp lines up reliably against S.workouts' own start/end (real UTC
// epoch ms) on every platform, iOS Safari included, where this app actually runs.
function parseHKDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\s([+-]\d{2})(\d{2}))?/.exec(v || '')
  if (!m) { const t = Date.parse(v); return isFinite(t) ? t : null }
  const [, y, mo, d, h, mi, se, oh, om] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
  const offMin = oh ? (oh[0] === '-' ? -1 : 1) * (Math.abs(+oh) * 60 + +om) : 0
  return utc - offMin * 60000
}

const HK = {
  BodyMass: 'HKQuantityTypeIdentifierBodyMass',
  BodyFat: 'HKQuantityTypeIdentifierBodyFatPercentage',
  LeanMass: 'HKQuantityTypeIdentifierLeanBodyMass',
  Steps: 'HKQuantityTypeIdentifierStepCount',
  Sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  RestingHR: 'HKQuantityTypeIdentifierRestingHeartRate',
  HeartRate: 'HKQuantityTypeIdentifierHeartRate',
}

// Binary search over workout windows sorted by start: the last window starting at-or-before
// `t`, if `t` actually falls inside it. Correct regardless of the file's own record order —
// Health does not guarantee heart-rate records arrive chronologically across the whole export.
function windowAt(wins, t) {
  let lo = 0, hi = wins.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (wins[mid].start <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  const w = ans >= 0 ? wins[ans] : null
  return w && t <= w.end ? w : null
}

// 5 standard bands as fractions of estimated max heart rate: Z1 50-60%, Z2 60-70%, Z3 70-80%,
// Z4 80-90%, Z5 90%+. A reading below Z1's floor still counts as Z1 rather than being dropped —
// any elevated heart rate during a lift is still some effort.
const bandFor = (bpm, cuts) => bpm < cuts[1] ? 0 : bpm < cuts[2] ? 1 : bpm < cuts[3] ? 2 : bpm < cuts[4] ? 3 : 4

const lastWins = (out, d, v, t) => out.set(d, { v, t })   // same "last reading of the day wins" rule as bodyweight
const addTo = (out, d, v, t) => { const cur = out.get(d); out.set(d, { v: (cur ? cur.v : 0) + v, t }) }

/**
 * Everything this app can use out of an Apple Health export.xml: body weight, body fat, lean
 * mass (the closest thing Health has to "muscle mass" — see measurements.js), steps, sleep,
 * resting heart rate, and — for every passed-in workout whose window overlaps a continuous
 * heart-rate sample — minutes spent in each of 5 heart-rate zones for that session.
 *
 * One pass over the text, dispatching each <Record> by its own `type` attribute, rather than
 * scanning once per type: the file is often several hundred MB, nearly all of it step counts
 * and heart rate, and re-scanning that many times over would multiply the cost for no reason.
 * Daily series are summed/overwritten into the day's bucket immediately and the raw record
 * dropped — memory stays O(days), not O(records) — except heart-rate samples that fall inside
 * a workout window, which are kept (per matched workout only) so zone minutes can be computed
 * from real gaps between consecutive samples once every record has been seen.
 */
export function parseAppleHealth(text, { unit = 'kg', workouts = [], maxHR = null, maxHRKind = null } = {}) {
  const s = String(text)
  if (!s.includes('HKQuantityTypeIdentifier') && !s.includes('HKCategoryTypeIdentifier')) return { error: 'unrecognised' }

  const bw = new Map(), bodyFat = new Map(), leanMass = new Map()
  const steps = new Map(), sleep = new Map(), restingHR = new Map()
  let bwUnit = '', leanUnit = ''

  const wins = workouts
    .filter(w => w.id && w.start && w.end > w.start)
    .map(w => ({ id: w.id, start: w.start, end: w.end }))
    .sort((a, b) => a.start - b.start)
  const hrSamples = new Map()   // workout id -> [{t, v}] — only for workouts a sample actually falls in
  const zoneCuts = maxHR > 0 ? [0.5, 0.6, 0.7, 0.8, 0.9, 1].map(p => p * maxHR) : null

  const RE = /<Record\b[^>]*\/?>/g
  let m
  while ((m = RE.exec(s))) {
    const tag = m[0]
    const type = pick(tag, AT_TYPE)
    if (!type) continue

    if (type === HK.HeartRate) {
      if (!wins.length) continue
      const t = parseHKDate(pick(tag, AT_START)); if (t == null) continue
      const w = windowAt(wins, t); if (!w) continue
      const v = pickNum(tag, AT_VALUE); if (v == null) continue
      let arr = hrSamples.get(w.id); if (!arr) { arr = []; hrSamples.set(w.id, arr) }
      arr.push({ t, v })
      continue
    }

    const dt = pick(tag, AT_START)
    const when = dt ? parseWhen(dt) : null
    if (!when) continue

    if (type === HK.BodyMass) {
      const v = pickNum(tag, AT_VALUE); if (v == null) continue
      const u = pick(tag, AT_UNIT); if (u) bwUnit = /lb/i.test(u) ? 'lb' : 'kg'
      lastWins(bw, when.d, v, parseHKDate(dt))
    } else if (type === HK.BodyFat) {
      let v = pickNum(tag, AT_VALUE); if (v == null) continue
      // Some exports write this as a 0-1 fraction rather than 0-100 — there is no way to tell
      // which convention a given file uses except by the size of the number itself.
      if (v <= 1) v *= 100
      lastWins(bodyFat, when.d, Math.round(v * 10) / 10, parseHKDate(dt))
    } else if (type === HK.LeanMass) {
      const v = pickNum(tag, AT_VALUE); if (v == null) continue
      const u = pick(tag, AT_UNIT); if (u) leanUnit = /lb/i.test(u) ? 'lb' : 'kg'
      lastWins(leanMass, when.d, v, parseHKDate(dt))
    } else if (type === HK.Steps) {
      const v = pickNum(tag, AT_VALUE); if (v == null) continue
      addTo(steps, when.d, v, parseHKDate(dt))
    } else if (type === HK.RestingHR) {
      const v = pickNum(tag, AT_VALUE); if (v == null) continue
      lastWins(restingHR, when.d, Math.round(v), parseHKDate(dt))
    } else if (type === HK.Sleep) {
      const val = pick(tag, AT_VALUE)
      if (!val || !val.includes('Asleep')) continue   // skips "InBed" and "Awake" segments
      const endRaw = pick(tag, AT_END)
      const startMs = parseHKDate(dt), endMs = endRaw ? parseHKDate(endRaw) : null
      if (startMs == null || endMs == null || endMs <= startMs) continue
      // attributed to the date you woke up, like most sleep trackers show a night's sleep
      const wakeWhen = parseWhen(endRaw) || when
      addTo(sleep, wakeWhen.d, Math.round((endMs - startMs) / 60000), endMs)
    }
  }

  // Zone minutes: a heart-rate reading is a snapshot, so the interval it describes runs from
  // itself to whenever the next one arrives. These samples come from whatever the watch was
  // doing during S.workouts' own window, not necessarily a matching Watch workout session —
  // often just its passive background reading, which can be several minutes apart rather than
  // the few-seconds cadence of an active Watch workout. Capped at 5 minutes so a real gap (the
  // watch coming off the wrist, or the matched window running long) never reads as one
  // continuous zone, without discarding a realistic background sample as if it were one.
  const GAP_CAP_MS = 5 * 60000
  const hrZonesByWorkout = new Map()
  for (const [wid, arr] of hrSamples) {
    arr.sort((a, b) => a.t - b.t)
    let sum = 0, max = 0
    const zMs = [0, 0, 0, 0, 0]
    arr.forEach(({ t, v }, i) => {
      sum += v; if (v > max) max = v
      if (i === arr.length - 1) return
      const gap = Math.min(arr[i + 1].t - t, GAP_CAP_MS)
      if (gap > 0 && zoneCuts) zMs[bandFor(v, zoneCuts)] += gap
    })
    hrZonesByWorkout.set(wid, {
      avg: Math.round(sum / arr.length), max: Math.round(max),
      z: zoneCuts ? zMs.map(ms => Math.round(ms / 60000)) : null,
      // Which max HR the split used — 'declared' by the member or the 220 − age 'calculated' estimate.
      ...(zoneCuts ? { hrMax: Math.round(maxHR), hrMaxKind: maxHRKind || 'calculated' } : {}),
    })
  }

  // Workouts recorded by a watch or another app (Health V2 / Fitness V1): their own calories and
  // heart-rate statistics, exactly as Health stored them — lib/fitness.js's mapAppleWorkout turns
  // each into a record, and mergeImport attaches only the ones that clearly match a 2J workout.
  // Both export formats are read: <WorkoutStatistics sum/average/maximum> (iOS 16+) and the
  // older totalEnergyBurned attribute on the <Workout> itself.
  const appleWorkouts = []
  const WRE = /<Workout\b([^>]*?)(\/>|>([\s\S]*?)<\/Workout>)/g
  const AT_SOURCE = /\bsourceName="([^"]*)"/, AT_ACT = /\bworkoutActivityType="([^"]*)"/
  const AT_SUM = /\bsum="([^"]*)"/, AT_AVG = /\baverage="([^"]*)"/, AT_MAX = /\bmaximum="([^"]*)"/
  const AT_TEB = /\btotalEnergyBurned="([^"]*)"/, AT_TEBU = /\btotalEnergyBurnedUnit="([^"]*)"/
  const toKcal = (v, u) => v == null ? null : /kj/i.test(u || '') ? v / 4.184 : v   // 'Cal' and 'kcal' are both kilocalories
  let wm
  while ((wm = WRE.exec(s))) {
    const head = wm[1], body = wm[3] || ''
    const start = parseHKDate(pick(head, AT_START)), end = parseHKDate(pick(head, AT_END))
    if (start == null || end == null || end <= start) continue
    let kcal = null, avgHr = null, maxHr = null
    const SRE = /<WorkoutStatistics\b[^>]*\/?>/g
    let sm
    while ((sm = SRE.exec(body))) {
      const st = sm[0], type = pick(st, AT_TYPE)
      if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') kcal = toKcal(pickNum(st, AT_SUM), pick(st, AT_UNIT))
      else if (type === 'HKQuantityTypeIdentifierHeartRate') { avgHr = pickNum(st, AT_AVG); maxHr = pickNum(st, AT_MAX) }
    }
    if (kcal == null) kcal = toKcal(pickNum(head, AT_TEB), pick(head, AT_TEBU))
    appleWorkouts.push({ start, end, kcal, avgHr, maxHr, sourceName: pick(head, AT_SOURCE), activityType: pick(head, AT_ACT) })
  }

  const total = bw.size + bodyFat.size + leanMass.size + steps.size + sleep.size + restingHR.size + hrZonesByWorkout.size + appleWorkouts.length
  if (!total) return { error: 'unrecognised' }

  const convW = (map, fileUnit) => {
    const converted = !!fileUnit && fileUnit !== unit
    const conv = converted
      ? (fileUnit === 'lb' ? x => Math.round(x * LB_TO_KG * 10) / 10 : x => Math.round(x / LB_TO_KG * 10) / 10)
      : x => Math.round(x * 10) / 10
    return [...map.keys()].sort().map(d => ({ d, w: conv(map.get(d).v), t: map.get(d).t }))
  }
  const toSeries = map => [...map.keys()].sort().map(d => ({ d, v: map.get(d).v, t: map.get(d).t }))

  const allDates = [...bw.keys(), ...bodyFat.keys(), ...leanMass.keys(), ...steps.keys(), ...sleep.keys(), ...restingHR.keys()].sort()

  return {
    kind: 'health', source: 'Apple Health',
    bodyweight: convW(bw, bwUnit).map(({ d, w, t }) => ({ d, w, t })),
    measurements: {
      bodyFat: toSeries(bodyFat),
      // muscleMass is stored in kg (see lib/measurements.js) — lean mass converts the same way weight does
      muscleMass: convW(leanMass, leanUnit).map(({ d, w, t }) => ({ d, v: w, t })),
    },
    steps: toSeries(steps).map(p => ({ ...p, v: Math.round(p.v) })),
    sleep: toSeries(sleep),
    restingHR: toSeries(restingHR),
    hrZonesByWorkout,
    appleWorkouts,
    from: allDates[0] || null, to: allDates[allDates.length - 1] || null,
  }
}

/** Sniff the file and parse it as whatever it is. */
export function parseImport(text, opts) {
  const s = String(text)
  if (s.includes('HKQuantityTypeIdentifier') || s.includes('HKCategoryTypeIdentifier')) return parseAppleHealth(s, opts)
  if (/^\s*</.test(s)) return { error: 'unrecognised' }
  const asWorkouts = parseWorkoutCSV(s, opts)
  if (!asWorkouts.error) return asWorkouts
  const asWeights = parseBodyweight(s, opts)
  return asWeights.error ? asWorkouts : asWeights
}

/* ---------------------------------------------------------- antiduplicados ---- */
// V2: a real per-workout fingerprint, replacing the old "any workout already exists that day ⇒
// skip the whole day" rule below (still fine for "reimport the exact same file," but it also
// silently merged two genuinely different sessions that happened to land on the same date —
// see this file's own header and the session's final report for why that was worth fixing
// alongside the dedupe work, not a separate redesign).
//
// A short, deterministic, non-cryptographic hash (FNV-1a) — good enough to tell "the same
// workout" from "a different one," not a security primitive. Built from only stable fields: the
// day, the start time rounded to the minute (tolerates a second of rounding drift between two
// parses of the same export without merging two sessions a few minutes apart the same day), and
// the sorted exercise-signature+set-count. Reimporting the exact same file reproduces the exact
// same fingerprint every time; two real, different sessions on the same day essentially never
// share all three.
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0 }
  return h.toString(36)
}
// An entry's exercise id is NOT stable across two parses of the same file when that exercise
// isn't in the library: parseWorkoutCSV mints a fresh random customEx id ('im'+uid()) every
// single time it can't resolve a name, whether or not a human already resolved that exact name
// via a confirmed alias on a previous import (the alias only gets applied afterward, in
// import-match.js's applyImportResolutions). Fingerprinting by raw id would make every
// reimported workout that contains so much as one still-unresolved exercise register as "new"
// forever. Fingerprinting by NAME instead sidesteps that: a real library id's own name is stable
// (EXIDX), and an unresolved placeholder's name is exactly the CSV's own exercise-name text —
// just as stable across re-parses of the same file, unlike its id.
function entryNameOf(id, customExById) {
  const custom = customExById && customExById.get(id)
  if (custom) return custom.n
  return EXIDX[id]?.n || id
}
export function workoutFingerprint(w, customEx) {
  const customExById = customEx ? new Map(customEx.map(c => [c.id, c])) : null
  const sig = (w.entries || []).map(e => `${entryNameOf(e.id, customExById)}:${(e.sets || []).length}`).sort().join(',')
  const startBucket = Math.round((w.start || 0) / 60000)
  return fnv1a(`${w.d}|${startBucket}|${sig}`)
}

/* --------------------------------------------------------------- merge ---- */

// Same "existing day wins" de-dupe every kind of import already uses, factored out for the
// 5 daily series an Apple Health import can bring (bodyweight plus the 4 new ones below).
export function mergeSeries(existing, fresh) {
  const have = new Set((existing || []).map(x => x.d))
  const add = (fresh || []).filter(x => !have.has(x.d))
  return { list: [...(existing || []), ...add].sort((a, b) => (a.d < b.d ? -1 : 1)), added: add.length }
}

/** Merge into state. A workout whose fingerprint already exists is skipped — importing the same
 *  file twice never duplicates a workout, but two real, different sessions on the same day both
 *  come through (see workoutFingerprint's own comment for why this replaced the old
 *  date-only rule). */
export function mergeImport(S, parsed) {
  if (parsed.kind === 'health') {
    // Health V2 keeps where a body reading came from (lib/health.js's SOURCE_LABEL).
    const fromApple = list => (list || []).map(x => ({ ...x, src: 'apple' }))
    const bw = mergeSeries(S.bodyweight, fromApple(parsed.bodyweight))
    S.bodyweight = bw.list
    S.measurements = S.measurements || {}
    const bodyFat = mergeSeries(S.measurements.bodyFat, fromApple(parsed.measurements.bodyFat))
    S.measurements.bodyFat = bodyFat.list
    const muscleMass = mergeSeries(S.measurements.muscleMass, fromApple(parsed.measurements.muscleMass))
    S.measurements.muscleMass = muscleMass.list
    const steps = mergeSeries(S.steps, parsed.steps)
    S.steps = steps.list
    const sleep = mergeSeries(S.sleep, parsed.sleep)
    S.sleep = sleep.list
    const restingHR = mergeSeries(S.restingHR, parsed.restingHR)
    S.restingHR = restingHR.list

    // Only fills in workouts that don't already have a zone breakdown, so reimporting the
    // same export.xml (e.g. a newer one that just extends the date range) never recomputes or
    // overwrites what a previous import already matched.
    let hrMatched = 0
    if (parsed.hrZonesByWorkout && parsed.hrZonesByWorkout.size) {
      S.workouts.forEach(w => {
        if (w.hrZones) return
        const z = parsed.hrZonesByWorkout.get(w.id)
        if (z) { w.hrZones = z; hrMatched++ }
      })
    }

    // Watch/app workouts with their own calories and HR: attached only on a clear match
    // (lib/fitness.js's matchActivity), idempotent on reimport, never summed with another source.
    const fit = matchAll(S.workouts, (parsed.appleWorkouts || []).map(x => mapAppleWorkout(x)))
    fit.match.forEach(({ rec, workoutId }) => { const w = S.workouts.find(x => x.id === workoutId); if (w) attachFitness(w, rec) })

    return {
      bodyweight: bw.added, bodyFat: bodyFat.added, muscleMass: muscleMass.added,
      steps: steps.added, sleep: sleep.added, restingHR: restingHR.added, hrMatched,
      fitnessLinked: fit.match.length, fitnessAmbiguous: fit.ambiguous.length,
    }
  }
  if (parsed.kind === 'bodyweight') {
    const have = new Set(S.bodyweight.map(b => b.d))
    const fresh = parsed.bodyweight.filter(b => !have.has(b.d))
    S.bodyweight = [...S.bodyweight, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
    return { added: fresh.length, skipped: parsed.bodyweight.length - fresh.length }
  }
  const have = new Set()
  S.workouts.forEach(w => {
    if (w.importFingerprint) have.add(w.importFingerprint)
    have.add(workoutFingerprint(w, S.customEx))
  })
  const fresh = parsed.workouts.filter(w => {
    const sourceFingerprint = w.importFingerprint || workoutFingerprint(w, parsed.customEx)
    const resolvedFingerprint = workoutFingerprint(w, parsed.customEx)
    return !have.has(sourceFingerprint) && !have.has(resolvedFingerprint)
  })
  const used = new Set(fresh.flatMap(w => w.entries.map(e => e.id)))
  const customs = parsed.customEx.filter(c => used.has(c.id) && !EXIDX[c.id])
  S.customEx = [...(S.customEx || []), ...customs]
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
  // seed the weight suggestions from the newest imported set of each lift
  fresh.forEach(w => w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0)
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
  }))
  return { added: fresh.length, skipped: parsed.workouts.length - fresh.length }
}
