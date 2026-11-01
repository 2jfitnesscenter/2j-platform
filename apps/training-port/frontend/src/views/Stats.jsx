import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { orderedBodyWeightSeries } from '../lib/bodyweight.js'
import { visibleProgressCards, PROGRESS_CARDS, PROGRESS_IDS, progressOrder, normalizeProgress } from '../lib/progress-cards.js'
import { setLayout, restoreLayout, guideSeen, markGuideSeen } from '../lib/ux-layout.js'
import LayoutEditor from '../components/LayoutEditor.jsx'
import PersonalizeGuide from '../components/PersonalizeGuide.jsx'
import { lastBW, streakWeeks, setLabel, modeOf, effortOf } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, weekKey } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import RecoveryCard from '../components/RecoveryCard.jsx'
import ProgressTimeline from '../components/ProgressTimeline.jsx'
import FollowUpCard from '../components/FollowUpCard.jsx'
import ProgressCover from '../components/ProgressCover.jsx'
import CardioTestsProgress from '../components/CardioTestsProgress.jsx'
import { openStory } from '../components/StorySheet.jsx'
import { useFollowUp } from '../lib/followup-view.js'
import MuscleDetailCard from '../components/MuscleDetailCard.jsx'
import { muscleDetail } from '../lib/health-v2.js'
import { loadOfWorkouts, rankOf, MUSCLE_NAME, MUSCLE_GROUPS, muscleOptsOf } from '../lib/muscles.js'
import { weeklyGroupVolume, landmarksFor, zoneForVolume, ZONE_META, LEVELS } from '../lib/rp-volume.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import {
  hasEffort, displayScale, scaleName, toScale, avgRir, effortSummary, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR
} from '../lib/effort.js'
import { ZONES, zoneOfSet } from '../lib/training-zones.js'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'
import { uxOn } from '../lib/features.js'
import { ProgressInsights, LastWorkoutCard, BioimpedanceReminderCard, BodyCompositionCard, WhoopCard } from '../components/ProgressModules.jsx'
import { countsForProgression } from '../lib/workout-policy.js'

// Steps, sleep and resting heart rate only ever arrive via an Apple Health import (Settings →
// Import from another app) — nothing in the app logs these by hand, so the card just doesn't
// render for anyone who hasn't imported one.
function HealthCard({ S }) {
  const opts = []
  if (S.steps.length) opts.push({ value: 'steps', label: t('Steps') })
  if (S.sleep.length) opts.push({ value: 'sleep', label: t('Sleep') })
  if (S.restingHR.length) opts.push({ value: 'hr', label: t('Resting HR') })
  const [metric, setMetric] = useState(opts[0].value)
  const on = opts.some(o => o.value === metric) ? metric : opts[0].value
  const pts = on === 'steps' ? S.steps.map(p => ({ t: p.t, y: p.v, d: p.d }))
    : on === 'sleep' ? S.sleep.map(p => ({ t: p.t, y: Math.round(p.v / 6) / 10, d: p.d }))
    : S.restingHR.map(p => ({ t: p.t, y: p.v, d: p.d }))
  const unit = on === 'steps' ? '' : on === 'sleep' ? 'h' : 'bpm'
  const color = on === 'steps' ? 'var(--teal)' : on === 'sleep' ? 'var(--indigo)' : 'var(--red)'
  return <div className="card">
    <h2>{t('Health')}</h2>
    {opts.length > 1 && <Segmented className="seg-range" value={on} onChange={setMetric} options={opts} />}
    <div className="chart"><LineChart points={pts} h={150} unit={unit} color={color} /></div>
    <div className="small dim" style={{ marginTop: 8 }}>{t('Imported from Apple Health.')}</div>
  </div>
}

