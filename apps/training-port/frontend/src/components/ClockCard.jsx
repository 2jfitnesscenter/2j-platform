// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// One timer's display + transport controls (Start / Pause / Resume / Reset) — the same three-
// state shape (idle → running → paused-resumable) fits every use of lib/clock.js's countdown or
// stopwatch: the reference timer inside a test session, and every Reloj mode.
export default function ClockCard({ icon, title, subtitle, big, running, onStart, onPauseResume, onReset, resumable, children }) {
  return <div className="card" style={{ marginBottom: 14, textAlign: 'center' }}>
    {(icon || title) && <div className="row" style={{ justifyContent: 'flex-start', textAlign: 'left', marginBottom: 10 }}>
      {icon && <span className="lrow-i"><Icon name={icon} /></span>}
      <div className="grow"><div className="tt">{title}</div><div className="ss">{subtitle}</div></div>
    </div>}
    <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-.02em', margin: '6px 0 14px' }}>{big}</div>
    {children}
    <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
      {!running && !resumable && <Button variant="primary" icon="play" onClick={onStart}>{t('Start')}</Button>}
      {!running && resumable && <><Button variant="primary" icon="play" onClick={onPauseResume}>{t('Resume')}</Button>
        <Button icon="reset" onClick={onReset}>{t('Reset')}</Button></>}
      {running && <><Button icon="pause" onClick={onPauseResume}>{t('Pause')}</Button>
        <Button icon="reset" onClick={onReset}>{t('Reset')}</Button></>}
    </div>
  </div>
}
