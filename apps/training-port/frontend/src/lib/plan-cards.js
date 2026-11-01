// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Library V3 — what a routine / program CARD shows, derived only from data the member already has (their routines, programs, week plan and
// history). Nothing is invented: a figure that cannot be derived is null and the card simply does not draw it.
import { DAYS, isoOf } from './format.js'
import { programProgress } from './guided-programs.js'

export const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }
const pad = n => String(n).padStart(2, '0')
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const setsOf = e => { const n = Array.isArray(e?.sets) ? e.sets.length : Number(e?.sets); return Number.isFinite(n) && n > 0 ? n : 0 }

/** 'trainer' (assigned/edited by staff: it carries a version history), '2j' (a copy of an official 2J routine), 'own'. */
export function routineSource(r, S) {
  if (S?.routineVersions?.[r?.id]?.length) return 'trainer'
  if (/^r2j[pc]-/.test(String(r?.id || '')) || r?.copiedFrom || r?.official) return '2j'
  return 'own'
}

/** Rough session length, derived from its sets and rest (45 s of work per set + the prescribed rest, 90 s when none). Null without sets. */
export function estimateMinutes(ex = []) {
  let sec = 0, sets = 0
  for (const e of ex) {
    const n = setsOf(e); sets += n
    const rest = Number(e?.rest) > 0 ? Number(e.rest) : 90
    sec += n * (45 + rest)
  }
  return sets ? Math.max(5, Math.round(sec / 60 / 5) * 5) : null
}

/** Next day (today included, within a week) on which this routine is planned in the week plan: { inDays, day } or null. */
export function nextPlannedDay(routineId, S, now = new Date()) {
  const week = S?.week || {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12)
    if (week[d.getDay()] === routineId) return { inDays: i, day: DAYS[d.getDay()] }
  }
  return null
}

export function routineMeta(r, S, now = new Date()) {
  const ex = Array.isArray(r?.ex) ? r.ex : []
  const mine = (S?.workouts || []).filter(w => w.routineId === r?.id)
  const last = mine.reduce((m, w) => (w.d > m ? w.d : m), '')
  const sets = ex.reduce((n, e) => n + setsOf(e), 0)
  return {
    source: routineSource(r, S), fav: !!r?.fav,
    goal: r?.meta?.goal || null, level: r?.meta?.level || null,
    exercises: ex.length, sets: sets || null, minutes: estimateMinutes(ex),
    daysPerWeek: Object.values(S?.week || {}).filter(id => id === r?.id).length || null,
    next: nextPlannedDay(r?.id, S, now), done: mine.length, lastDone: last || null,
  }
}

/**
 * A program as a plan. Official 2J programs (source 'guided-v2') use their own session model (weeks, sessions, next session);
 * a personal program is a set of routines: progress = routines trained this week, next = the first one not trained yet.
 * state: 'active' | 'saved' | 'completed'.
 */
export function programMeta(p, S, now = new Date()) {
  const routines = (S?.routines || []).filter(r => (p?.routineIds || []).includes(r.id))
  const active = S?.activeProgramId === p?.id
  if (p?.source === 'guided-v2') {
    const g = programProgress(p, S?.workouts || [])
    const completed = p.status === 'completed' || (g.total > 0 && g.completed >= g.total)
    return { kind: 'official', state: completed ? 'completed' : active || p.status === 'active' ? 'active' : 'saved',
      weeks: p.weeksCount || null, perWeek: p.sessionsPerWeek || null, total: g.total, done: g.completed, percent: g.percent, nextSession: g.next || null,
      currentWeek: g.next ? g.next.weekIndex + 1 : p.weeksCount || null, level: p.level || null, goal: p.goal || null }
  }
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 12)
  const from = ymd(monday), to = ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12))
  const trained = new Set((S?.workouts || []).filter(w => w.d >= from && w.d <= to).map(w => w.routineId))
  const done = routines.filter(r => trained.has(r.id)).length
  const next = routines.find(r => !trained.has(r.id)) || null
  return { kind: 'personal', state: active ? 'active' : 'saved', weeks: null, perWeek: Object.keys(p?.week || {}).length || null,
    total: routines.length, done, percent: routines.length ? Math.round(done * 100 / routines.length) : 0, nextRoutine: next, level: p?.meta?.level || null, goal: p?.meta?.goal || null }
}

export const DAY_LABEL = DAYS
export { isoOf }