// Which muscles the training in a window actually hit — and, the point of the card,
// which ones it keeps missing. Shading is relative within the window (lib/muscles.js).
function MuscleBalance({ S }) {
  const [win, setWin] = useState(7)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const now = Date.now()
  const inWin = S.workouts.filter(w => countsForProgression(w) && (
    win === 0 ? true
      : win === 7 ? weekKey(w.d) === weekKey(todayISO())
        : (w.start || new Date(w.d).getTime()) > now - win * 86400000))
  // Counting only the sets taken near failure turns the map from "where did the volume go"
  // into "where did the stimulus go" — a muscle can lead on sets and still never be trained
  // hard. Offered only when the window holds ratings at all, since with none the hard map
  // would just be empty and read as "you trained nothing".
  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null, muscleOptsOf(S))
  const { worked, missed } = rankOf(load)
  const top = worked.slice(0, 4)
  const max = worked.length ? load[worked[0]] : 0
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Muscle balance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {on ? t('by hard sets') : t('by sets worked')}</span></h2>
      {rated && <Button size="sm" icon="flame" style={on ? { color: 'var(--yellow)' } : undefined}
        onClick={() => { setHard(h => !h); setSel(null) }}>{on ? t('Hard') : t('All')}</Button>}
    </div>
    <Segmented className="seg-range" value={win} onChange={v => { setWin(v); setSel(null) }}
      options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {inWin.length ? <>
      <div className="v2-bmp-map">
        <BodyMap className="tappable bm-premium" load={load} body={S.body} selected={sel}
          onMuscle={m => setSel(s => (s === m ? null : m))} />
        <div className="v2-bmp-cap" aria-hidden="true"><span>{t('Front view')}</span><span>{t('Back view')}</span></div>
      </div>
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : on ? t('no hard sets') : t('not trained')}</span>
      </div>}
      {sel && <MuscleDetailCard detail={muscleDetail(S, sel)} unit={S.unit} />}
      {!sel && top.map(m => <div key={m} className="mrow">
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(load[m] / max * 100) + '%', background: on ? 'var(--yellow)' : undefined }} /></span>
        <span className="v">{t('{0} sets', sets(m))}</span>
      </div>)}
      {missed.length > 0 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{on ? t('No hard sets in this period') : t('Not trained in this period')}</h4>
        <div className="mchips">{missed.map(m => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
      </>}
      {!missed.length && worked.length > 0 &&
        <div className="muted small" style={{ marginTop: 10 }}>{on
          ? t('Every muscle group got at least one hard set in this period.')
          : t('Every muscle group got some work in this period.')}</div>}
    </> : <div className="muted small">{t('No workouts in this period yet.')}</div>}
  </div>
}

// This week's accumulated set count per muscle group, against the current training level's
// MV/MEV/MAV/MRV landmarks (lib/rp-volume.js) — the Progress-tab counterpart to Workout.jsx's
// live per-exercise bar, all 12 groups at once instead of one at a time. Settings' own toggle
// gates this card the same way it gates the logger bar and hides the %1RM/RPE zone chip.
// Tapping the card opens the full analytics screen (heatmap, 5-week history, mesocycle
// status); the gear jumps straight to per-muscle calibration instead, since that's an edit,
// not a read — the same two destinations Settings' own "Calibrate per muscle" row and the
// analytics screen's own gear both lead to.
function RpVolumeCard({ S, nav }) {
  const volume = weeklyGroupVolume(S, muscleOptsOf(S))
  const level = LEVELS.includes(S.trainingLevel) ? S.trainingLevel : 'intermediate'
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/stats/rp-volume')}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Weekly volume zones')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t(level[0].toUpperCase() + level.slice(1))}</span></h2>
      <button className="iconbtn" aria-label={t('Calibrate volume zones')}
        onClick={e => { e.stopPropagation(); nav('/settings/rp-volume') }}><Icon name="gear" /></button>
    </div>
    {MUSCLE_GROUPS.map(g => {
      const lm = landmarksFor(S, g.key)
      const sets = Math.round((volume[g.key] || 0) * 10) / 10
      const zone = zoneForVolume(sets, lm)
      const meta = ZONE_META[zone]
      const cap = lm.mrvMax || lm.mrvMin || 1
      return <div key={g.key} className="mrow v3-zone">
        <span className="nm">{t(g.name)}</span>
        <span className="bar" role="img" aria-label={`${meta.code} ${fmtNum(sets)}`}><i style={{ width: Math.max(sets > 0 ? 4 : 0, Math.min(100, Math.round(sets / cap * 100))) + '%', background: meta.color }} /></span>
        <span className="v" style={{ color: meta.color, fontWeight: 700, minWidth: 84 }}>{meta.code} {fmtNum(sets)}</span>
      </div>
    })}
    <div className="muted small" style={{ marginTop: 10 }}>{t('This week, updated live as you log sets. Tap for the full analytics screen.')}</div>
  </div>
}

