// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { recoveryOf, overallRecovery, recoveryColor } from '../lib/recovery.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { useUI } from '../store/useUI.js'
import RecoveryRing from './RecoveryRing.jsx'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import Icon from './Icon.jsx'

// Full-screen expansion of the compact card's own map — same colorOf, just big enough to tap a
// muscle and read its exact recovery %, the way Home's own last-workout map already does for
// set counts (views/Home.jsx's WorkoutBodyMapModal — same 'full' sheet kind, same reasoning).
function RecoveryBodyMapModal({ S, colorOf, recovery, close }) {
  const [sel, setSel] = useState(null)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Muscle recovery')}</h1></div>
    </div>
    <div className="card">
      <BodyMap className="tappable" colorOf={colorOf} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v" style={{ color: recoveryColor(recovery[sel] ?? 100), fontWeight: 700 }}>{Math.round(recovery[sel] ?? 100)}%</span>
      </div>}
    </div>
  </div>
}

/**
 * Muscle recovery — an estimate of how ready each muscle group is, from logged sets (see
 * lib/recovery.js). The ring gives the one number that matters at a glance; the coloured
 * manikin is the same red/yellow/green map /recovery itself uses, just without its legend or
 * the per-muscle % list — tapping through is the only way to get those, on purpose, so the card
 * stays a glance rather than a second copy of the detail screen. Shared by Home and Stats
 * (Progress) rather than each keeping its own copy of this teaser.
 *
 * `compact`: Home's own half-width grid card — a shrunk map (index.css's .home-bodymap-sm) and
 * a tap that opens the full map in a 'full' sheet instead of navigating to /recovery, matching
 * the same "expand in place" pattern Home's own last-workout map already uses. Stats.jsx keeps
 * the original full-width, navigate-to-/recovery behaviour by simply not passing it.
 */
export default function RecoveryCard({ nav, S, compact }) {
  const recovery = recoveryOf(S)
  const overall = overallRecovery(recovery)
  const colorOf = slug => recoveryColor(recovery[slug] ?? 100)
  const expand = () => useUI.getState().openSheet(close => <RecoveryBodyMapModal S={S} colorOf={colorOf} recovery={recovery} close={close} />, { kind: 'full' })

  if (compact) {
    return <div className="card home-half tappable" style={{ cursor: 'pointer' }} onClick={expand}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="home-half-ttl">{t('Recovery')}</div>
        <span className="home-half-pill" style={{ color: recoveryColor(overall), borderColor: recoveryColor(overall) }}>{Math.round(overall)}%</span>
      </div>
      <div className="home-bodymap-sm"><BodyMap colorOf={colorOf} body={S.body} /></div>
    </div>
  }

  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/recovery')}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 2px' }}>{t('Muscle recovery')}</h2>
        <div className="muted small">{t('See which muscles are ready to train')}</div>
      </div>
      <RecoveryRing value={overall} size={58} stroke={6} />
    </div>
    <BodyMap colorOf={colorOf} body={S.body} />
  </div>
}
