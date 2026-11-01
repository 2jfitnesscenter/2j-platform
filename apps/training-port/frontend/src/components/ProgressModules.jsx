// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtVol, fmtDate } from '../lib/format.js'
import { setsDone } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { workoutDetailSheet, openEventDetail } from '../sheets.jsx'
import Icon from './Icon.jsx'
import BodyMap from './BodyMap.jsx'
import BodyMapPanel from './BodyMapPanel.jsx'
import { EventRow } from './Mi2JEvents.jsx'
import { loadOfWorkouts, muscleOptsOf } from '../lib/muscles.js'
import { daysSinceBioimpedance, MEASUREMENTS } from '../lib/measurements.js'
import { latestAdvance, closestGoal } from '../lib/mi2j.js'
import { TIER_COLOR, rankLabel, rankEmblemUrl, RANK_GROUP_NAME } from '../lib/rank.js'
import { fetchWhoopRecovery, fetchWhoopSleep } from '../lib/whoop-api.js'
import { mergeSeries } from '../lib/import-csv.js'

// Modules that used to sit on Home and now live in Progress (views/Stats.jsx), each shown only when it is on for the member
// and there is something to show: the latest step forward and the closest goal, the last workout's body map, the
// bioimpedance nudge, a body-composition summary (only once scans exist) and Whoop's recovery. Moved, not removed.


// Full-screen expansion of the compact body map below — the same load, just big enough to
// tap a muscle and read its exact set count, the way Stats.jsx's own Muscle balance card
// already lets you do for a wider window. Opened as a 'full' sheet (Modals.jsx) since a
// pinch-to-read body map is exactly the kind of thing a bottom sheet's own max-height cuts off.
export function WorkoutBodyMapModal({ w, S, close }) {
  const load = loadOfWorkouts([w], null, muscleOptsOf(S))
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{w.name}</h1></div>
    </div>
    <div className="card">
      <BodyMapPanel load={load} body={S.body} top={5} S={S} />
    </div>
  </div>
}

// The left half of Home's own 2-column glance row (.home-grid2) — a condensed tap-through to
// the most recently finished workout: short header, one line of key metrics ("16 series ·
// 5.653 kg"), and a shrunk body map (index.css's .home-bodymap-sm) that opens its own
// full-screen detail on tap — stopping the event so that tap doesn't also fire the card's own
// onClick (which opens the workout detail sheet instead). Same card either half of the grid
// row got in the previous, full-width layout, just laid out for half the space.
export function LastWorkoutCard({ S }) {
  const w = S.workouts.length ? S.workouts[S.workouts.length - 1] : null
  if (!w) return null
  const openMap = e => { e.stopPropagation(); useUI.getState().openSheet(close => <WorkoutBodyMapModal w={w} S={S} close={close} />, { kind: 'full' }) }
  return <div className="card home-half tappable" style={{ cursor: 'pointer' }} onClick={() => workoutDetailSheet(w)}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <div className="home-half-ttl">{t('Last workout')}</div>
      <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
    </div>
    <div className="home-half-sub">{Number.isFinite(w.vol) ? t('{0} sets · {1}', setsDone(w), fmtVol(w.vol, S.unit)) : t('{0} sets', setsDone(w))}</div>
    <div className="home-bodymap-sm tappable" style={{ cursor: 'pointer' }} onClick={openMap}>
      <BodyMap load={loadOfWorkouts([w], null, muscleOptsOf(S))} body={S.body} />
    </div>
  </div>
}

// Nudges toward a fresh body-composition scan once the member's own chosen cadence (15/30
// days, Settings → General → Bioimpedance reminder) has passed since the last one. Renders
// nothing when there's nothing to say — same rule CoachCard follows above — so a brand-new
// profile with no scan on file yet (daysSinceBioimpedance returns null: nothing is "overdue"
// when nothing has ever been logged) never sees this ahead of its first one.
export function BioimpedanceReminderCard({ S, nav }) {
  if (S.enableBioimpedanceReminder === false) return null
  const days = daysSinceBioimpedance(S)
  const cadence = S.bioimpedanceReminderDays || 15
  if (days === null || days < cadence) return null
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/measurements')}>
    <div className="row" style={{ gap: 10 }}>
      <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name="calendar" /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ttl">{t('Time for a new scan')}</div>
        <div className="muted small" style={{ marginTop: 2 }}>
          {t('It’s been {0} days since your last body-composition measurement — tap to log a new one.', days)}
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}

