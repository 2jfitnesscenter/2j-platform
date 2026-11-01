// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { effortOf } from '../lib/history.js'
import { uxOn, allowedByAdmin } from '../lib/features.js'
import { runningView, finish } from '../lib/premium.js'
import { confirmSheet } from '../sheets.jsx'
import { LEVELS } from '../lib/rp-volume.js'
import { workoutPrefs } from '../lib/workout-prefs.js'
import { useUI } from '../store/useUI.js'
import { DUMBBELL_WEIGHTS_2J, MACHINE_WEIGHTS_CONFIG, BARBELL_PLATES_2J } from '../lib/equipment.js'
import { openWorkoutGuide } from '../components/WorkoutGuide.jsx'
import { effortHelpSheet, trainingZonesHelpSheet, overloadHelpSheet, rpVolumeHelpSheet } from './Settings.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Slider, Segmented, Button } from '../components/ui.jsx'
import { isAndroidNative } from '../lib/rest-notification.js'
import { enablePush, pushPermission, pushSupported, scheduleTestRestAlert } from '../lib/push.js'

const DEFAULT_INC = { barbell: 5, dumbbell: 2, machineOther: 5 }

// Settings → Training: every preference that shapes the live workout, in the order a member
// meets them (how it looks, how a set is logged, the rest, progression, the guide). The
// equipment/stepping details that only matter to a few sit behind "More options". Nothing here
// touches a routine or a session — they are presentation and behaviour preferences only
// (lib/workout-prefs.js).
export default function TrainingSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const prefs = workoutPrefs(S)
  const [more, setMore] = useState(false)
  const wakeOK = wakeLockSupported()
  const use2J = S.use2JRoomEquipment !== false
  const inc = S.customIncrements || DEFAULT_INC
  const running = runningView(S)
  const set = (k, v) => update(s => { s[k] = v })
  const setInc = (k, v) => update(s => { s.customIncrements = { ...(s.customIncrements || DEFAULT_INC), [k]: v } })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Training')}</h1></div>
    </div>

    {/* Premium program: the running one can always be seen and finished here, whatever the gym's catalogue switch says. */}
    {(running || allowedByAdmin('premium')) && <Section title={t('Premium program')} footer={running ? t('Finishing it keeps your workouts and records; the program moves to your history.') : null}>
      {running ? <>
        <Row icon="trophy" iconTint="var(--yellow)" title={running.inst.name} subtitle={t('Cycle {0} · Week {1}/{2}', running.pos.cycle, running.pos.week, running.pos.weeks) + (running.inst.status === 'paused' ? ' · ' + t('Paused') : '')} accessory="chevron" onClick={() => nav('/premium/active')} />
        <Row icon="check" title={t('Finish program')} danger onClick={() => confirmSheet({ title: t('Finish this program?'), message: t('Your workouts, records and history stay. The program moves to your history.'), confirmText: t('Finish program'), danger: true, onConfirm: () => update(s => { s.premium = finish(s) }) })} />
      </> : <Row icon="trophy" iconTint="var(--yellow)" title={t('Premium training')} subtitle={t('Proven methods, adapted to you.')} accessory="chevron" onClick={() => nav('/premium')} />}
    </Section>}

    <Section title={t('View')} footer={t('Two ways to see the same workout — switch any time, even mid-session.')}>
      <div className="lrow" style={{ paddingTop: 11, paddingBottom: 11 }}>
        <Segmented value={prefs.view} onChange={v => set('workoutView', v)}
          options={[{ value: 'simple', label: t('Simple') }, { value: 'detailed', label: t('Detailed') }]} />
      </div>
    </Section>

    <Section title={t('Visual')}>
      <Row icon="figureStrength" iconTint="var(--blue)" title={t('Show exercise images')}>
        <Switch checked={prefs.images} onChange={v => set('showExerciseImages', v)} />
      </Row>
      <Row icon="lightbulb" iconTint="var(--yellow)" title={t('Show tips')}
        subtitle={t('The exercise’s general how-to. Your trainer’s notes always show.')}>
        <Switch checked={prefs.tips} onChange={v => set('showExerciseTips', v)} />
      </Row>
    </Section>

    <Section title={t('Sets')}>
      <Row icon="checkCircle" iconTint="var(--acc)" title={t('Complete sets automatically')}
        subtitle={t('When the last value is entered, the set is ticked off for you. Never with data missing.')}>
        <Switch checked={prefs.autoComplete} onChange={v => set('autoCompleteSets', v)} />
      </Row>
      <Row icon="flame" iconTint="var(--orange)" title={t('Warmup sets')}
        subtitle={t('Suggest warmup sets before your working sets.')}>
        <Switch checked={S.warmupEnabled !== false} onChange={v => set('warmupEnabled', v)} />
      </Row>
{uxOn(S, 'effort') && <>
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
      </>}
      <Row icon="barbell" iconTint="var(--blue)" title={t('Plates shortcut')}
        subtitle={t('Shows “Plates” on barbell sets, with what goes on each side.')}>
        <Switch checked={S.enablePlateCalculator !== false} onChange={v => set('enablePlateCalculator', v)} />
      </Row>
    </Section>

    <Section title={t('Rest')} footer={t('Rest alert behavior: Android schedules a private local notification when permission is allowed. If notifications are denied, the timer still works; allow 2J notifications in Android settings and turn this alert off and on again. In a browser, background alerts require an internet connection.')}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => set('restSec', v)}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      <Row icon="bell" iconTint="var(--pink)" title={t('Alert when rest ends')}>
        <Switch checked={prefs.restAlert} onChange={v => useUI.getState().setRestAlertPreference(v)} />
      </Row>
      {!MOBILE && !isAndroidNative() && <WebRestAlertSetup />}
      <Row icon="bell" iconTint="var(--pink)" title={t('Sound')} subtitle={t('Also the short beep when you complete a set.')}>
        <Switch checked={prefs.sound} onChange={v => set('sound', v)} />
      </Row>
      <Row icon="bolt" iconTint="var(--pink)" title={t('Vibration')}>
        <Switch checked={prefs.vibrate} onChange={v => set('restVibrate', v)} />
      </Row>
    </Section>

    <Section title={t('Check-in and heart rate')} footer={t('The check-in is a few taps before training, never required. Max heart rate is only used to split heart-rate data into zones; without it 2J uses the 220 − age estimate and says so.')}>
      <SelectRow icon="heart" iconTint="var(--pink)" title={t('Pre-workout check-in')}
        value={['ask', 'sometimes', 'off'].includes(S.checkinMode) ? S.checkinMode : 'sometimes'} onChange={v => set('checkinMode', v)}
        options={[{ value: 'ask', label: t('Before every workout') }, { value: 'sometimes', label: t('Now and then') }, { value: 'off', label: t('Never') }]} />
      <SelectRow icon="heart" iconTint="var(--red)" title={t('Max heart rate')}
        value={S.hrMax > 0 ? S.hrMax : 0} onChange={v => set('hrMax', v > 0 ? v : null)}
        options={[{ value: 0, label: t('Estimate (220 − age)') }, ...Array.from({ length: 51 }, (_, i) => 160 + i).map(v => ({ value: v, label: v + ' ' + t('bpm') }))]} />
      <Row icon="person" iconTint="var(--blue)" title={t('Share check-ins with gym staff')}
        subtitle={t('Off by default. When on, the staff who run your follow-up see your check-in averages and repeated discomfort — never on the wall, rankings or the Bunker.')}>
        <Switch checked={S.shareCheckins === true} onChange={v => set('shareCheckins', v)} />
      </Row>
    </Section>

    <Section title={t('Progression')}>
{uxOn(S, 'suggestions') && <>
      <Row icon="arrowUp" iconTint="var(--green)" title={t('Progression assistant')}
        subtitle={t('Before each exercise, suggests keeping, adding reps or weight from your real sessions — and says why. You decide.')}>
        <button className="helpbtn" aria-label={t('What is the overload coach?')} onClick={overloadHelpSheet}><Icon name="info" /></button>
        <Switch checked={prefs.progression} onChange={v => set('enableProgressiveOverloadCoach', v)} />
      </Row>
      </>}
{uxOn(S, 'volume') && <>
      <Row icon="target" iconTint="var(--purple)" title={t('Training zones')}
        subtitle={t('Calculate and show relative effort, RPE and %1RM while training.')}>
        <button className="helpbtn" aria-label={t('What are Training zones?')} onClick={trainingZonesHelpSheet}><Icon name="info" /></button>
        <Switch checked={S.enableTrainingZones !== false} onChange={v => set('enableTrainingZones', v)} />
      </Row>
      </>}
{uxOn(S, 'volume') && <>
      <Row icon="chartLine" iconTint="var(--orange)" title={t('Weekly volume zones')}
        subtitle={t('Calculate MV, MEV, MAV and MRV per muscle group and show your weekly progress live.')}>
        <button className="helpbtn" aria-label={t('What are weekly volume zones?')} onClick={rpVolumeHelpSheet}><Icon name="info" /></button>
        <Switch checked={!!S.enableRpVolumeZones} onChange={v => set('enableRpVolumeZones', v)} />
      </Row>
      </>}
      {S.enableRpVolumeZones && uxOn(S, 'volume') && <SelectRow icon="figureStrength" iconTint="var(--orange)" title={t('Training level')}
        value={S.trainingLevel || 'intermediate'} onChange={v => set('trainingLevel', v)}
        options={LEVELS.map(l => ({ value: l, label: t(l[0].toUpperCase() + l.slice(1)) }))} />}
      {S.enableRpVolumeZones && uxOn(S, 'volume') && <Row icon="wrench" iconTint="var(--orange)" title={t('Calibrate per muscle')}
        subtitle={t('Fine-tune MV, MEV, MAV and MRV thresholds for each of the 12 muscle groups')}
        accessory="chevron" onClick={() => nav('/settings/rp-volume')} />}
    </Section>

    <Section title={t('Guide')}>
      <Row icon="play" iconTint="var(--acc)" title={t('See the training guide again')}
        accessory="chevron" onClick={() => openWorkoutGuide({ replay: true })} />
    </Section>

    <button className="more-toggle" aria-expanded={more} onClick={() => setMore(m => !m)}>
      {t('More options')}<Icon name={more ? 'chevronUp' : 'chevronDown'} />
    </button>
    {more && <>
      <Section title={t('Previous results')}>
        <Row icon="history" iconTint="var(--blue)" title={t('Show previous results')}
          subtitle={t('Shows your last mark or reference set in gray while training.')}>
          <Switch checked={S.showPreviousResults !== false} onChange={v => set('showPreviousResults', v)} />
        </Row>
      </Section>

      <Section title={t('Room equipment')}>
        <Row icon="dumbbell" iconTint="var(--acc)" title={t('2J Fitness Center room mode')}
          subtitle={t('Adjusts the +/- buttons to this gym’s real dumbbells and machines.')}>
          <Switch checked={use2J} onChange={v => set('use2JRoomEquipment', v)} />
        </Row>
      </Section>

      <Section title={t('Weight step button')}
        footer={use2J ? null : t('Applies to every exercise that uses that equipment.')}>
        {use2J ? <>
          <Row icon="dumbbell" iconTint="var(--blue)" title={t('Dumbbells')}
            value={t('{0} to {1} kg', DUMBBELL_WEIGHTS_2J[0], DUMBBELL_WEIGHTS_2J[DUMBBELL_WEIGHTS_2J.length - 1])} />
          <Row icon="scale" iconTint="var(--teal)" title={t('Machines')}
            value={t('steps of {0} kg', MACHINE_WEIGHTS_CONFIG.step)} />
          <Row icon="barbell" iconTint="var(--orange)" title={t('Barbell')}
            value={t('plates {0} to {1} kg', BARBELL_PLATES_2J[0], BARBELL_PLATES_2J[BARBELL_PLATES_2J.length - 1])} />
        </> : <div style={{ padding: '2px 2px 12px' }}>
          <IncrementSlider icon="barbell" tint="var(--orange)" label={t('Barbell')} unit={S.unit}
            value={inc.barbell} min={1} max={20} step={0.5} onChange={v => setInc('barbell', v)} />
          <IncrementSlider icon="dumbbell" tint="var(--blue)" label={t('Dumbbell')} unit={S.unit}
            value={inc.dumbbell} min={0.5} max={10} step={0.5} onChange={v => setInc('dumbbell', v)} />
          <IncrementSlider icon="scale" tint="var(--teal)" label={t('Machine / cable')} unit={S.unit}
            value={inc.machineOther} min={1} max={20} step={1} onChange={v => setInc('machineOther', v)} />
        </div>}
      </Section>

      {(wakeOK || !MOBILE) && <Section title={t('Other')}>
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => set('keepAwake', v)} />
        </Row>
      </Section>}
    </>}
  </div>
}

