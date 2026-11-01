// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDur, fmtNum } from '../lib/format.js'
import { fitnessOf, fitnessSources, detachFitness, SOURCE_NAME } from '../lib/fitness.js'
import { confirmSheet } from '../sheets.jsx'

// The CARDIOVASCULAR half of a workout, kept apart from its strength log: duration, calories,
// average/max heart rate and time per zone — each only if a real source provided it — and
// exactly where it came from. Zones say whether the source gave them (WHOOP's own 0-5) or 2J
// derived them from heart-rate samples against your max HR (Z1-Z5).
const ZONE_COLOR = ['var(--grey)', 'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--orange)', 'var(--red)']

export function sourceLine(rec) {
  const name = t(SOURCE_NAME[rec.source] || rec.source)
  return rec.origin ? `${name} · ${rec.origin}` : name
}

// The three zone origins must never be confused (lib/fitness.js has the model): the source's own
// zones; 2J's split against a max HR the member declared; 2J's split against the 220 − age
// ESTIMATE — said as an estimate, never as a measured max HR.
export function zoneOrigin(rec) {
  const z = rec?.zones
  if (!z) return null
  if (!z.derived || z.scheme === 'source') return t('Zones provided by {0}, as it calculated them.', t(SOURCE_NAME[rec.source] || rec.source))
  if (z.hrMaxKind === 'declared') return z.hrMax
    ? t('Zones calculated by 2J from the heart-rate samples, against the max HR you declared ({0} bpm).', z.hrMax)
    : t('Zones calculated by 2J from the heart-rate samples, against the max HR you declared.')
  if (z.hrMaxKind === 'calculated') return z.hrMax
    ? t('Zones calculated by 2J from the heart-rate samples, against an estimated max HR of {0} bpm (220 − age). It is an estimate, not a measured value.', z.hrMax)
    : t('Zones calculated by 2J from the heart-rate samples, against an estimated max HR (220 − age). It is an estimate, not a measured value.')
  return t('Zones calculated by 2J from the heart-rate samples; the max HR used was not recorded.')
}

export default function FitnessSummary({ w, editable = true }) {
  const update = useStore(s => s.update)
  const rec = fitnessOf(w)
  if (!rec) return null
  const others = fitnessSources(w).slice(1)
  const span = Number(rec.end) - Number(rec.start)
  const dur = Number.isFinite(span) && span > 0 ? span : null
  const z = rec.zones?.mins
  const total = z ? z.reduce((a, b) => a + b, 0) : 0
  const offset = rec.zones?.scheme === 'source' ? 0 : 1          // WHOOP counts from zone 0
  const colors = rec.zones?.scheme === 'source' ? ZONE_COLOR : ZONE_COLOR.slice(1)
  const unlink = r => confirmSheet({
    title: t('Unlink this data?'), message: t('The activity stays in {0}; only its link to this workout is removed.', t(SOURCE_NAME[r.source] || r.source)),
    confirmText: t('Unlink'), onConfirm: () => update(s => { const x = s.workouts.find(y => y.id === w.id); if (x) detachFitness(x, r.source, r.externalId || null) }),
  })
  return <div className="fitsum" aria-label={t('Cardiovascular')}>
    <div className="fitsum-h">{t('Cardiovascular')}</div>
    <div className="fitsum-grid">
      {dur != null && <div><span>{t('Duration')}</span><b>{fmtDur(dur)}</b></div>}
      {rec.calories > 0 && <div><span>{t('Calories')}</span><b>{fmtNum(rec.calories)} kcal</b></div>}
      {rec.avgHr > 0 && <div><span>{t('Avg HR')}</span><b>{rec.avgHr} {t('bpm')}</b></div>}
      {rec.maxHr > 0 && <div><span>{t('Session max HR')}</span><b>{rec.maxHr} {t('bpm')}</b></div>}
    </div>
    {z && total > 0 && <>
      <div className="fitsum-bar" role="img" aria-label={z.map((m, i) => `Z${i + offset} ${m} min`).join(', ')}>
        {z.map((m, i) => m > 0 && <i key={i} style={{ width: (m / total * 100) + '%', background: colors[i] }} />)}
      </div>
      <div className="fitsum-zones">{z.map((m, i) => m > 0 && <span key={i}><i style={{ background: colors[i] }} />Z{i + offset} {t('{0} min', m)}</span>)}</div>
      <div className="dim small fitsum-zsrc">{zoneOrigin(rec)}</div>
    </>}
    <div className="fitsum-src">
      <span>{t('Source')}: <b>{sourceLine(rec)}</b>{rec.kind === 'measured' ? ' · ' + t('measured live') : ' · ' + t('imported')}</span>
      {editable && w.fitness && <button onClick={() => unlink(rec)}>{t('Unlink')}</button>}
    </div>
    {others.length > 0 && <div className="dim small">{t('Also seen by: {0} (not added up)', others.map(sourceLine).join(', '))}</div>}
  </div>
}
