// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A finished workout's guided blocks (Constructor V2.1), read back from `w.guided`: what ran, how
// it was paced, how much of it was done and what changed on the way — no per-second data exists.
import { t, nameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtClock } from '../lib/clock.js'
import { timingLine } from '../lib/guided.js'
import { TYPE_LABEL } from '../lib/protocol/index.js'
import Icon from './Icon.jsx'

const label = g => g.preset === 'tabata' ? 'Tabata' : TYPE_LABEL[g.type] || g.type

export default function GuidedSummary({ guided }) {
  if (!Array.isArray(guided) || !guided.length) return null
  return <div className="gx-sum">
    {guided.map(g => {
      const notes = [
        g.adjust ? t('time adjusted {0} s', (g.adjust > 0 ? '+' : '') + g.adjust) : null,
        g.skipped ? t('{0} skipped', g.skipped) : null,
        g.background ? t('{0} completed in the background', g.background) : null,
      ].filter(Boolean)
      return <div key={g.iid} className="gx-sum-b">
        <div className="gx-sum-h">
          <span className="gx-type"><Icon name="timer" />{t(label(g))}</span>
          <b>{g.name || t(label(g))}</b>
          <span className="gx-sum-d num">{fmtClock(g.sec || 0)}</span>
        </div>
        <div className="gx-sum-l num">
          {g.roundsPlanned > 1 ? t('{0} of {1} rounds', g.roundsDone, g.roundsPlanned) + ' · ' : ''}{t('{0} of {1} bouts', g.bouts, g.boutsPlanned)}
          {g.completed && <> · <Icon name="checkCircle" /> {t('completed')}</>}
        </div>
        <div className="gx-sum-t">{timingLine(g.timing)}</div>
        <div className="gx-sum-x">{(g.exercises || []).map(e => (EXIDX[e.id] ? nameFor(EXIDX[e.id]) : e.id) + ` ${e.done}/${e.planned}`).join(' · ')}</div>
        {notes.length > 0 && <div className="gx-sum-n">{notes.join(' · ')}</div>}
      </div>
    })}
  </div>
}