function WebRestAlertSetup() {
  const supported = pushSupported()
  const [permission, setPermission] = useState(() => pushPermission())
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supported) return
    let active = true
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
      if (active) setSubscribed(!!sub)
    }).catch(() => {})
    return () => { active = false }
  }, [supported])

  const test = async () => {
    setBusy(true); setMessage('')
    const outcome = await runWebPushRestAlertTest()
    setPermission(pushPermission())
    if (outcome.ok) {
      setSubscribed(true)
      setMessage(t('Test scheduled. Minimize 2J now; the notification should arrive in about 5 seconds.'))
    } else setMessage(outcome.error?.message || t('Could not schedule the notification test.'))
    setBusy(false)
  }

  return <div style={{ padding: '8px 14px 14px' }}>
    <div className="dim small" style={{ marginBottom: 8 }}>
      {t('Web push status')}: {!supported ? t('Not supported in this browser.') : permission === 'denied' ? t('Notifications blocked') : permission === 'granted' ? (subscribed ? t('Allowed and configured on this device') : t('Allowed, not configured yet')) : t('Not configured')}
    </div>
    {permission === 'denied' && <div className="dim small" style={{ marginBottom: 8 }}>{t('Notifications are blocked. Open your browser or device settings, allow notifications for app.2jfitnesscenter.com, then return here.')}</div>}
    {supported && permission !== 'denied' && <Button variant="tinted" icon="bell" disabled={busy} onClick={test}>
      {busy ? t('Preparing test…') : t('Enable web notifications and test')}
    </Button>}
    {message && <div className="dim small" role="status" aria-live="polite" style={{ marginTop: 8 }}>{message}</div>}
  </div>
}

export async function runWebPushRestAlertTest() {
  try {
    const result = await enablePush()
    if (!result?.subscriptionId) throw new Error(t('Could not schedule the notification test.'))
    await scheduleTestRestAlert(result.subscriptionId)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(t('Could not schedule the notification test.')) }
  }
}

function IncrementSlider({ icon, tint, label, value, unit, min, max, step, onChange }) {
  return <div style={{ marginBottom: 18 }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <span className="row" style={{ gap: 10 }}>
        <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
        <span className="lrow-t">{label}</span>
      </span>
      <span className="dim small">{value} {unit}</span>
    </div>
    <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
  </div>
}