// How hard the training was — the half of the picture a volume chart cannot show. Everything
// is computed in RIR (lib/effort.js) and converted to whichever scale this profile reads.
// Every number carries how much of the training it speaks for: rating is optional and off by
// default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const sum = effortSummary(S, win)
  const weeks = effortWeeks(S, win)
  const hist = effortHistogram(S, win)
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <div className="card">
    <h2>{t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('how close to failure')}</span></h2>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{sum.avg == null ? '—' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--yellow)' }}>{sum.hardPct == null ? '—' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small" style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t('Effort per set is switched off — turn it on in Settings to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} /></div>
      </>}
      <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--yellow)' : 'var(--label-3)' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '—'}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Most working sets belong close to failure without living there — half at the floor and half at the top average out to a healthy-looking middle.')}
      </div>
    </>}
  </div>
}

// Where the week's/month's working volume actually landed across the 5 Training Zones
// (lib/training-zones.js) — the counterpart to EffortCard's RIR histogram, but weighted by
// volume (w×r) instead of set count, and classified per set the same way the live logger's
// zone chip is (zoneOfSet: %1RM when known, RIR/RPE fallback otherwise). A set neither signal
// can classify (no 1RM estimate yet and unrated) simply doesn't count toward any zone — shown
// as its own share rather than silently folded into one, so the percentages stay honest.
function ZoneDistributionCard({ S }) {
  const [win, setWin] = useState('week')
  const inWin = S.workouts.filter(w => countsForProgression(w) && (win === 'week' ? weekKey(w.d) === weekKey(todayISO()) : w.d.slice(0, 7) === todayISO().slice(0, 7)))
  const vol = {}
  ZONES.forEach(z => { vol[z.id] = 0 })
  let classified = 0, unclassified = 0
  inWin.forEach(w => (w.entries || []).forEach(e => {
    if (modeOf({ ...(e.target || {}), id: e.id }) !== 'reps') return
    ;(e.sets || []).forEach(s => {
      if (!s.done || s.type === 'warmup' || !s.w || !s.r) return
      const v = s.w * s.r
      const zone = zoneOfSet(S, e.id, s)
      if (zone) { vol[zone.id] += v; classified += v } else unclassified += v
    })
  }))
  const total = classified + unclassified
  const maxVol = Math.max(1, ...ZONES.map(z => vol[z.id]))

  return <div className="card">
    <h2>{t('Training zones')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('volume by intensity')}</span></h2>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 'week', label: t('Week') }, { value: 'month', label: t('Month') }]} />
    {total === 0 ? <div className="muted small">{t('No working sets in this period yet.')}</div> : <>
      {ZONES.map(z => <div key={z.id} className="mrow">
        <span className="nm">{z.short} · {t(z.label)}</span>
        <span className="bar"><i style={{ width: Math.round(vol[z.id] / maxVol * 100) + '%', background: z.color }} /></span>
        <span className="v">{classified ? Math.round(vol[z.id] / classified * 100) + '%' : '—'}</span>
      </div>)}
      {unclassified > 0 && <div className="small dim" style={{ marginTop: 8 }}>
        {t('{0}% of this period’s volume has no 1RM estimate or rated effort to classify yet.', Math.round(unclassified / total * 100))}
      </div>}
    </>}
  </div>
}

