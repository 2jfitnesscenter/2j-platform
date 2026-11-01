// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX, imgSrc } from '../lib/exercises.js'
import { workoutPrefs } from '../lib/workout-prefs.js'
import { t, nameFor } from '../lib/i18n.js'
import BarbellPlates from './BarbellPlates.jsx'
import Icon from './Icon.jsx'
import { Button, Switch } from './ui.jsx'

// The 2J training guide — shown once before a new member's first real workout (see
// lib/workout-prefs.js's shouldShowWorkoutGuide and sheets.jsx's startFlow), and on demand from
// Settings → Training. Show, don't explain: every step is a small, realistic piece of the real
// workout screen (same CSS classes the live view uses) and every choice made here is a normal
// preference write, so the preview changes the moment a switch does.
const STEPS = ['view', 'log', 'rest', 'exercise', 'ready']
const SAMPLE = '0025'   // barbell bench press — a real library exercise with an image

export function openWorkoutGuide({ onDone, replay = false } = {}) {
  return useUI.getState().openSheet(close => <WorkoutGuide close={close} onDone={onDone} replay={replay} />, { kind: 'full', locked: true })
}

function MockSet({ view, highlight, done, auto }) {
  const tiles = [['kg', '80'], [t('Reps'), '10'], ['RPE', '8']]
  if (view === 'detailed') return <div className="card g-mock-d" aria-hidden="true">
    <div className="sethead d eff3"><span className="n-sp" /><span className="p-sp">{t('Previous')}</span><span className="v-sp">kg</span><span className="v-sp">{t('reps')}</span><span className="setmeta-head">RPE</span></div>
    {[['1', true], ['2', false], ['3', false]].map(([n, ok]) => <div key={n} className={'setrow d eff3' + (ok ? ' done' : '')}>
      <span className={'n' + (ok ? ' on' : '')}>{ok ? <Icon name="check" /> : n}</span>
      <span className="prevcol">80×10</span>
      <span className={'dcell' + (highlight === 0 && n === '2' ? ' g-hl' : '')}>80</span>
      <span className={'dcell' + (highlight === 1 && n === '2' ? ' g-hl' : '')}>10</span>
      <div className="setmeta"><span className={'dcell eff' + (highlight === 2 && n === '2' ? ' g-hl' : '')}>😬 8</span></div>
    </div>)}
  </div>
  return <div className={'sset g-mock' + (done ? ' done' : '')} aria-hidden="true">
    <div className="sset-hd"><span className="sset-t">{t('Set {0} of {1}', 2, 3)}{done && <Icon name="checkCircle" />}</span><span className="sset-c">{t('{0} of {1} done', done ? 2 : 1, 3)}</span></div>
    <div className="stiles n3">{tiles.map(([l, v], i) => <div key={l} className={'stile' + (i === 2 ? ' eff' : '') + (highlight === i ? ' g-hl' : '')}>
      <span className="stile-l">{l}</span><span className="stile-v">{i === 2 && <span className="em">😬</span>}{v}</span>
    </div>)}</div>
    <div className={'btn primary scomplete' + (highlight === 3 ? ' g-hl' : '')}><Icon name="check" />{auto ? t('Completes automatically') : t('Complete set')}</div>
  </div>
}

