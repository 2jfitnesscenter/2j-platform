// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_GROUPS, muscleOptsOf } from '../lib/muscles.js'
import { LEVELS, RP_VOLUME_DEFAULTS, landmarksFor, clampLandmark, weeklyGroupVolume } from '../lib/rp-volume.js'
import { confirmSheet } from '../sheets.jsx'
import RpVolumeBar from '../components/RpVolumeBar.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

// The five thresholds in the order they tile the bar (lib/rp-volume.js's own ZONE_ORDER),
// each one editable independently — clampLandmark is what actually enforces mv<=mev<mav<mrvMin<=mrvMax,
// this table is just what a stepper's own label says.
const FIELDS = [
  { key: 'mv', label: 'MV min' },
  { key: 'mev', label: 'MEV min' },
  { key: 'mav', label: 'MAV min' },
  { key: 'mrvMin', label: 'MRV min' },
  { key: 'mrvMax', label: 'MRV max' },
]

// A stepper with no free-text entry (unlike ui.jsx's own Stepper) — every change to a
// muscle's landmarks has to pass through clampLandmark, so typing an arbitrary number that
// breaks mv<=mev<mav<mrvMin<=mrvMax simply isn't a path that exists here.
function LandmarkStepper({ label, value, onDec, onInc }) {
  return (
    <div className="stp-w">
      <span className="stp-l">{label}</span>
      <div className="stp">
        <button onClick={onDec} aria-label={t('Decrease')}><Icon name="minus" /></button>
        <span className="val"><span className="num">{value}</span></span>
        <button onClick={onInc} aria-label={t('Increase')}><Icon name="plus" /></button>
      </div>
    </div>
  )
}

// Settings → Weekly volume zones → Calibrate, and the same screen from the Progress card's
// own configure button (RpVolumeStats.jsx). Per-muscle overrides live in S.rpVolumeOverrides,
// keyed exactly like RP_VOLUME_DEFAULTS[level] — landmarksFor already reads an override first,
// so nothing else in the app needs to know whether a muscle is on the level default or a
// hand-tuned value.
export default function RpVolumeCalibration() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const level = LEVELS.includes(S.trainingLevel) ? S.trainingLevel : 'intermediate'
  const volume = weeklyGroupVolume(S, muscleOptsOf(S))
  const hasAnyOverride = Object.keys(S.rpVolumeOverrides || {}).length > 0

  const nudge = (key, field, delta) => update(s => {
    const lm = (s.rpVolumeOverrides && s.rpVolumeOverrides[key]) || RP_VOLUME_DEFAULTS[level][key]
    if (!s.rpVolumeOverrides) s.rpVolumeOverrides = {}
    s.rpVolumeOverrides[key] = clampLandmark(lm, field, delta)
  })
  const resetOne = key => update(s => { if (s.rpVolumeOverrides) delete s.rpVolumeOverrides[key] })
  const resetAll = () => confirmSheet({
    title: t('Reset all to level defaults?'),
    message: t('Removes every muscle’s custom thresholds — all 12 go back to the {0} defaults.', t(level[0].toUpperCase() + level.slice(1))),
    confirmText: t('Reset all'), danger: true,
    onConfirm: () => update(s => { s.rpVolumeOverrides = {} }),
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Calibrate volume zones')}</h1></div>
    </div>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Fine-tune each muscle group’s own weekly-set thresholds instead of the {0} defaults.', t(level[0].toUpperCase() + level.slice(1)))}
    </div>
    {hasAnyOverride && <div style={{ marginBottom: 14 }}>
      <Button size="sm" icon="reset" variant="ghost" onClick={resetAll}>{t('Reset all to level defaults')}</Button>
    </div>}
    {MUSCLE_GROUPS.map(g => {
      const lm = landmarksFor(S, g.key)
      const overridden = !!(S.rpVolumeOverrides && S.rpVolumeOverrides[g.key])
      const sets = Math.round((volume[g.key] || 0) * 10) / 10
      return <div className="card" key={g.key}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t(g.name)}</h2>
          {overridden && <Button size="sm" variant="ghost" icon="reset" onClick={() => resetOne(g.key)}>{t('Reset')}</Button>}
        </div>
        <RpVolumeBar groupName={t(g.name)} sets={sets} landmarks={lm} />
        <div className="row cfgrow rp-cal-steppers">
          {FIELDS.map(f => (
            <LandmarkStepper key={f.key} label={t(f.label)} value={lm[f.key]}
              onDec={() => nudge(g.key, f.key, -1)}
              onInc={() => nudge(g.key, f.key, 1)} />
          ))}
        </div>
      </div>
    })}
  </div>
}
