// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// 2J Story — the week / month as a shareable card. It picks what to show from what EXISTS (a new member gets workouts, minutes and
// muscles; an advanced one volume, records, streak, programme) and never fills gaps with "no data".
// PRIVACY: weight / composition appear only if the member explicitly includes them (includeBody). Health, recovery, WHOOP data,
// restrictions, private notes and provider ids are never read here.
import { periodSummary } from './progress-v3.js'
import { describeEvent } from '../components/Mi2JEvents.jsx'

const STAT_PRIORITY = ['minutes', 'volume', 'sets', 'prs', 'streak']

export function buildStory(S, period, { includeBody = false } = {}) {
  const p = periodSummary(S, period)
  if (p.empty) return { period, range: p.range, empty: true }
  const pool = {
    minutes: p.minutes > 0 && { key: 'minutes', v: p.minutes, unit: 'min' },
    volume: p.volume > 0 && { key: 'volume', v: Math.round(p.volume), unit: S.unit, delta: p.prevVolume ? Math.round((p.volume - p.prevVolume) / p.prevVolume * 100) : null },
    sets: p.sets > 0 && { key: 'sets', v: p.sets },
    prs: p.prs > 0 && { key: 'prs', v: p.prs, gold: true },
    streak: p.streak >= 2 && { key: 'streak', v: p.streak, gold: true },
  }
  const stats = STAT_PRIORITY.map(k => pool[k]).filter(Boolean).slice(0, 4)
  let highlight = null
  if (p.advance) { const d = describeEvent(p.advance, S.unit); highlight = { kind: p.advance.type, title: d.title, value: d.result || d.detail, gold: ['pr', 'e1rm', 'badge', 'global', 'rank'].includes(p.advance.type) } }
  const program = S.activeProgramId ? (S.programs || []).find(x => x.id === S.activeProgramId && !['paused', 'abandoned', 'completed'].includes(x.status)) : null
  return {
    period, range: p.range, empty: false,
    hero: { value: p.workouts, prev: p.prevWorkouts },
    stats, muscles: p.muscles, highlight, program: program ? program.name : null,
    body: includeBody && p.weight ? { delta: p.weight.delta, unit: S.unit } : null,
    canIncludeBody: !!p.weight,
  }
}
