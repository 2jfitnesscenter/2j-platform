// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

// Six fixed formats rather than a configurable "build your own clock" — matches every reference
// timer app, and each mode's own screen (ClockRun.jsx) is genuinely different enough (phases,
// rounds, a manual result form) that a single generic config screen would just be a worse UI.
// `tint` is a fallback background colour, shown under the gradient for any mode whose photo
// (public/clock/<id>.jpg — real photos from the gym, not stock) hasn't been added yet.
export const CLOCK_MODES = [
  { id: 'stopwatch', icon: 'timer', title: 'Clock', desc: 'Free stopwatch for timing any block.', tint: 'var(--blue)' },
  { id: 'countdown', icon: 'clock', title: 'Countdown', desc: 'Count down from a set duration.', tint: 'var(--indigo)' },
  { id: 'tabata', icon: 'intervals', title: 'Tabata', desc: '20 seconds of work, 10 of rest, 8 rounds.', tint: 'var(--orange)' },
  { id: 'fortime', icon: 'flag', title: 'For time', desc: 'Count up until you finish or hit the cap.', tint: 'var(--red)' },
  { id: 'amrap', icon: 'infinity', title: 'AMRAP', desc: 'Count down to complete as many rounds as you can.', tint: 'var(--purple)' },
  { id: 'emom', icon: 'emom', title: 'EMOM', desc: 'Every round starts at the top of the interval.', tint: 'var(--teal)' },
]

export default function ClockPicker() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}>{t('Choose a clock')}</div>
        <div className="sub">{t('Pick the format to start now.')}</div>
      </div>
    </div>
    <div className="clock-list">
      {CLOCK_MODES.map(m => <button key={m.id} className="clock-card" onClick={() => nav('/clock/' + m.id)}
        style={{ backgroundColor: m.tint, backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.1) 0%, rgba(0,0,0,.75) 82%), url(/clock/${m.id}.jpg)` }}>
        <span className="clock-card-i"><Icon name={m.icon} /></span>
        <div>
          <div className="clock-card-t">{t(m.title)}</div>
          <div className="clock-card-d">{t(m.desc)}</div>
        </div>
      </button>)}
    </div>
  </div>
}
