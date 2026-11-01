// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { MUSCLE_GROUPS, MUSCLE_NAME, muscleOptsOf } from '../lib/muscles.js'
import {
  LEVELS, weeklyGroupVolume, monthlyGroupVolume, groupVolumeForWeek, weekRangeLabel,
  landmarksFor, zoneForVolume, ZONE_META, zoneCounts,
} from '../lib/rp-volume.js'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

// slug → parent muscle-group key, built once — the heatmap paints each of the 18 body-map
// slugs by its group's own zone, since RP Volume Zones only ever classifies at the group
// level (lib/rp-volume.js's own rollupToGroups is the same collapse, the other direction).
const SLUG_TO_GROUP = {}
MUSCLE_GROUPS.forEach(g => g.slugs.forEach(s => { SLUG_TO_GROUP[s] = g.key }))

// How many of the last 5 natural weeks the historical matrix shows — current week (offset 0)
// plus the four before it, same range the spec's own mockup dates walk through.
const WEEK_OFFSETS = [0, 1, 2, 3, 4]

// Progress → tap the weekly volume card. Weekly/monthly toggle, a body-map heatmap coloured
// by each group's current zone, a 5-week history table, and a mesocycle diagnostic tally.
// The 5-week matrix is the one piece expensive enough to matter (it scans finished workouts
// for 5 separate weeks) — memoized on S.workouts/opts so scrolling this screen never
// recomputes it, per the spec's own "no heavy recompute during scroll" requirement.
export default function RpVolumeStats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [period, setPeriod] = useState('week')
  const [sel, setSel] = useState(null)
  const opts = muscleOptsOf(S)
  const level = LEVELS.includes(S.trainingLevel) ? S.trainingLevel : 'intermediate'

  const volume = period === 'week' ? weeklyGroupVolume(S, opts) : monthlyGroupVolume(S, opts)
  const counts = zoneCounts(S, volume)

  const matrix = useMemo(() => WEEK_OFFSETS.map(offset => ({
    offset, label: weekRangeLabel(offset), volume: groupVolumeForWeek(S, offset, opts),
  })), [S.workouts, S.active, S.trainingLevel, S.rpVolumeOverrides, opts.countSecondary, opts.secondaryFactor])

  const colorOf = slug => {
    const gKey = SLUG_TO_GROUP[slug]
    const zone = zoneForVolume(volume[gKey] || 0, landmarksFor(S, gKey))
    return ZONE_META[zone].color
  }
  const selG = sel && MUSCLE_GROUPS.find(g => g.key === SLUG_TO_GROUP[sel])
  const selSets = selG ? Math.round((volume[selG.key] || 0) * 10) / 10 : 0
  const selZone = selG ? zoneForVolume(selSets, landmarksFor(S, selG.key)) : null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Volume analytics')}</h1></div>
      <button className="iconbtn" onClick={() => nav('/settings/rp-volume')} aria-label={t('Calibrate volume zones')}><Icon name="gear" /></button>
    </div>

    <Segmented className="seg-range" value={period} onChange={v => { setPeriod(v); setSel(null) }}
      options={[{ value: 'week', label: t('Weekly') }, { value: 'month', label: t('Monthly') }]} />

    <div className="card">
      <h2>{t('Body map')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {period === 'week' ? t('this week') : t('monthly average')}</span></h2>
      <BodyMap className="tappable" body={S.body} colorOf={colorOf} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <div className="hm-legend" style={{ flexWrap: 'wrap' }}>
        {['below', 'mv', 'mev', 'mav', 'mrv'].map(z => (
          <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: ZONE_META[z].color, display: 'inline-block' }} />
            <span className="small dim">{ZONE_META[z].code === '—' ? t('Under') : ZONE_META[z].code}</span>
          </span>
        ))}
      </div>
      {selG ? <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(selG.name)}</b></span>
        <span className="v" style={{ color: ZONE_META[selZone].color, fontWeight: 700 }}>
          {t('{0} sets · Zone {1}', fmtNum(selSets), ZONE_META[selZone].code === '—' ? t('Under') : ZONE_META[selZone].code)}
        </span>
      </div> : <div className="muted small" style={{ marginTop: 8 }}>{t('Tap a muscle to see its exact count and zone.')}</div>}
    </div>

    <div className="card">
      <h2>{t('Mesocycle status')}</h2>
      <div className="mrow"><span className="nm">{t('In MAV — optimal')}</span><span className="v" style={{ color: ZONE_META.mav.color, fontWeight: 700 }}>{counts.mav}</span></div>
      <div className="mrow"><span className="nm">{t('Under-trained — below MEV')}</span><span className="v" style={{ color: ZONE_META.mv.color, fontWeight: 700 }}>{counts.below + counts.mv}</span></div>
      <div className="mrow"><span className="nm">{t('At or over MRV')}</span><span className="v" style={{ color: ZONE_META.mrv.color, fontWeight: 700 }}>{counts.mrv}</span></div>
      <div className="muted small" style={{ marginTop: 10 }}>{t('Out of 12 muscle groups, {0} training level.', t(level[0].toUpperCase() + level.slice(1)))}</div>
    </div>

    <div className="card">
      <h2>{t('Last 5 weeks')}</h2>
      <div className="rpmatrix-wrap">
        <table className="rpmatrix">
          <thead>
            <tr><th />{matrix.map(m => <th key={m.offset}>{m.label}</th>)}</tr>
          </thead>
          <tbody>
            {MUSCLE_GROUPS.map(g => (
              <tr key={g.key}>
                <th scope="row">{t(g.name)}</th>
                {matrix.map(m => {
                  const sets = Math.round((m.volume[g.key] || 0) * 10) / 10
                  const zone = zoneForVolume(sets, landmarksFor(S, g.key))
                  const meta = ZONE_META[zone]
                  return <td key={m.offset} style={{ color: meta.color }}>{meta.code === '—' ? '·' : meta.code} {fmtNum(sets)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
}
