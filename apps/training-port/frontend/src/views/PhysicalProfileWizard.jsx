// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { latestBodyWeight } from '../lib/bodyweight.js'
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { applyNewProfileDefaults } from '../lib/workout-prefs.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, RulerSlider } from '../components/ui.jsx'

/* Shown once, right after a brand-new profile creates its passkey (see App.jsx's Shell and
   hasPhysicalData) — the same fields Login.jsx's RegisterSheet used to cram into one sheet
   before the passkey even existed, now their own short wizard. Nothing here is required: "Skip
   for now" ends it immediately without writing anything, same "none of this can block using the
   app" philosophy as before. Finishing normally writes everything at once, same as
   RegisterSheet.go() used to. */

const STEPS = ['sex', 'birthdate', 'height', 'weight', 'muscles']
// pxPerUnit is tuned per unit so a drag feels like roughly the same physical distance whether
// the ruler is counting kg (fine steps) or lb (coarser steps covering a wider range).
const KG_RANGE = { min: 30, max: 250, step: 0.5, majorEvery: 10, pxPerUnit: 14 }
const LB_RANGE = { min: 66, max: 550, step: 1, majorEvery: 20, pxPerUnit: 7 }
const kgToLb = kg => Math.round(kg * 2.20462 * 10) / 10
const lbToKg = lb => Math.round(lb / 2.20462 * 10) / 10

