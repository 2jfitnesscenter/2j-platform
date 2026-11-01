// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The words for a routine-review notice (lib/routine-review.js decides; this only phrases the numbers behind it). Shared by the member card and the staff list.
import { t } from './i18n.js'
import { exCount, fmtDate } from './format.js'

/** One short sentence for a reason { code, n, of, week }. */
export function reasonText(r) {
  switch (r.code) {
    case 'date': return t('Review date set by staff: {0}.', fmtDate(r.due))
    case 'week': return t('Week {0} with this routine — time to review it.', r.week)
    case 'stalled': return t('No progress in {0} of {1} exercises over their last 3 sessions.', r.n, r.of)
    case 'misses': return t('Missed reps or sets repeated in {0}.', exCount(r.n))
    case 'effort_up': return t('The same loads feel harder in {0}.', exCount(r.n))
    case 'hard': return t('{0} of your last 3 sessions felt hard.', r.n)
    case 'incomplete': return t('{0} of your last 3 sessions were cut short.', r.n)
    default: return ''
  }
}

/** Why this routine is up for review: the numbers, then a note when it was brought forward. At most `max` sentences. */
export function reviewReasons(review, max = 3) {
  const list = (review.reasons || []).map(r => r.code === 'week' && review.kind === 'program' ? t('Week {0} with this program — time to review it.', r.week) : reasonText(r)).filter(Boolean)
  if (review.early) list.unshift(t('Brought forward: the data shows a plateau.'))
  return list.slice(0, max)
}

/** The single line a staff list shows for the alert. */
export const reviewAlertText = a => a.kind === 'program'
  ? t('Program review: {0} (week {1})', a.name || '—', a.week)
  : t('Routine review: {0} (week {1})', a.name || '—', a.week)
