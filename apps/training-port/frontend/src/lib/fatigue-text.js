// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The one line the staff list shows for the accumulated-fatigue signal: counts and names of the real signals behind it, nothing else.
import { t } from './i18n.js'

/** Short names of the fatigue signals, for the staff list. */
export const SIGNAL_NAME = {
  effort_up: 'harder effort at the same loads', hard: 'hard sessions', misses: 'repeated misses', incomplete: 'sessions cut short',
  checkins: 'high-fatigue check-ins', sleep: 'low sleep', recovery: 'low muscle recovery', volume: 'volume at the limit',
}
export const fatigueAlertText = a => t('Accumulated fatigue is high: {0}.', (a.signals || []).map(s => t(SIGNAL_NAME[s.code] || s.code)).join(', ')) + (a.proposed ? ' ' + t('A deload has been proposed to the member.') : '')