// Stats = the analytics hub: all charts, progress and history live here.
export default function Stats() {
  const nav = useNavigate()
  const followUp = useFollowUp()   // read-only schedule of the gym's follow-up (offline → nothing)
  const [params] = useSearchParams()
  const deepLinkId = params.get('ex')
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const [editing, setEditing] = useState(false)
  const [guide, setGuide] = useState(false)
  useStore(s => s.features)   // admin switches may arrive after the first render
  const [range, setRange] = useState(90)
  const [exId, setExId] = useState(() => deepLinkId || null)
  const [exMetric, setExMetric] = useState('top')
  const exProgressRef = useRef(null)
  const now = Date.now()
  const anyEffort = hasEffort(S)
  const kind = displayScale(S)
  const hd = scaleName(kind)

  // Arriving via a deep link (an exercise's own detail sheet → "See full history") should land
  // on that exercise even with zero sessions logged, and scroll straight to the card — it sits
  // below the heatmap/muscle-balance/effort cards otherwise.
  useEffect(() => {
    if (deepLinkId) exProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const bwSeries = orderedBodyWeightSeries(S)            // the one reader of body weight (lib/bodyweight.js)
  const bwPts = bwSeries.filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const bw30 = bwSeries.filter(b => (b.t || new Date(b.d).getTime()) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const monthW = S.workouts.filter(w => w.d.slice(0, 7) === todayISO().slice(0, 7)).length

  const performanceWorkouts = S.workouts.filter(countsForProgression)
  const trainedHist = [...new Set(performanceWorkouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id]).sort((a, b) => nameFor(EXIDX[a]) < nameFor(EXIDX[b]) ? -1 : 1)
  // A deep link should show its exercise even with zero sessions — otherwise the picker below
  // silently falls back to whichever trained exercise sorts first.
  const exHist = deepLinkId && EXIDX[deepLinkId] && !trainedHist.includes(deepLinkId) ? [...trainedHist, deepLinkId] : trainedHist
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // How this exercise was logged most recently decides what the curve means: top weight,
  // longest hold or top speed. Sets logged in another mode lack the field and score 0, so a
  // switched exercise drops its old points instead of mixing seconds into a weight chart.
  const curMode = curEx ? (() => {
    for (let i = performanceWorkouts.length - 1; i >= 0; i--) {
      const en = performanceWorkouts[i].entries.find(e => e.id === curEx)
      if (en) return modeOf({ ...(en.target || {}), id: curEx })
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  const metric = s => curCardio ? (s.speed || 0) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : S.unit
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    performanceWorkouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) { const mx = Math.max(0, ...en.sets.filter(s => s.done).map(metric), curCardio || curTimed ? 0 : (en.topW || 0)); if (mx > 0) { exPts.push({ t: w.start, y: mx, d: w.d, sets: en.sets.filter(s => s.done), target: en.target }); if (mx > exBest) exBest = mx } }
    })
    exList = exPts.slice(-5).reverse()
  }
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  const e1Pts = curEx ? e1rmSeries(S, curEx) : []
  const e1Best = curEx ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(Boolean)
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  }))
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })

  // The blocks of this page are a closed catalogue (lib/progress-cards.js): the member can hide and re-order them from Settings → Personalise my experience.
  // Each block keeps its own data/feature gates; the header, the period cover, the follow-up card and the recent-workouts list are structural and always shown.
  const blocks = {
    insights: <ProgressInsights S={S} nav={nav} />,
    last: S.workouts.length > 0 && <LastWorkoutCard S={S} />,
    recovery: S.workouts.length > 0 && uxOn(S, 'recovery') && <RecoveryCard nav={nav} S={S} compact />,
    composition: uxOn(S, 'bioimpedance') && <>
      <BioimpedanceReminderCard S={S} nav={nav} />
      <BodyCompositionCard S={S} nav={nav} />
    </>,
    weight: <>
    {uxOn(S, 'bodyweight') && !S.bodyweight.length && <div className="card"><div className="row between"><div><h2 style={{ margin: 0 }}>{t('Body weight')}</h2><div className="small dim">{t('Log your weight to see how it evolves.')}</div></div><Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button></div></div>}
    {uxOn(S, 'bodyweight') && S.bodyweight.length > 0 && <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      <Segmented className="seg-range" value={range} onChange={setRange}
        options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
      <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
    </div>}
    </>,
    activity: <div className="card">
      <h2>{t('Activity — last 12 months')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('by time trained')}</span></h2>
      <Heatmap S={S} onDay={iso => { const ws = S.workouts.filter(w => w.d === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso) }} />
    </div>,
    muscles: <>
    {S.workouts.length > 0 && <MuscleBalance S={S} />}
    {S.enableRpVolumeZones && uxOn(S, 'volume') && <RpVolumeCard S={S} nav={nav} />}
    </>,
    timeline: <ProgressTimeline S={S} />,
    cardio: <CardioTestsProgress tests={S.tests} onStart={() => nav('/tests')} />,
    effort: <>
    {anyEffort && uxOn(S, 'effort') && <EffortCard S={S} />}
    {!anyEffort && uxOn(S, 'effort') && effortOf(S) === 'none' && S.workouts.length > 0 && <button className="card tappable" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav('/settings/training')}>
      <div className="row between"><div><h2 style={{ margin: 0 }}>{t('Effort')}</h2><div className="small dim">{t('Rate how hard your sets feel to see effort trends here.')}</div></div><Icon name="chevronRight" className="chev" /></div>
    </button>}
    {S.enableTrainingZones !== false && uxOn(S, 'volume') && <ZoneDistributionCard S={S} />}
    </>,
    exercise: <div className="card" ref={exProgressRef}>
        <h2>{t('Exercise progress')}</h2>
        {exHist.length ? <>
          <div className="sect-b" style={{ marginBottom: 10 }}>
            <SelectRow title={t('Exercise')} sheetTitle={t('Exercise progress')} value={curEx} onChange={setExId}
              options={exHist.map(id => ({ value: id, label: nameFor(EXIDX[id]) }))} />
          </div>
          {exPts.length === 0 ? <div className="muted small">{t('This exercise is new — finish it to start building your history.')}</div> : <>
            {exOpts.length > 1 && <Segmented className="seg-range" value={onEff ? 'effort' : onE1 ? 'e1rm' : 'top'} onChange={setExMetric} options={exOpts} />}
            <div className="chart">
              {onEff
                ? <LineChart points={effPts} h={150} unit={hd} color="var(--yellow)" invert={kind === 'rir'} />
                : <LineChart points={onE1 ? e1Pts.map(p => ({ t: p.t, y: p.y, d: p.d })) : topPts} h={150} unit={exUnit} color="var(--blue)" />}
            </div>
            <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
              <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(curEx, s, p.target)).join('  ')}</span></div>)}</div>
            <div className="small dim" style={{ marginTop: 8 }}>
              {onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : t('Best set weight per workout')}
              {onEff ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b></>}
            </div>
            {onE1 && <div className="small dim" style={{ marginTop: 4 }}>
              {t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + S.unit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
            </div>}
            {!onEff && !onE1 && showEff && <div className="small dim" style={{ marginTop: 4 }}>
              {t('A fuller dot means less left in the tank — the same weight at a lower {0} is progress the line alone does not show.', hd)}
            </div>}
          </>}
        </> : <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>}
      </div>