export default function PhysicalProfileWizard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [step, setStep] = useState(0)
  const [p, setP] = useState(() => ({
    sex: S.body === 'female' ? 'female' : 'male',
    birthDate: S.birthDate || '',
    height: S.height || 170,
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    weight: latestBodyWeight(S)?.w ?? (S.unit === 'lb' ? 154 : 70),
    primary: S.priorityMuscles || [],
    secondary: S.secondaryMuscles || []
  }))
  const set = patch => setP(v => ({ ...v, ...patch }))

  const key = STEPS[step]
  const last = step === STEPS.length - 1
  const range = p.unit === 'lb' ? LB_RANGE : KG_RANGE

  const changeUnit = u => {
    if (u === p.unit) return
    set({ unit: u, weight: u === 'lb' ? kgToLb(p.weight) : lbToKg(p.weight) })
  }

  const togglePrimary = m => set({
    primary: p.primary.includes(m) ? p.primary.filter(x => x !== m) : p.primary.length < 2 ? [...p.primary, m] : p.primary,
    secondary: p.secondary.filter(x => x !== m)
  })
  const toggleSecondary = m => set({
    secondary: p.secondary.includes(m) ? p.secondary.filter(x => x !== m) : p.secondary.length < 3 ? [...p.secondary, m] : p.secondary,
    primary: p.primary.filter(x => x !== m)
  })

  // `skip` ends the wizard without writing any of the (possibly untouched, default-valued)
  // fields — only "Finish" after actually stepping through commits them, all at once.
  // Either way out is the one moment this profile is provably new — the only place the
  // roadmap's new-account defaults are written (lib/workout-prefs.js).
  const skip = () => update(s => { applyNewProfileDefaults(s); s.onboarded = true; s.uxSetup = true })
  const finish = () => update(s => {
    s.body = p.sex
    if (p.birthDate) s.birthDate = p.birthDate
    s.height = Math.round(p.height)
    s.unit = p.unit
    const iso = todayISO()
    const w = Math.round(p.weight * 10) / 10
    const existing = s.bodyweight.find(b => b.d === iso)
    if (existing) { existing.w = w; existing.t = Date.now(); existing.src = 'manual' } else s.bodyweight.push({ d: iso, w, t: Date.now(), src: 'manual' })
    s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    if (p.primary.length) s.priorityMuscles = p.primary
    if (p.secondary.length) s.secondaryMuscles = p.secondary
    applyNewProfileDefaults(s)
    s.onboarded = true
    s.uxSetup = true   // next: the short visual setup of what this person wants from 2J (views/ExperienceSetup.jsx)
  })

  return <div className="narrow" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: 86 }}>
    <div className="row between" style={{ marginBottom: 18 }}>
      {step > 0
        ? <button className="iconbtn" onClick={() => setStep(step - 1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
        : <div style={{ width: 36 }} />}
      <Button size="sm" variant="tinted" onClick={skip}>{t('Skip for now')}</Button>
    </div>

    <h1 style={{ fontSize: 26, lineHeight: 1.15, marginBottom: 2 }}>{t('Physical profile')}</h1>
    <div className="sub" style={{ marginBottom: 16 }}>{t('Step {0} of {1}', step + 1, STEPS.length)}</div>

    <div className="row" style={{ gap: 5, marginBottom: 28 }}>
      {STEPS.map((s, i) => <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= step ? 'var(--acc)' : 'var(--surface-3)' }} />)}
    </div>

    <div style={{ flex: 1 }}>
      {key === 'sex' && <>
        <h2 style={{ marginTop: 0 }}>{t('What is your sex?')}</h2>
        <div className="muted small" style={{ marginBottom: 18 }}>{t('Used for the body diagram and to personalize training calculations.')}</div>
        <Segmented options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={p.sex} onChange={v => set({ sex: v })} />
      </>}

      {key === 'birthdate' && <>
        <h2 style={{ marginTop: 0 }}>{t('When were you born?')}</h2>
        <div className="muted small" style={{ marginBottom: 18 }}>{t('Used to personalize training calculations.')}</div>
        <input type="date" className="input" value={p.birthDate} max={todayISO()} onChange={e => set({ birthDate: e.target.value })} />
      </>}

      {key === 'height' && <>
        <h2 style={{ marginTop: 0 }}>{t('What is your height?')}</h2>
        <div className="muted small" style={{ marginBottom: 24 }}>{t('We use your height to personalize training calculations.')}</div>
        <RulerSlider value={p.height} min={100} max={230} step={1} majorEvery={10} pxPerUnit={12}
          unit="cm" decimals={0} onChange={v => set({ height: v })} />
      </>}

      {key === 'weight' && <>
        <h2 style={{ marginTop: 0 }}>{t('What is your weight?')}</h2>
        <div className="muted small" style={{ marginBottom: 16 }}>{t('We use your weight to personalize training and calculations.')}</div>
        <div style={{ marginBottom: 24 }}>
          <Segmented options={[{ value: 'kg', label: t('Kilograms (kg)') }, { value: 'lb', label: t('Pounds (lb)') }]} value={p.unit} onChange={changeUnit} />
        </div>
        <RulerSlider value={p.weight} min={range.min} max={range.max} step={range.step} majorEvery={range.majorEvery}
          pxPerUnit={range.pxPerUnit} unit={p.unit} decimals={range.step < 1 ? 1 : 0} onChange={v => set({ weight: v })} />
      </>}

      {key === 'muscles' && <>
        <h2 style={{ marginTop: 0 }}>{t('Training priorities')}</h2>
        <div className="muted small" style={{ marginBottom: 18 }}>{t('Optional. The quick plan and the AI Coach give these a little more work than the rest.')}</div>
        <div className="card">
          <h4 className="sec" style={{ marginTop: 0 }}>{t('What do you want to prioritize? (up to 2)')}</h4>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {MUSCLES.map(m => <button key={m} className={'chip lg' + (p.primary.includes(m) ? ' on' : '')} onClick={() => togglePrimary(m)}>{t(MUSCLE_LABEL[m])}</button>)}
          </div>
          <div className="divider" />
          <h4 className="sec" style={{ marginTop: 0 }}>{t('Anything else? (up to 3)')}</h4>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {MUSCLES.map(m => {
              const isPrimary = p.primary.includes(m)
              return <button key={m} className={'chip lg' + (p.secondary.includes(m) ? ' on' : '')} disabled={isPrimary}
                style={isPrimary ? { opacity: .35 } : undefined} onClick={() => toggleSecondary(m)}>{t(MUSCLE_LABEL[m])}</button>
            })}
          </div>
        </div>
      </>}
    </div>

    <div className="wizard-footer flush">
      <Button variant="primary" onClick={() => last ? finish() : setStep(step + 1)}>
        {last ? t('Finish') : t('Continue')}
      </Button>
    </div>
  </div>
}