// A separate signal from `RecoveryCard` above — that one is a training-load estimate derived
// purely from logged sets (see lib/recovery.js); this is Whoop's own biometric recovery score
// (HRV/resting-HR based), pulled live once Whoop is connected (Settings → Connected apps). The
// two numbers can legitimately disagree, so they stay two clearly-labeled cards, never merged.
export function WhoopCard({ nav, connected }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!connected) return
    fetchWhoopRecovery().then(setData).catch(() => {})
  }, [connected])
  // Whoop also tracks sleep, same as recovery — merged straight into S.sleep so it lands in the
  // same calendar an Apple Health import fills in (Profile → Health), and persists like anything
  // else the app tracks, not just a number shown while this card happens to be on screen. Runs
  // whenever Home mounts with Whoop connected; each night is de-duped by date the same way a
  // re-imported export.xml is, so this never double-counts a night already merged in.
  useEffect(() => {
    if (!connected) return
    fetchWhoopSleep().then(res => {
      if (!res.connected || !res.sleep?.length) return
      let added = 0
      useStore.getState().update(s => {
        const merged = mergeSeries(s.sleep, res.sleep)
        s.sleep = merged.list
        added = merged.added
      })
      if (added > 0) useUI.getState().toast(t('{0} nights of sleep synced from Whoop', added))
    }).catch(() => {})
  }, [connected])
  if (!connected || !data?.connected || !data.recovery) return null
  const { score } = data.recovery
  return <div className="card">
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 2px' }}>{t('Whoop recovery')}</h2>
        <div className="muted small">{t('From your connected Whoop account')}</div>
      </div>
      {score != null && <div className="big" style={{ fontSize: 28 }}>{score}%</div>}
    </div>
  </div>
}

// Home = what to do now + a quick glance. Deep charts & history live in Stats.

// "Latest step forward" and "Close to": simple continuity, now at the top of Progress instead of on Home.
export function ProgressInsights({ S, nav }) {
  const advance = useMemo(() => latestAdvance(S), [S.workouts, S.bodyweight, S.badges])
  const goal = useMemo(() => S.workouts.length ? closestGoal(S) : null, [S.workouts, S.bodyweight, S.badges, S.tests, S.body])
  if (!advance && !goal) return null
  return <>
    {advance && <div className="card home-adv">
      <div className="home-sec-k">{t('Latest step forward')}</div>
      <EventRow ev={advance} unit={S.unit} onOpen={() => openEventDetail(advance, advance.d)} />
    </div>}

    {goal && <button className="card home-goal" onClick={() => nav(goal.type === 'rank' ? '/rank' : '/badges')}>
      <div className="home-sec-k">{t('Close to')}</div>
      {goal.type === 'rank' ? <div className="home-goal-r">
        <img src={rankEmblemUrl(goal.group.next.tier, goal.group.next.division)} alt="" />
        <div className="grow">
          <div className="tt">{t(RANK_GROUP_NAME[goal.group.key])}</div>
          <div className="small">{rankLabel(goal.group.rank)} → <b style={{ color: TIER_COLOR[goal.group.next.tier] }}>{rankLabel(goal.group.next)}</b></div>
          <div className="rk-bar" style={{ marginTop: 6 }}><i style={{ width: Math.round(goal.group.progress * 100) + '%', background: TIER_COLOR[goal.group.rank.tier] }} /></div>
        </div>
      </div> : <div className="home-goal-r">
        {goal.badge.image ? <img src={goal.badge.image} alt="" /> : <Icon name={goal.badge.icon} />}
        <div className="grow">
          <div className="tt">{t(goal.badge.title)}</div>
          <div className="small muted">{t(goal.badge.description)}</div>
          <div className="rk-bar" style={{ marginTop: 6 }}><i style={{ width: Math.round(goal.progress * 100) + '%', background: 'var(--acc)' }} /></div>
        </div>
      </div>}
    </button>}
  </>
}

// Body composition at a glance — only once there are scans; no empty panel for someone who never used it.
const COMPOSITION = [['bodyFat', 'Body fat'], ['muscleMass', 'Muscle mass'], ['visceralFat', 'Visceral fat'], ['waterPct', 'Water']]
export function BodyCompositionCard({ S, nav }) {
  const rows = COMPOSITION.map(([key, label]) => {
    const series = S.measurements?.[key]
    const last = Array.isArray(series) && series.length ? series[series.length - 1] : null
    const def = MEASUREMENTS.find(m => m.key === key)
    return last && def ? { key, label, v: last.v, unit: def.unit, d: last.d } : null
  }).filter(Boolean)
  if (!rows.length) return null
  return <button className="card tappable" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav('/measurements')}>
    <div className="row between" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>{t('Body composition')}</h2><Icon name="chevronRight" className="chev" /></div>
    <div className="tiles">{rows.map(r => <div key={r.key} className="tile"><div className="l">{t(r.label)}</div><div className="v" style={{ fontSize: 22 }}>{Math.round(r.v * 10) / 10}<span className="dim small"> {r.unit}</span></div></div>)}</div>
    <div className="small dim" style={{ marginTop: 6 }}>{t('Last scan {0}', fmtDate(rows[0].d, true))}</div>
  </button>
}
