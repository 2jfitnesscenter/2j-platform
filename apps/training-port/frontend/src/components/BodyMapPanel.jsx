// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import { muscleDetail } from '../lib/health-v2.js'
import MuscleDetailCard from './MuscleDetailCard.jsx'

/* The premium body map: front + back, shading by how hard each muscle was worked, a tap-to-read detail and the
   "most worked" ranking. Presentational and reusable (Post-workout, Progress, Health V2): it takes the same `load`
   ({ slug: effective sets }) BodyMap already takes and invents nothing — the ranking and the numbers are that load.
   Changing `load` (e.g. another period) re-shades the same paths with a CSS transition, so there is no flash. */
// With `S` the tapped muscle opens its depth card (this week, last session, frequency, comparison with last week); without it the
// panel behaves as before (a one-line count). `S` is only ever read.
export default function BodyMapPanel({ load = {}, body = 'male', top = 3, unitLabel, className = '', selectable = true, S = null }) {
  const [sel, setSel] = useState(null)
  const sets = m => Math.round((load[m] || 0) * 10) / 10
  const ranked = useMemo(() => Object.entries(load).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), [load])
  const max = ranked.length ? ranked[0][1] : 0
  const fmt = v => unitLabel ? unitLabel(v) : t('{0} sets', v)
  const detail = S && sel ? muscleDetail(S, sel) : null
  if (!ranked.length) return null
  return <div className={'v2-bmp ' + className}>
    <div className="v2-bmp-map">
      <BodyMap className={'bm-premium' + (selectable ? ' tappable' : '')} load={load} body={body} selected={sel}
        onMuscle={selectable ? m => setSel(s => (s === m ? null : m)) : undefined} />
      <div className="v2-bmp-cap" aria-hidden="true"><span>{t('Front view')}</span><span>{t('Back view')}</span></div>
    </div>
    <BodyMapLegend />
    <ul className="v2-bmp-rank" aria-label={t('Most worked muscles')}>
      {ranked.slice(0, top).map(([m, v]) => <li key={m} className={sel === m ? 'on' : ''}>
        <button type="button" onClick={() => selectable && setSel(s => (s === m ? null : m))} aria-pressed={sel === m}>
          <span className="nm">{t(MUSCLE_NAME[m])}</span>
          <span className="bar"><i style={{ width: Math.max(8, Math.round(v / max * 100)) + '%' }} /></span>
          <span className="v">{fmt(sets(m))}</span>
        </button>
      </li>)}
    </ul>
    {detail && <MuscleDetailCard detail={detail} unit={S.unit} />}
    {!detail && sel && !ranked.slice(0, top).some(([m]) => m === sel) && <div className="v2-bmp-sel">
      <b>{t(MUSCLE_NAME[sel])}</b><span>{sets(sel) ? fmt(sets(sel)) : t('not trained')}</span>
    </div>}
  </div>
}
