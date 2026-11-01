// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Progress V3 — the story of the last week / month, computed ONLY from the member's own log. Every comparison needs a real previous
// period with data; every figure is a count, a sum or a difference. No scores, no "improving / worsening" verdicts.
import { isoOf } from './format.js'
import { orderedBodyWeightSeries } from './bodyweight.js'
import { setsDone, streakWeeks } from './history.js'
import { loadOfWorkouts, muscleOptsOf, rankOf, MUSCLE_NAME } from './muscles.js'
import { postWorkoutEvents } from './mi2j.js'
import { progressionWorkouts } from './workout-policy.js'

const pad = n => String(n).padStart(2, '0')
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

/** { from, to, prevFrom, prevTo, days } as ISO dates. week = Monday..Sunday; month = calendar month. `elapsed` = days already lived in the period. */
export function periodRange(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  if (period === 'week') {
    const from = new Date(today); from.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const to = new Date(from); to.setDate(from.getDate() + 6)
    const pf = new Date(from); pf.setDate(from.getDate() - 7)
    const pt = new Date(from); pt.setDate(from.getDate() - 1)
    return { from: ymd(from), to: ymd(to), prevFrom: ymd(pf), prevTo: ymd(pt), days: 7, elapsed: Math.round((today - from) / 864e5) + 1 }
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1, 12)
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12)
  const pf = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)
  const pt = new Date(today.getFullYear(), today.getMonth(), 0, 12)
  return { from: ymd(from), to: ymd(to), prevFrom: ymd(pf), prevTo: ymd(pt), days: to.getDate(), elapsed: today.getDate() }
}

const inRange = (w, a, b) => w.d >= a && w.d <= b
const sum = (ws, f) => ws.reduce((n, w) => n + (f(w) || 0), 0)
const minutesOf = w => (w.end > w.start && w.end - w.start < 6 * 3600e3 ? (w.end - w.start) / 60000 : 0)
const safe = (fn, d) => { try { return fn() } catch { return d } }

/**
 * The period at a glance. `prev*` fields are null unless the previous period has data to compare against, so a screen can
 * show "vs 9 last month" only when it is true. `weight` is the change between the first and last weigh-in INSIDE the period
 * (needs two readings). `advance` is the most notable thing earned in the period (a record, achievement or rank).
 */
export function periodSummary(S, period, now = new Date()) {
  const r = periodRange(period, now)
  const all = S.workouts || []
  // Like for like: while the period is still running, it is compared with the same stretch of the previous one (first 4 days of this
  // month vs first 4 days of last month), never with a whole finished period.
  const pd = new Date(r.prevFrom + 'T12:00:00'); pd.setDate(pd.getDate() + r.elapsed - 1)
  const prevTo = r.elapsed >= r.days ? r.prevTo : (ymd(pd) < r.prevTo ? ymd(pd) : r.prevTo)
  const ws = all.filter(w => inRange(w, r.from, r.to)), pws = all.filter(w => inRange(w, r.prevFrom, prevTo))
  const performanceWs = progressionWorkouts(ws), previousPerformanceWs = progressionWorkouts(pws)
  const volume = sum(performanceWs, w => w.vol), pvolume = sum(previousPerformanceWs, w => w.vol)
  const load = safe(() => loadOfWorkouts(performanceWs, null, muscleOptsOf(S)), {})
  const muscles = performanceWs.length ? rankOf(load).worked.slice(0, 3) : []
  let advance = null, prs = 0
  ws.slice(-12).forEach(w => {
    const evs = safe(() => postWorkoutEvents(S, w.id), [])
    prs += evs.filter(e => e.type === 'pr').length
    const best = evs.filter(e => e.type !== 'streak').sort((a, b) => a.priority - b.priority)[0]
    if (best && (!advance || best.priority < advance.priority || (best.priority === advance.priority && w.d > advance.d))) advance = { ...best, d: w.d }
  })
  const bw = orderedBodyWeightSeries(S).filter(b => b.d >= r.from && b.d <= r.to)
  const weight = bw.length >= 2 ? { delta: Math.round((bw[bw.length - 1].w - bw[0].w) * 10) / 10, from: bw[0].d } : null
  const weeksElapsed = r.elapsed / 7
  return {
    period, range: r, workouts: ws.length, prevWorkouts: pws.length ? pws.length : null,
    minutes: Math.round(sum(ws, minutesOf)), sets: sum(performanceWs, w => safe(() => setsDone(w), 0)),
    volume: volume || null, prevVolume: volume && pvolume ? pvolume : null,
    prs, advance, muscles: muscles.map(slug => ({ slug, name: MUSCLE_NAME[slug], sets: Math.round((load[slug] || 0) * 10) / 10 })),
    streak: streakWeeks(S), weight,
    perWeek: ws.length && weeksElapsed >= 2 ? Math.round(ws.length / weeksElapsed * 10) / 10 : null,
    empty: ws.length === 0,
  }
}