function WorkoutGuide({ close, onDone, replay }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const prefs = workoutPrefs(S)
  const [step, setStep] = useState(0)
  const [hl, setHl] = useState(0)
  const key = STEPS[step]
  const ex = EXIDX[SAMPLE]
  // The "log a set" preview walks KG → REPS → RPE → complete on its own, so the flow is seen,
  // not described. Reduced motion keeps it still on the first field.
  useEffect(() => {
    if (key !== 'log') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const iv = setInterval(() => setHl(h => (h + 1) % 5), 1100)
    return () => clearInterval(iv)
  }, [key])
  const pref = (k, v) => update(s => { s[k] = v })
  const end = () => {
    if (!replay) update(s => { s.workoutGuidePending = false })
    close()
    onDone?.()
  }

  return <div className="guide narrow" role="dialog" aria-modal="true" aria-label={t('How training works in 2J')}>
    <div className="g-top">
      <div className="g-prog" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
        {STEPS.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}
      </div>
      {key !== 'ready' && <button className="g-skip" onClick={end}>{replay ? t('Close') : t('Skip')}</button>}
    </div>

    {key === 'view' && <section className="g-step">
      <div className="g-eyebrow">2J · {t('Training')}</div>
      <h1>{t('How do you want to train?')}</h1>
      <p className="g-sub">{t('You can switch at any moment during a workout — nothing you log changes.')}</p>
      <div className="g-choices" role="radiogroup">
        {[['simple', t('One exercise, big and clean. Ideal to focus on each set.')], ['detailed', t('Every set at a glance, with your previous numbers alongside.')]].map(([v, d]) =>
          <button key={v} role="radio" aria-checked={prefs.view === v} className={'g-choice' + (prefs.view === v ? ' on' : '')} onClick={() => pref('workoutView', v)}>
            <span className="g-choice-t">{v === 'simple' ? t('Simple') : t('Detailed')}{prefs.view === v && <Icon name="checkCircle" />}</span>
            <span className="g-choice-d">{d}</span>
          </button>)}
      </div>
      <div className="g-preview"><MockSet view={prefs.view} highlight={-1} /></div>
    </section>}

    {key === 'log' && <section className="g-step">
      <div className="g-eyebrow">{t('Log a set')}</div>
      <h1>{t('Tap, enter, done')}</h1>
      <p className="g-sub">{t('Tap Kg, Reps or RPE and a big 2J keypad opens with the real jumps of your equipment. RPE is optional: how hard the set felt.')}</p>
      <div className="g-preview"><MockSet view="simple" highlight={hl} done={hl === 4} auto={prefs.autoComplete} /></div>
      <div className="g-flow" aria-hidden="true">
        {['Kg', t('Reps'), 'RPE', '✓'].map((s, i) => <span key={s} className={hl === i ? 'on' : ''}>{s}</span>)}
      </div>
      <div className="sect-b g-opts">
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Complete sets automatically')}</span>
          <span className="lrow-s">{t('When the last value is entered, the set is ticked off for you. Never with data missing.')}</span></span>
          <Switch checked={prefs.autoComplete} onChange={v => pref('autoCompleteSets', v)} /></div>
      </div>
    </section>}

    {key === 'rest' && <section className="g-step">
      <div className="g-eyebrow">{t('Rest and plates')}</div>
      <h1>{t('Rest, and know what to load')}</h1>
      <p className="g-sub">{t('When you complete a set, the rest starts on its own. On barbell lifts, “Plates” shows what goes on each side.')}</p>
      <div className="g-rest" aria-hidden="true">
        <div className="g-rest-t">1:30</div>
        <div className="grow"><div className="g-rest-l">{nameFor(ex)}</div><div className="bar"><i style={{ width: '62%' }} /></div></div>
        <span className="g-rest-b"><Icon name="pause" /></span>
      </div>
      <div className="g-plates" aria-hidden="true">
        <div className="g-plates-h"><Icon name="barbell" /><b>{t('Plates')}</b><span>80 kg · {t('{0} {1} per side', 30, 'kg')}</span></div>
        <BarbellPlates weight={80} unit="kg" barW={20} height={96} />
      </div>
      <div className="sect-b g-opts">
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Alert when rest ends')}</span></span>
          <Switch checked={prefs.restAlert} onChange={v => useUI.getState().setRestAlertPreference(v)} /></div>
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Sound')}</span></span>
          <Switch checked={prefs.sound} disabled={!prefs.restAlert} onChange={v => pref('sound', v)} /></div>
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Vibration')}</span></span>
          <Switch checked={prefs.vibrate} disabled={!prefs.restAlert} onChange={v => pref('restVibrate', v)} /></div>
      </div>
    </section>}

    {key === 'exercise' && <section className="g-step">
      <div className="g-eyebrow">{t('Your exercise')}</div>
      <h1>{t('Your trainer’s notes, always in view')}</h1>
      <p className="g-sub">{t('Notes are what your trainer wrote for you. Tips are the general how-to of the exercise. Machine taken? “Change exercise” keeps your sets.')}</p>
      <div className="g-preview g-hero" aria-hidden="true">
        {prefs.images && imgSrc(ex) && <div className="g-img"><img src={imgSrc(ex)} alt="" /></div>}
        <div className="exname" style={{ fontSize: 20 }}>{nameFor(ex)}</div>
        <div className="shero-meta"><span className="tag nocap"><Icon name="target" />3 × 8-10 {t('reps')}</span><span className="tag swap nocap"><Icon name="shuffle" />{t('Change exercise')}</span></div>
        <div className="cues">
          <div className="cue note"><div className="cue-l"><Icon name="clipboard" />{t('Trainer’s note')}</div><div className="cue-t">{t('3 seconds down, pause at the bottom.')}</div></div>
          {prefs.tips && <div className="cue tips"><div className="cue-l"><Icon name="lightbulb" />{t('Tips')}</div><div className="cue-t">{t('Feet flat on the floor, shoulder blades pinned back.')}</div></div>}
        </div>
      </div>
      <div className="sect-b g-opts">
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Show exercise images')}</span></span>
          <Switch checked={prefs.images} onChange={v => pref('showExerciseImages', v)} /></div>
        <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Show tips')}</span></span>
          <Switch checked={prefs.tips} onChange={v => pref('showExerciseTips', v)} /></div>
      </div>
    </section>}

    {key === 'ready' && <section className="g-step g-ready">
      <div className="g-badge"><Icon name="checkCircle" /></div>
      <h1>{t('All set. Let’s train.')}</h1>
      <p className="g-sub">{t('You can change all of this in Settings → Training, and see this guide again there.')}</p>
    </section>}

    <div className="g-foot">
      {step > 0 && key !== 'ready' && <Button icon="chevronLeft" onClick={() => setStep(step - 1)}>{t('Back')}</Button>}
      {key === 'ready'
        ? <Button variant="primary" icon={replay ? null : 'play'} onClick={end}>{replay ? t('Done') : t('Start workout')}</Button>
        : <Button variant="primary" trailingIcon="chevronRight" onClick={() => setStep(step + 1)}>{t('Next')}</Button>}
    </div>
  </div>
}
