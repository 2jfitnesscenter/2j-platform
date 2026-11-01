// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, useMemo } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtDate, fmtVol } from '../lib/format.js'
import { progressTimeline, healthTimeline } from '../lib/timeline.js'
import { fmtNum } from '../lib/format.js'
import { describeEvent } from './Mi2JEvents.jsx'
import { workoutDetailSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

/* Progress timeline (optional module — admin 'timeline' ∧ member preference ∧ data): the latest sessions, newest first,
   each with what it earned. Records are gold (the one place gold is allowed here), everything else uses the accent.
   Pure read of S.workouts; tapping a session opens the same detail sheet as everywhere else. */
// `health`: also the member's real body moments (relevant weight changes, composition scans), as in the Health screen.
export default function ProgressTimeline({ S, max = 6, health = false }) {
  const items = useMemo(() => health ? healthTimeline(S, { max }) : progressTimeline(S, { max }), [S.workouts, S.badges, S.ux, S.bodyweight, S.measurements, max, health])
  if (!items.length) return null
  return <div className="card v2-tl">
    <h2>{t('Progress timeline')}</h2>
    <ol className="v2-tl-list">
      {items.map((it, i) => {
        const month = it.d.slice(0, 7), newMonth = i === 0 || items[i - 1].d.slice(0, 7) !== month
        const head = newMonth ? <li key={'m' + month + i} className="v3-tl-month" aria-hidden="true">{new Date(it.d + 'T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })}</li> : null
        if (it.kind === 'weight' || it.kind === 'scan') return <Fragment key={it.id}>{head}<li className="v2-tl-item v2-rise" style={{ animationDelay: Math.min(i, 5) * 40 + 'ms' }}>
          <span className="v2-tl-dot" aria-hidden="true" />
          <div className="v2-tl-main"><span className="v2-tl-date">{fmtDate(it.d, true)}</span>
            <span className="v2-tl-name">{it.kind === 'weight' ? t('Weight {0}', fmtNum(it.v) + ' ' + S.unit) : t('New body-composition reading')}</span>
            <span className="v2-tl-sub">{it.kind === 'weight' ? (it.delta > 0 ? '+' : '−') + fmtNum(Math.abs(it.delta)) + ' ' + S.unit + ' · ' + t('since the previous reading') : t('{0} measurements', it.count)}</span></div>
        </li></Fragment>
        const w = S.workouts.find(x => x.id === it.id)
        return <Fragment key={it.id}>{head}<li className="v2-tl-item v2-rise" style={{ animationDelay: Math.min(i, 5) * 40 + 'ms' }}>
          <span className={'v2-tl-dot' + (it.events.some(e => e.type === 'pr') ? ' gold' : '')} aria-hidden="true" />
          <button type="button" className="v2-tl-main" onClick={() => w && workoutDetailSheet(w)}>
            <span className="v2-tl-date">{fmtDate(it.d, true)}</span>
            <span className="v2-tl-name">{it.name}</span>
            <span className="v2-tl-sub">{t('{0} sets · {1}', it.sets, fmtVol(it.vol, S.unit))}</span>
          </button>
          {it.events.slice(0, 3).map(ev => {
            const d = describeEvent(ev, S.unit)
            return <div key={ev.id} className={'v2-tl-ev' + (['pr', 'e1rm', 'streak', 'badge'].includes(ev.type) ? ' gold' : '')}>
              <Icon name={d.icon || (ev.type === 'badge' ? 'medal' : 'chartLine')} />
              <span className="min0"><b>{d.title}</b>{d.result ? ' · ' + d.result : ''}</span>
            </div>
          })}
        </li></Fragment>
      })}
    </ol>
  </div>
}