,
    health: uxOn(S, 'health') && (S.steps.length || S.sleep.length || S.restingHR.length) > 0 && <HealthCard S={S} />,
    whoop: uxOn(S, 'health') && <WhoopCard nav={nav} connected={!!user?.whoop} />,
  }
  const shown = visibleProgressCards(S)
  const nodes = []
  shown.forEach((id, i) => {
    // The last workout and the muscle recovery sit side by side when they are neighbours (the page as it always was); apart, each takes its own row.
    if (id === 'last' && shown[i + 1] === 'recovery') { nodes.push(<div key="last" className="home-grid2">{blocks.last}{blocks.recovery}</div>); return }
    if (id === 'recovery' && shown[i - 1] === 'last') return
    if (id === 'last') { nodes.push(<div key="last" className="home-grid2">{blocks.last}</div>); return }
    if (id === 'exercise' && shown[i + 1] === 'health') { nodes.push(<div key="cols" className="cols">{blocks.exercise}{blocks.health}</div>, <Fragment key="whoop">{blocks.whoop}</Fragment>); return }
    if (id === 'health' && shown[i - 1] === 'exercise') return          // rendered next to the exercise card above
    if (id === 'health') { nodes.push(<Fragment key="health">{blocks.health}{blocks.whoop}</Fragment>); return }
    nodes.push(<Fragment key={id}>{blocks[id]}</Fragment>)
  })

  return <>
    <div className="pz-row"><button type="button" className={'pz-btn' + (editing ? ' on' : '')} aria-pressed={editing} onClick={() => { if (editing) setEditing(false); else { setEditing(true); if (!guideSeen(S)) setGuide(true) } }}><Icon name="pencil" />{t('Personalise')}</button></div>
    <div className="hdr"><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>

    <ProgressCover S={S} onStory={openStory} />

    {editing && <section className="pz-panel" aria-label={t('Personalise Progress')}>
      <h2>{t('Personalise Progress')}</h2>
      <p className="pz-lead">{t('Choose which blocks Progress shows and in which order. Nothing is deleted.')}</p>
      <LayoutEditor S={S} catalog={PROGRESS_CARDS} layout={{ order: progressOrder(S), hidden: normalizeProgress(S.ux?.progress).hidden }} isDefault={!S.ux?.progress}
        onChange={l => update(s => { setLayout(s, 'progress', l) })} onRestore={() => update(s => { restoreLayout(s, 'progress') })} />
      <button type="button" className="btn primary pz-done" onClick={() => setEditing(false)}>{t('Done')}</button>
    </section>}
    {guide && <PersonalizeGuide onClose={() => { setGuide(false); update(s => { markGuideSeen(s) }) }} />}
    <FollowUpCard fu={followUp} S={S} nav={nav} />
    {nodes}

    {S.workouts.length > 0 && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Recent workouts')}</h4>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {S.workouts.length}</Button>
      </div>
      <div className="list">{[...S.workouts].reverse().slice(0, 6).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </>}
  </>
}
