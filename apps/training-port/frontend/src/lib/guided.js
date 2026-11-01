// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Guided blocks (Constructor V2.1) — the pure half of the timed executor for circuit, interval,
// HIIT/Tabata and mobility blocks. Not a second training system: a guided block is ordinary
// entries of the live session (S.active.entries, a round = one set of each), and this module only
// decides the ORDER and PACE they are done in — prepare → work → rest → next → next round → end.
//
// What lives in S.active (local only — Sync V2 never takes `active` from a save, and it is only
// written on phase changes, never per tick):
//   active.guidedBlocks  snapshot of the day's guided block labels ({ iid, name, type, timing })
//   active.guided        the run in progress: { iid, i, endsAt, left, paused, startedAt, adjust,
//                        skipped, bg, sound, vibrate } — `endsAt` is a wall-clock end time, so a
//                        refresh, a locked screen or a backgrounded tab resumes from the clock,
//                        never from counted ticks (same trick as the rest timer in useUI.js)
//   active.guidedLog     one summary per finished block → the finished workout's `guided`
import { isGuided, sanitizeTiming } from './protocol/index.js'
import { modeOf } from './history.js'
import { t } from './i18n.js'

/** The day's guided block labels worth snapshotting into a live session. */
export const guidedBlocksOf = routine => (routine?.blocks || [])
  .filter(b => b && b.iid && isGuided(b.type))
  .map(b => ({ iid: b.iid, name: b.name || null, type: b.type, timing: sanitizeTiming(b.timing, b.type) }))

/** The guided block a session entry belongs to, if any. */
export function guidedBlockFor(active, entryIdx) {
  const blk = active?.entries?.[entryIdx]?.target?.blk
  return blk ? (active.guidedBlocks || []).find(b => b.iid === blk) || null : null
}
/** Indices of the session entries of one block instance, in order. */
export const entriesOf = (active, iid) => (active?.entries || []).map((e, i) => e.target?.blk === iid ? i : -1).filter(i => i >= 0)

/**
 * The run as a list of steps. Work steps point at one set of one entry; a reps entry's work has
 * no clock (sec: null — done when the member says so). Rest after the last bout of a round is the
 * block's `roundRest` when it has one, else its normal `rest`; nothing follows the final bout.
 */
export function buildSteps(active, block) {
  const tm = sanitizeTiming(block.timing, block.type)
  const idx = entriesOf(active, block.iid)
  if (!tm || !idx.length) return []
  const rounds = Math.max(...idx.map(i => active.entries[i].sets.length))
  const steps = []
  if (tm.prep > 0) steps.push({ k: 'prep', sec: tm.prep })
  for (let r = 0; r < rounds; r++) {
    const inRound = idx.filter(i => active.entries[i].sets[r])
    inRound.forEach((i, pos) => {
      const e = active.entries[i]
      const timed = modeOf({ ...(e.target || {}), id: e.id }) === 'time'
      steps.push({ k: 'work', e: i, s: r, round: r + 1, sec: timed ? Math.max(1, Number(e.sets[r].sec || e.target?.sec || tm.work)) : null })
      const lastOfRound = pos === inRound.length - 1
      if (lastOfRound && r === rounds - 1) return
      const sec = lastOfRound ? (tm.roundRest > 0 ? tm.roundRest : tm.rest) : tm.rest
      if (sec > 0) steps.push({ k: lastOfRound && tm.roundRest > 0 ? 'roundRest' : 'rest', sec, round: r + 1 })
    })
  }
  return steps
}
export const roundsOf = steps => steps.reduce((m, s) => Math.max(m, s.round || 0), 0)

/** Where a (re)started block begins: its first unfinished bout, with the countdown before it. */
export function firstStep(active, steps) {
  const w = steps.findIndex(s => s.k === 'work' && !active.entries[s.e].sets[s.s].done)
  if (w < 0) return -1
  const prepAt = steps.findIndex(s => s.k === 'prep')
  return w === steps.findIndex(s => s.k === 'work') && prepAt >= 0 ? prepAt : w
}

const armed = (step, now) => step && step.sec ? now + step.sec * 1000 : null

/** A fresh run of one block (nothing written to the entries yet). */
export function startRun(active, block, prefs = {}, now = Date.now()) {
  const steps = buildSteps(active, block)
  const i = firstStep(active, steps)
  if (i < 0) return null
  return { iid: block.iid, i, endsAt: armed(steps[i], now), left: null, paused: false, startedAt: now, adjust: 0, skipped: 0, bg: 0,
    sound: prefs.sound !== false, vibrate: prefs.vibrate !== false }
}

