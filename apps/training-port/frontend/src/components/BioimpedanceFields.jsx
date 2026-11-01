// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { Segmented } from './ui.jsx'
import MeasurementField from './MeasurementField.jsx'
import { MEASUREMENT } from '../lib/measurements.js'

const FAT_UNIT_OPTIONS = [{ value: 'canonical', label: '%' }, { value: 'alt', label: 'kg' }]
const MUSCLE_UNIT_OPTIONS = [{ value: 'canonical', label: 'kg' }, { value: 'alt', label: '%' }]
const OTHER_KEYS = ['waterPct', 'visceralFat', 'boneMass']
const SEG_FAT_KEYS = ['segFatTrunk', 'segFatArmL', 'segFatArmR', 'segFatLegL', 'segFatLegR']
const SEG_MUSCLE_KEYS = ['segMuscleTrunk', 'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR']

// A section header carrying its own %/kg Segmented — "Grasa"/"Masa muscular" each get exactly
// one (spec: "un conmutador... en la cabecera de las secciones"), governing every field under
// it (whole-body and segmental alike) rather than one toggle per field.
function SectionHeader({ title, options, mode, onChange }) {
  return <div className="row between" style={{ margin: '14px 0 8px', alignItems: 'center' }}>
    <span className="sec" style={{ margin: 0 }}>{title}</span>
    <Segmented className="seg-inline" options={options} value={mode} onChange={onChange} />
  </div>
}

/**
 * The composition/segments(+folds) fields shared by the member-facing "Scan a report" sheet
 * (sheets.jsx's BioimpedanceScanSheet) and Admin's staff version (Admin.jsx's
 * BioimpedanceSheet) — same grouping and %/kg toggle behaviour in both, so they can't quietly
 * drift apart. `vals`/`setVal` are always in each measurement's canonical unit (see
 * lib/measurements.js — what's actually written to S.measurements); `unitMode`/`setUnitMode`
 * are { fat, muscle }, S.measurementUnitMode's own shape. `resetToken` changes (e.g. after an
 * AI scan replaces `vals` wholesale) force every field to remount and resync from the new
 * canonical values instead of clinging to stale locally-typed text.
 *
 * The section mode is passed to every field in it, segFat* included — harmless there, since
 * MeasurementField only ever acts on it when the measurement actually has an altUnit, and
 * segFat* deliberately doesn't (see lib/measurements.js's comment on why).
 */
export default function BioimpedanceFields({ vals, setVal, weightKg, unitMode, setUnitMode, showFolds = false, resetToken = 0 }) {
  const field = (key, mode) => (
    <MeasurementField key={key + ':' + resetToken} m={MEASUREMENT[key]} value={vals[key]} onChange={v => setVal(key, v)}
      bodyweightKg={weightKg} unitMode={mode} />
  )
  return <>
    <SectionHeader title={t('Fat')} options={FAT_UNIT_OPTIONS} mode={unitMode.fat} onChange={v => setUnitMode('fat', v)} />
    {field('bodyFat', unitMode.fat)}
    <SectionHeader title={t('Muscle mass')} options={MUSCLE_UNIT_OPTIONS} mode={unitMode.muscle} onChange={v => setUnitMode('muscle', v)} />
    {field('muscleMass', unitMode.muscle)}

    <div className="sec" style={{ margin: '14px 0 8px' }}>{t('Other')}</div>
    {OTHER_KEYS.map(k => field(k, 'canonical'))}

    <div className="sec" style={{ margin: '14px 0 8px' }}>{t('By segment')}</div>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Segmental fat is a % against the standard range for that body part — not a share of its weight, so it has no kg equivalent to switch to.')}
    </div>
    {SEG_FAT_KEYS.map(k => field(k, unitMode.fat))}
    {SEG_MUSCLE_KEYS.map(k => field(k, unitMode.muscle))}

    {showFolds && <>
      <div className="sec" style={{ margin: '14px 0 8px' }}>{t('Skinfolds (calipers)')}</div>
      {['skinTriceps', 'skinSubscapular', 'skinSuprailiac', 'skinAbdominal'].map(k => field(k, 'canonical'))}
    </>}
  </>
}
