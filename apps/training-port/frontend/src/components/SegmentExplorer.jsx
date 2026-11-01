// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { MUSCLES, INERT } from '../lib/muscles.js'
import { segmentSummary } from '../lib/health.js'
import { useBodyPaths } from './BodyMap.jsx'
import { ZONES } from './SegmentBodyDiagram.jsx'

// The scan's five segments on the same body illustration Measurements uses: tap an arm, the
// trunk or a leg → the figure zooms onto it and shows that segment's latest fat and muscle and
// how they changed over the chosen period. Deliberately NEUTRAL — no green/orange/red: the scan's
// segment fat is a ratio against its own reference band and 2J has no validated per-segment
// target, so colouring it would invent a verdict. Always labelled, never colour-only.
const ZONE_OF = { segFatArmL: 'armL', segFatArmR: 'armR', segFatTrunk: 'trunk', segFatLegL: 'legL', segFatLegR: 'legR' }
const change = (m, unit) => m?.delta == null ? null : (m.delta > 0 ? '+' : m.delta < 0 ? '−' : '±') + fmtNum(Math.abs(m.delta)) + ' ' + unit

export default function SegmentExplorer({ S, range }) {
  const paths = useBodyPaths()
  const [sel, setSel] = useState(null)
  const body = S.body === 'female' ? 'female' : 'male'
  const front = paths && (paths[body] || paths.male)?.front
  const segs = segmentSummary(S, range)
  const byKey = Object.fromEntries(segs.map(s => [s.key, s]))
  const zone = sel ? ZONES.find(z => ZONE_OF[z.fatKey] === sel) : null
  // Zoom: a crop of the full figure around the chosen segment's own landmark.
  const [vx, vy, vw, vh] = (front?.vb || '0 0 727 1466').split(' ').map(Number)
  const vb = zone ? (() => {
    const w = sel === 'trunk' ? vw * 0.62 : vw * 0.5, h = sel === 'trunk' ? vh * 0.42 : vh * 0.38
    const x = Math.max(vx, Math.min(vx + vw - w, zone.dot[0] - w / 2)), y = Math.max(vy, Math.min(vy + vh - h, zone.dot[1] - h / 2))
    return `${x} ${y} ${w} ${h}`
  })() : front?.vb
  const s = sel ? byKey[sel] : null

  return <div className="segx card">
    <div className="segx-fig">
      {front ? <svg viewBox={vb} className={'segx-svg' + (sel ? ' zoom' : '')} role="img" aria-label={t('Body composition by segment')}>
        {INERT.map(slug => (front.p[slug] || []).map((d, i) => <path key={slug + i} className="bm-sil" d={d} />))}
        {MUSCLES.map(slug => (front.p[slug] || []).map((d, i) => <path key={slug + i} className="bm-m" d={d} />))}
        {ZONES.map(z => {
          const key = ZONE_OF[z.fatKey], has = byKey[key]?.has
          return <g key={key} className={'segx-hit' + (sel === key ? ' on' : '') + (has ? '' : ' empty')}
            role="button" tabIndex={0} aria-label={t(byKey[key].label)} aria-pressed={sel === key}
            onClick={() => setSel(sel === key ? null : key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(sel === key ? null : key) } }}>
            <circle cx={z.dot[0]} cy={z.dot[1]} r={sel === key ? 26 : 34} className="segx-dot" />
            <circle cx={z.dot[0]} cy={z.dot[1]} r="9" className="segx-core" />
          </g>
        })}
      </svg> : <div className="sbd-ph" aria-hidden="true" />}
    </div>
    {s ? <div className="segx-detail" aria-live="polite">
      <div className="segx-h"><b>{t(s.label)}</b><button className="segx-back" onClick={() => setSel(null)}>{t('Whole body')}</button></div>
      {!s.has ? <div className="dim small">{t('No reading for this segment yet.')}</div> : <div className="segx-rows">
        {s.muscle && <div className="segx-row"><span className="segx-k">{t('Muscle')}</span>
          <span className="segx-v">{fmtNum(s.muscle.current.v)} kg</span>
          <span className="segx-c">{change(s.muscle, 'kg') ?? t('No change to show in this period')}</span></div>}
        {s.fat && <div className="segx-row"><span className="segx-k">{t('Fat')}</span>
          <span className="segx-v">{fmtNum(s.fat.current.v)} %</span>
          <span className="segx-c">{change(s.fat, t('pts')) ?? t('No change to show in this period')}</span></div>}
        <div className="dim small">{t('Latest reading: {0}', fmtDate((s.muscle || s.fat).current.d, true))} · {t('Segment fat is the scan’s ratio against its own reference range, not kg.')}</div>
      </div>}
    </div> : <div className="dim small segx-hint">{t('Tap an arm, the trunk or a leg to see it in detail.')}</div>}
  </div>
}
