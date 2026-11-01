// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The three Home indicators (Training · Activity · Recovery), derived only from data the member already has.
// Visibility = admin 'activity' switch ∧ member preference ∧ data presence (lib/features.js decides the first two; this
// module decides the third: an indicator with nothing real behind it is simply not returned).
// They are visual, not diagnostic: `value` is a 0–1 arc ONLY when a real denominator exists (a plan; the muscle-load model),
// otherwise null and the ring is a plain state ring with the figure — never an invented percentage and never a "readiness score".
// `basis` is the plain-language statement of where the figure comes from, shown when the member opens the indicator.
import { weekKey, todayISO } from './format.js'
import { activeWeek } from './history.js'
import { recoveryOf, overallRecovery, recoveryColor } from './recovery.js'
import { dailyActivity, getBridge, platformLabel } from './health-bridge.js'
import { uxOn } from './features.js'

export function trainingIndicator(S, iso = todayISO()) {
  const done = (S.workouts || []).filter(w => weekKey(w.d) === weekKey(iso)).length
  const planned = Object.values(activeWeek(S)).filter(Boolean).length
  if (!planned && !done) return null
  return { key: 'training', label: 'Training', icon: 'dumbbell', color: 'var(--acc)',
    value: planned ? Math.min(1, done / planned) : null, text: planned ? `${done}/${planned}` : String(done), done, planned,
    basis: planned ? 'Sessions you logged this week out of the sessions your plan has for the week.' : 'Sessions you logged this week. You have no weekly plan, so there is no target to fill.' }
}

export function activityIndicator(uid, now = Date.now()) {
  const a = dailyActivity(uid, now)
  if (!a || (a.steps == null && a.activeKcal == null)) return null
  const platform = platformLabel(getBridge())
  const common = { key: 'activity', label: 'Activity', icon: 'figureRun', color: 'var(--orange)', value: null, at: a.at || null, platform,
    basis: 'Read from {0} on this device at the last sync. 2J shows the figure; it sets no target.' }
  return a.steps != null
    ? { ...common, text: new Intl.NumberFormat().format(a.steps), unit: 'steps' }
    : { ...common, text: String(a.activeKcal), unit: 'kcal' }
}

export function recoveryIndicator(S) {
  if (!(S.workouts || []).length) return null   // nothing to recover from yet
  const v = overallRecovery(recoveryOf(S))
  return { key: 'recovery', label: 'Recovery', icon: 'bolt', color: recoveryColor(v), value: v / 100, text: v + '%',
    basis: 'An estimate of muscle load from the sets you logged and how long ago. It is not a medical reading and not a WHOOP score.' }
}

/** [] when the indicators are off (admin or member) or when no indicator has data. */
export function homeIndicators(S, uid, now = Date.now()) {
  if (!uxOn(S, 'activity')) return []
  return [
    trainingIndicator(S),
    uxOn(S, 'health') ? activityIndicator(uid, now) : null,
    uxOn(S, 'recovery') ? recoveryIndicator(S) : null,
  ].filter(Boolean)
}
