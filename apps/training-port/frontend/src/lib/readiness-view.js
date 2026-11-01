// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// What the member's app feeds into lib/fatigue.js beyond the log itself: muscle recovery (lib/recovery.js) and weekly volume against its landmarks
// (lib/rp-volume.js), each only when there is real training behind it. Everything else (sleep, check-ins, effort) is read from the state by fatigue.js.
// A source that cannot be read is simply left out — the readiness works without any of them, and without a wearable.
import { readiness, deloadProposal, activeDeload, fatigueState } from './fatigue.js'
import { recoveryOf, overallRecovery } from './recovery.js'
import { weeklyGroupVolumeFinished, landmarksFor, zoneForVolume } from './rp-volume.js'
import { MUSCLE_GROUPS } from './muscles.js'
import { t } from './i18n.js'

const DAY = 86400000
export function readinessContext(S, today) {
  const ctx = {}
  const from = new Date(Date.parse(today + 'T12:00:00Z') - 7 * DAY).toISOString().slice(0, 10)
  const trained = (S?.workouts || []).some(w => w?.d >= from && w.d <= today)
  if (trained) {
    try { ctx.recovery = overallRecovery(recoveryOf(S)) } catch { /* recovery is optional */ }
    try {
      const vol = weeklyGroupVolumeFinished(S)
      let over = 0, high = 0
      for (const g of MUSCLE_GROUPS) {
        const z = zoneForVolume(vol[g.key] || 0, landmarksFor(S, g.key))
        if (z === 'mrv') over++; else if (z === 'mav') high++
      }
      ctx.volume = { over, high }
    } catch { /* volume landmarks are optional */ }
  }
  return ctx
}

/** { readiness, fatigue, proposal, active } for the member's cards; readiness is null when there is nothing real to base it on. */
export function readinessView(S, today) {
  const ctx = readinessContext(S, today)
  return { readiness: readiness(S, today, ctx), fatigue: fatigueState(S, today, ctx), proposal: deloadProposal(S, today, ctx), active: activeDeload(S, today) }
}

export const STATE_LABEL = { push: 'Good to push', maintain: 'Keep steady', adjust: 'Adjust today', recover: 'Deload / recover' }
export const STATE_HINT = {
  push: 'A good day to go for your top sets.',
  maintain: 'Train as planned.',
  adjust: 'Take it a bit easier today: stop each set with 2–3 reps left.',
  recover: 'Prioritise recovery: lighter work or a rest day.',
}

/** One sentence per reason ({ code, signal, n, hours, pct }) — real numbers only. */
export function reasonLine(r) {
  const c = r.code === 'signal' ? r.signal : r.code
  switch (c) {
    case 'sleep_good': return t('You have slept about {0} h on average.', r.hours)
    case 'sleep_ok': return t('Sleep is around {0} h — fine.', r.hours)
    case 'sleep_low': case 'sleep': return t('Sleep has averaged {0} h lately.', r.hours)
    case 'recovery_good': case 'recovery_ok': return t('Your muscles are {0}% recovered.', r.pct)
    case 'recovery_low': case 'recovery': return t('Muscle recovery is at {0}%.', r.pct)
    case 'checkin_good': return t('You reported good energy today.')
    case 'checkin_low': return t('You reported low energy today.')
    case 'checkin_tired': return t('You reported feeling tired today.')
    case 'headroom': return t('Your last {0} sessions felt clearly easy.', r.n)
    case 'fatigue_elevated': return t('There are some signs of building fatigue.')
    case 'fatigue_high': return t('Several signals point the same way.')
    case 'effort_up': return t('The same loads feel harder.')
    case 'hard': return t('Your recent sessions felt hard.')
    case 'misses': return t('Missed reps or sets keep repeating.')
    case 'incomplete': return t('Recent sessions were cut short.')
    case 'checkins': return t('You have reported high fatigue several days.')
    case 'volume': return t('Weekly volume is at the upper limit for some muscle groups.')
    default: return ''
  }
}
