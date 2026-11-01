// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Seguimiento V3 (member) — one page that gathers what the member's own data and the gym's existing follow-up already say: the current goal, how the
// last weeks went, the next review, today's check-in, the coach's latest notes and plan changes by staff. Every block is null when there is nothing
// real to show (the screen then simply omits it); nothing is scored or judged.
import { todayISO } from './format.js'
import { followUpView } from './followup-view.js'
import { checkinOn } from './checkin.js'
import { pendingReviews } from './routine-review.js'

const DAY = 86400000
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }
const iso = ms => new Date(ms).toISOString().slice(0, 10)
const addDays = (d, n) => iso(Date.parse(d + 'T12:00:00Z') + n * DAY)

export function followupDigest(S, fu, today = todayISO()) {
  const workouts = S?.workouts || []
  const last28From = addDays(today, -27), prev28From = addDays(today, -55), prev28To = addDays(today, -28)
  const recent = workouts.filter(w => w.d >= last28From && w.d <= today)
  const prior = workouts.filter(w => w.d >= prev28From && w.d <= prev28To)
  const planned = Object.values(S?.week || {}).filter(Boolean).length || null
  const perWeek = recent.length ? Math.round(recent.length / 4 * 10) / 10 : 0

  const goalKey = S?.coach?.profile?.goal || null
  const goal = goalKey && GOAL_LABEL[goalKey] ? GOAL_LABEL[goalKey] : null

  const view = followUpView(fu, S, today)
  const todayCheckin = checkinOn(S, today)
  const week = (S?.checkins || []).filter(c => c.d >= addDays(today, -6) && c.d <= today)

  // Coach: the newest log entry that carries notes or decisions.
  const log = Array.isArray(S?.coach?.log) ? S.coach.log : []
  const entry = [...log].reverse().find(e => (e.notes || []).length || (e.decisions || []).length) || null
  const coach = entry ? { at: entry.at || null, summary: entry.summary || null, notes: (entry.notes || []).slice(0, 3), applied: (entry.decisions || []).filter(d => d.status === 'accepted').length } : null

  // Plan changes by staff in the last 30 days (assigned routines/programs keep a version history).
  const changes = []
  for (const kind of ['routineVersions', 'programVersions']) {
    const list = kind === 'routineVersions' ? S?.routines || [] : S?.programs || []
    for (const [id, versions] of Object.entries(S?.[kind] || {})) {
      const last = Array.isArray(versions) ? versions[versions.length - 1] : null
      const at = last?.versionedAt
      if (at && at >= Date.parse(addDays(today, -30) + 'T00:00:00Z')) {
        const item = list.find(x => x.id === id)
        if (item) changes.push({ id, name: item.name, kind: kind === 'routineVersions' ? 'routine' : 'program', at })
      }
    }
  }
  changes.sort((a, b) => b.at - a.at)

  const out = {
    goal,
    evolution: workouts.length ? {
      workouts: recent.length, perWeek, planned,
      prevWorkouts: prior.length ? prior.length : null,       // only a real previous stretch is a comparison
      weight: view?.weight || null,
    } : null,
    review: view,                      // null when the gym runs no follow-up for this member
    checkin: { today: todayCheckin, week, asked: true },
    coach,
    changes: changes.slice(0, 3),
    reviews: pendingReviews(S || {}, today).slice(0, 2),   // routine reviews due now (lib/routine-review.js); never edits a routine
  }
  out.empty = !out.goal && !out.evolution && !out.review && !out.coach && !out.changes.length && !out.reviews.length && !week.length && !todayCheckin
  return out
}