/**
 * Move on from the current step. `done` marks a work step's set as completed (a timed bout logs
 * the seconds actually run); a skipped bout stays unchecked. Returns { run, marks, finished } —
 * `marks` are the sets to check off in the session; the caller writes them with the run.
 */
export function advance(run, steps, { done = true, now = Date.now(), from = null } = {}) {
  const cur = steps[run.i]
  const marks = []
  let skipped = run.skipped
  if (cur?.k === 'work') {
    if (done) marks.push({ e: cur.e, s: cur.s, sec: cur.sec })
    else skipped++
  }
  const next = run.i + 1
  if (next >= steps.length) return { run: { ...run, skipped, i: steps.length, endsAt: null }, marks, finished: true }
  // A step that ended while nobody was looking starts from when it should have, not from now.
  const base = from ?? now
  return { run: { ...run, skipped, i: next, endsAt: armed(steps[next], base), left: null, paused: false }, marks, finished: false }
}

export function pause(run, now = Date.now()) {
  if (!run || run.paused || run.endsAt == null) return run
  return { ...run, paused: true, left: Math.max(1, Math.ceil((run.endsAt - now) / 1000)), endsAt: null }
}
export function resume(run, now = Date.now()) {
  if (!run || !run.paused) return run
  return { ...run, paused: false, endsAt: now + (run.left || 1) * 1000, left: null }
}
/** ±seconds on the running step (never below one second left); recorded as a modification. */
export function adjustTime(run, d, now = Date.now()) {
  if (!run) return run
  if (run.paused) return { ...run, left: Math.max(1, (run.left || 1) + d), adjust: run.adjust + d }
  if (run.endsAt == null) return run
  return { ...run, endsAt: Math.max(now + 1000, run.endsAt + d * 1000), adjust: run.adjust + d }
}

/**
 * Catch up after a refresh, a locked screen or a backgrounded tab: every timed step whose end has
 * passed is completed in order, each next one timed from when the previous really ended. Stops at
 * a reps bout (it needs the member), at a paused step, or at the end. `bg` counts the bouts that
 * completed this way, so the summary can say so.
 */
export function catchUp(run, steps, now = Date.now()) {
  let r = run, marks = [], finished = false, n = 0
  while (r && !r.paused && r.endsAt != null && r.endsAt <= now && r.i < steps.length) {
    // Only a bout that ended well before this tick was missed; one ending on screen is not.
    const missed = steps[r.i].k === 'work' && now - r.endsAt > 2000
    const out = advance(r, steps, { done: true, now, from: r.endsAt })
    marks = marks.concat(out.marks)
    if (missed) n++
    r = out.run
    if (out.finished) { finished = true; break }
  }
  return { run: n ? { ...r, bg: (r.bg || 0) + n } : r, marks, finished }
}

/** What stays in history for one guided block — enough to read it back, no per-second data. */
export function summarize(active, block, run, steps, now = Date.now()) {
  const tm = sanitizeTiming(block.timing, block.type)
  const idx = entriesOf(active, block.iid)
  const work = steps.filter(s => s.k === 'work')
  const doneBouts = work.filter(s => active.entries[s.e].sets[s.s].done)
  const roundsDone = [...new Set(doneBouts.map(s => s.round))].filter(r => work.filter(s => s.round === r).every(s => active.entries[s.e].sets[s.s].done)).length
  return {
    iid: block.iid, name: block.name || null, type: block.type, ...(tm.preset ? { preset: tm.preset } : {}),
    timing: { work: tm.work, rest: tm.rest, rounds: tm.rounds, roundRest: tm.roundRest },
    roundsPlanned: roundsOf(steps), roundsDone,
    bouts: doneBouts.length, boutsPlanned: work.length,
    exercises: idx.map(i => ({ id: active.entries[i].id, done: active.entries[i].sets.filter(s => s.done).length, planned: active.entries[i].sets.length })),
    sec: Math.max(0, Math.round((now - (run?.startedAt ?? now)) / 1000)),
    ...(run?.adjust ? { adjust: run.adjust } : {}),
    ...(run?.skipped ? { skipped: run.skipped } : {}),
    ...(run?.bg ? { background: run.bg } : {}),
    completed: doneBouts.length === work.length,
  }
}

/** "40 s work · 20 s rest · 3 rounds · 90 s between rounds" */
export function timingLine(tm) {
  if (!tm) return ''
  const parts = [t('{0} s work', tm.work), tm.rest ? t('{0} s rest', tm.rest) : t('no rest')]
  if (tm.rounds > 1) parts.push(t('{0} rounds', tm.rounds))
  if (tm.rounds > 1 && tm.roundRest > 0) parts.push(t('{0} s between rounds', tm.roundRest))
  return parts.join(' · ')
}
