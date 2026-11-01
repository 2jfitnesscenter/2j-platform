// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { exCount, routineCount, supersetCount, unavailableCount, daysScheduledCount } from '../lib/format.js'
import { routineSummaryOf } from '../lib/superset-colors.js'

// V3 — compact "exercises · supersets · unavailable" subtitle for a routine list row, so a
// trainer or member can gauge what's inside without opening it. Parts with a zero count are
// omitted entirely rather than shown as "0 ...". Version/date is left out until routine
// versioning (V3.5-7) actually exists — nothing to show yet, and inventing a fake one isn't
// the goal.
export function RoutineSummaryLine({ r }) {
  const sum = routineSummaryOf(r.ex)
  return <>
    {exCount(sum.exCount)}
    {sum.superGroups > 0 && <> · {supersetCount(sum.superGroups)}</>}
    {sum.unavailable > 0 && <> · <span style={{ color: 'var(--orange)' }}>{unavailableCount(sum.unavailable)}</span></>}
  </>
}

// Same idea for a program row: how many routines, how many weekdays are actually scheduled,
// and how many of its exercises (summed across its own routines) are currently unavailable.
export function ProgramSummaryLine({ p, routines }) {
  const days = Object.keys(p.week || {}).length
  const list = routines.filter(r => (p.routineIds || []).includes(r.id))
  const unavailable = list.reduce((n, r) => n + routineSummaryOf(r.ex).unavailable, 0)
  return <>
    {routineCount((p.routineIds || []).length)}
    {days > 0 && <> · {daysScheduledCount(days)}</>}
    {unavailable > 0 && <> · <span style={{ color: 'var(--orange)' }}>{unavailableCount(unavailable)}</span></>}
  </>
}
